import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openPdf, PDF_LIMITS } from './pdf'

const pdfjs = vi.hoisted(() => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: '' },
  AnnotationMode: { ENABLE: 1 },
  VerbosityLevel: { ERRORS: 0 },
  version: '6.4.299',
}))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => pdfjs)

const pdfFile = (content = '%PDF-1.7\n'): File => {
  const file = new File([content], 'sample.pdf', { type: 'application/pdf' })
  Object.defineProperty(file, 'arrayBuffer', {
    value: () => Promise.resolve(new TextEncoder().encode(content).buffer),
  })
  return file
}

function mockDocument(options: { pages?: number; xfa?: boolean } = {}) {
  const cleanup = vi.fn()
  const render = vi.fn((options: unknown) => {
    void options
    return { promise: Promise.resolve(), cancel: vi.fn() }
  })
  const page = {
    rotate: 90,
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      width: 144 * scale,
      height: 72 * scale,
    })),
    render,
    cleanup,
  }
  const document = {
    numPages: options.pages ?? 1,
    isPureXfa: false,
    getMetadata: vi.fn(async () => ({
      info: { IsXFAPresent: options.xfa ?? false },
    })),
    getPage: vi.fn(async () => page),
  }
  const destroy = vi.fn(async () => undefined)
  pdfjs.getDocument.mockReturnValue({
    promise: Promise.resolve(document),
    destroy,
  })
  return { document, page, destroy }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/png;base64,aGVsbG8=',
  )
})
afterEach(() => vi.restoreAllMocks())

describe('local PDF import lifecycle', () => {
  it('uses bytes and local versioned resources without fetching document URLs', async () => {
    const { document, destroy } = mockDocument()
    const session = await openPdf(pdfFile(), new AbortController().signal)
    expect(document.getPage).not.toHaveBeenCalled()
    const parameters = pdfjs.getDocument.mock.calls[0][0]
    expect(parameters.data).toBeInstanceOf(Uint8Array)
    expect(parameters.url).toBeUndefined()
    expect(parameters.stopAtErrors).toBe(true)
    expect(parameters.enableXfa).toBe(false)
    expect(parameters.maxImageSize).toBe(PDF_LIMITS.maxPagePixels)
    for (const field of [
      'cMapUrl',
      'standardFontDataUrl',
      'wasmUrl',
      'iccUrl',
    ]) {
      const url = new URL(parameters[field])
      expect(url.origin).toBe(window.location.origin)
      expect(url.pathname).toContain('/pdfjs/6.4.299/')
    }
    await session.destroy()
    await session.destroy()
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('renders only the requested page and releases the temporary canvas', async () => {
    const { document, page } = mockDocument({ pages: 10 })
    const signal = new AbortController().signal
    const session = await openPdf(pdfFile(), signal)
    const raster = await session.renderPage(3, 150, signal)
    expect(document.getPage).toHaveBeenCalledExactlyOnceWith(3)
    expect(raster).toMatchObject({
      pageNumber: 3,
      width: 300,
      height: 150,
      widthMm: 50.8,
      heightMm: 25.4,
      dpi: 150,
      rotation: 90,
    })
    const parameters = page.render.mock.calls[0][0] as unknown as {
      canvas: HTMLCanvasElement
      annotationMode: number
    }
    expect(parameters.annotationMode).toBe(1)
    expect(parameters.canvas.width).toBe(0)
    expect(parameters.canvas.height).toBe(0)
    expect(page.cleanup).toHaveBeenCalledOnce()
    await session.destroy()
  })

  it('rejects password-protected PDFs with an identified state', async () => {
    const error = new Error('secret password must never reach the UI')
    error.name = 'PasswordException'
    const destroy = vi.fn(async () => undefined)
    pdfjs.getDocument.mockReturnValue({
      promise: Promise.reject(error),
      destroy,
    })
    await expect(
      openPdf(pdfFile(), new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'password-required',
      message: 'password-required',
    })
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('detects XFA via metadata even when isPureXfa is false', async () => {
    const { destroy, document } = mockDocument({ xfa: true })
    await expect(
      openPdf(pdfFile(), new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'unsupported-xfa',
    })
    expect(document.getPage).not.toHaveBeenCalled()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('rejects source page counts before rendering', async () => {
    const { destroy, document } = mockDocument({ pages: 1001 })
    await expect(
      openPdf(pdfFile(), new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'page-count-limit',
    })
    expect(document.getPage).not.toHaveBeenCalled()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('rejects bad headers and oversized files before starting a worker', async () => {
    await expect(
      openPdf(pdfFile('not a PDF'), new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'invalid-pdf',
    })
    const huge = pdfFile()
    Object.defineProperty(huge, 'size', { value: PDF_LIMITS.maxFileBytes + 1 })
    await expect(
      openPdf(huge, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'file-too-large',
    })
    expect(pdfjs.getDocument).not.toHaveBeenCalled()
  })

  it('destroys the loading task when the document operation is cancelled', async () => {
    const { destroy } = mockDocument()
    const controller = new AbortController()
    const session = await openPdf(pdfFile(), controller.signal)
    controller.abort()
    await expect(session.getPageInfo(1)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('cancels an active render and frees resources without returning partial pixels', async () => {
    const { page } = mockDocument()
    let rejectRender!: (error: Error) => void
    const pending = new Promise<void>((_, reject) => {
      rejectRender = reject
    })
    const cancel = vi.fn(() => rejectRender(new Error('render cancelled')))
    page.render.mockReturnValue({ promise: pending, cancel })
    const session = await openPdf(pdfFile(), new AbortController().signal)
    const controller = new AbortController()
    const result = session.renderPage(1, 150, controller.signal)
    const rejection = expect(result).rejects.toMatchObject({
      name: 'AbortError',
    })
    await vi.waitFor(() => expect(page.render).toHaveBeenCalledOnce())
    controller.abort()
    await rejection
    expect(cancel).toHaveBeenCalledOnce()
    expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled()
    expect(page.cleanup).toHaveBeenCalledOnce()
    await session.destroy()
  })

  it('serializes thumbnail and high resolution rendering', async () => {
    const { page } = mockDocument()
    let finishRender!: () => void
    page.render.mockReturnValueOnce({
      promise: new Promise<void>((resolve) => {
        finishRender = resolve
      }),
      cancel: vi.fn(),
    })
    const signal = new AbortController().signal
    const session = await openPdf(pdfFile(), signal)
    const thumbnail = session.thumbnail(1, signal)
    const raster = session.renderPage(1, 300, signal)
    await vi.waitFor(() => expect(page.render).toHaveBeenCalledOnce())
    finishRender()
    await Promise.all([thumbnail, raster])
    expect(page.render).toHaveBeenCalledTimes(2)
    expect(page.cleanup).toHaveBeenCalledTimes(2)
    await session.destroy()
  })

  it('rejects oversized requested rasters before allocating a canvas', async () => {
    const { page } = mockDocument()
    const signal = new AbortController().signal
    const session = await openPdf(pdfFile(), signal)
    await expect(session.renderPage(1, 5000, signal)).rejects.toMatchObject({
      code: 'page-size-limit',
    })
    expect(page.render).not.toHaveBeenCalled()
    expect(page.cleanup).toHaveBeenCalledOnce()
    await session.destroy()
  })
})
