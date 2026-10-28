import type {
  PDFDocumentLoadingTask,
  PDFPageProxy,
  RenderTask,
} from 'pdfjs-dist/types/src/display/api'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import {
  PDF_LIMITS,
  PdfImportError,
  pdfPageInfoFromViewport,
  pdfRasterDimensions,
  type PdfPageInfo,
  type PdfRasterPage,
} from './pdfGeometry'

export { PDF_LIMITS, PdfImportError, pdfRasterDimensions } from './pdfGeometry'
export type {
  PdfImportErrorCode,
  PdfPageInfo,
  PdfRasterPage,
} from './pdfGeometry'

export interface PdfSession {
  readonly pageCount: number
  getPageInfo(pageNumber: number): Promise<PdfPageInfo>
  renderPage(
    pageNumber: number,
    dpi: number,
    signal: AbortSignal,
  ): Promise<PdfRasterPage>
  thumbnail(pageNumber: number, signal: AbortSignal): Promise<string>
  destroy(): Promise<void>
}

const abortError = (): DOMException =>
  new DOMException('PDF import cancelled.', 'AbortError')

const assertActive = (signal: AbortSignal, destroyed = false): void => {
  if (signal.aborted || destroyed) throw abortError()
}

const pageInfo = (page: PDFPageProxy, pageNumber: number): PdfPageInfo =>
  pdfPageInfoFromViewport(
    pageNumber,
    page.getViewport({ scale: 1 }),
    page.rotate,
  )

export async function openPdf(
  file: File,
  signal: AbortSignal,
): Promise<PdfSession> {
  assertActive(signal)
  if (file.size > PDF_LIMITS.maxFileBytes) {
    throw new PdfImportError('file-too-large')
  }
  if (file.size === 0) throw new PdfImportError('invalid-pdf')

  const bytes = new Uint8Array(await file.arrayBuffer())
  assertActive(signal)
  if (!new TextDecoder().decode(bytes.subarray(0, 1_024)).includes('%PDF-')) {
    throw new PdfImportError('invalid-pdf')
  }
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  assertActive(signal)
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const assetRoot = new URL(
    `${import.meta.env.BASE_URL}pdfjs/${pdfjs.version}/`,
    window.location.href,
  ).href
  let loadingTask: PDFDocumentLoadingTask | undefined
  let destroyed = false
  let activeRender: RenderTask | undefined
  let destroyPromise: Promise<void> | undefined
  const destroy = (): Promise<void> => {
    if (destroyPromise) return destroyPromise
    destroyed = true
    activeRender?.cancel()
    signal.removeEventListener('abort', onAbort)
    destroyPromise = loadingTask?.destroy() ?? Promise.resolve()
    return destroyPromise
  }
  const onAbort = (): void => {
    void destroy().catch(() => undefined)
  }
  signal.addEventListener('abort', onAbort, { once: true })

  try {
    loadingTask = pdfjs.getDocument({
      data: bytes,
      cMapUrl: `${assetRoot}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${assetRoot}standard_fonts/`,
      wasmUrl: `${assetRoot}wasm/`,
      iccUrl: `${assetRoot}iccs/`,
      useWorkerFetch: true,
      enableXfa: false,
      stopAtErrors: true,
      maxImageSize: PDF_LIMITS.maxPagePixels,
      canvasMaxAreaInBytes: PDF_LIMITS.maxPagePixels * 4,
      verbosity: pdfjs.VerbosityLevel.ERRORS,
    })
    const document = await loadingTask.promise
    assertActive(signal, destroyed)
    if (
      !Number.isInteger(document.numPages) ||
      document.numPages < 1 ||
      document.numPages > PDF_LIMITS.maxSourcePages
    ) {
      throw new PdfImportError('page-count-limit')
    }
    const metadata = await document.getMetadata()
    assertActive(signal, destroyed)
    const info = metadata.info as { IsXFAPresent?: boolean }
    // isPureXfa alone is false when XFA loading is disabled. Reject all XFA
    // explicitly instead of returning a blank or incomplete background.
    if (document.isPureXfa || info.IsXFAPresent) {
      throw new PdfImportError('unsupported-xfa')
    }

    let queue: Promise<void> = Promise.resolve()
    const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
      const result = queue.then(() => {
        assertActive(signal, destroyed)
        return operation()
      })
      queue = result.then(
        () => undefined,
        () => undefined,
      )
      return result
    }
    const getPage = async (pageNumber: number): Promise<PDFPageProxy> => {
      if (
        !Number.isInteger(pageNumber) ||
        pageNumber < 1 ||
        pageNumber > document.numPages
      ) {
        throw new PdfImportError('selection-limit')
      }
      return document.getPage(pageNumber)
    }
    const render = async (
      pageNumber: number,
      dpi: number | undefined,
      renderSignal: AbortSignal,
    ): Promise<PdfRasterPage> => {
      assertActive(renderSignal, destroyed)
      let page: PDFPageProxy | undefined
      let canvas: HTMLCanvasElement | undefined
      const cancelRender = (): void => activeRender?.cancel()
      renderSignal.addEventListener('abort', cancelRender, { once: true })
      try {
        page = await getPage(pageNumber)
        assertActive(renderSignal, destroyed)
        const info = pageInfo(page, pageNumber)
        const scale =
          dpi === undefined
            ? Math.min(1, 160 / Math.max(info.widthPoints, info.heightPoints))
            : dpi / 72
        const dimensions =
          dpi === undefined
            ? {
                width: Math.max(1, Math.round(info.widthPoints * scale)),
                height: Math.max(1, Math.round(info.heightPoints * scale)),
              }
            : pdfRasterDimensions(info, dpi)
        const viewport = page.getViewport({ scale })
        canvas = window.document.createElement('canvas')
        canvas.width = dimensions.width
        canvas.height = dimensions.height
        activeRender = page.render({
          canvas,
          viewport,
          // Include saved appearances; do not create interactive DOM layers.
          annotationMode: pdfjs.AnnotationMode.ENABLE,
          intent: 'display',
          background: '#ffffff',
        })
        await activeRender.promise
        assertActive(renderSignal, destroyed)
        const dataUrl = canvas.toDataURL('image/png')
        if (!dataUrl.startsWith('data:image/png;base64,')) {
          throw new PdfImportError('render-failed')
        }
        if (dataUrl.length > PDF_LIMITS.maxEncodedBytes) {
          throw new PdfImportError('encoded-size-limit')
        }
        return { ...info, ...dimensions, dataUrl, dpi: scale * 72 }
      } catch (error) {
        if (renderSignal.aborted || signal.aborted || destroyed) {
          throw abortError()
        }
        if (error instanceof PdfImportError) throw error
        throw new PdfImportError('render-failed')
      } finally {
        renderSignal.removeEventListener('abort', cancelRender)
        activeRender = undefined
        page?.cleanup()
        if (canvas) {
          canvas.width = 0
          canvas.height = 0
        }
      }
    }
    return {
      pageCount: document.numPages,
      getPageInfo: (pageNumber) =>
        enqueue(async () => {
          const page = await getPage(pageNumber)
          try {
            assertActive(signal, destroyed)
            return pageInfo(page, pageNumber)
          } finally {
            page.cleanup()
          }
        }),
      renderPage: (pageNumber, dpi, renderSignal) =>
        enqueue(() => render(pageNumber, dpi, renderSignal)),
      thumbnail: (pageNumber, renderSignal) =>
        enqueue(
          async () =>
            (await render(pageNumber, undefined, renderSignal)).dataUrl,
        ),
      destroy,
    }
  } catch (error) {
    await destroy().catch(() => undefined)
    if (signal.aborted) throw abortError()
    if (error instanceof PdfImportError) throw error
    if (error instanceof Error && error.name === 'PasswordException') {
      throw new PdfImportError('password-required')
    }
    throw new PdfImportError('invalid-pdf')
  }
}
