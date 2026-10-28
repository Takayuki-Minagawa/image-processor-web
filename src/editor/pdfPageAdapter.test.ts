import { FabricImage } from 'fabric'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPdfDesignPage, type PdfRasterPage } from './pdfPageAdapter'
import { FabricEditorEngine } from './fabricEngine'
import type { JsonObject } from './types'
import {
  createProjectDocument,
  parseProject,
  serializeProject,
} from './project'

const pngHeaderDataUrl = (width: number, height: number): string => {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`
}

const raster = (): PdfRasterPage => ({
  dataUrl: pngHeaderDataUrl(300, 200),
  width: 300,
  height: 200,
  widthMm: 76.2,
  heightMm: 50.8,
  pageNumber: 3,
  rotation: 90,
  dpi: 100,
})

const decodedImage = (input = raster()) => {
  const canvas = document.createElement('canvas')
  canvas.width = input.width
  canvas.height = input.height
  const image = new FabricImage(canvas)
  vi.spyOn(image, 'getSrc').mockReturnValue(input.dataUrl)
  return image
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('PDF raster page adapter', () => {
  it('creates an original-size locked layer and round-trips its geometry and provenance', async () => {
    vi.spyOn(FabricImage, 'fromURL').mockResolvedValue(decodedImage())
    const dispose = vi.spyOn(FabricEditorEngine.prototype, 'dispose')
    const page = await createPdfDesignPage(raster(), { id: 'pdf-page-3' })
    expect(page.id).toBe('pdf-page-3')
    expect(page.name).toBe('PDF 3')
    expect(page.snapshot).toMatchObject({ width: 300, height: 200 })
    expect(page.snapshot.json.objects).toEqual([
      expect.objectContaining({
        type: 'Image',
        editorLocked: true,
        left: 0,
        top: 0,
        scaleX: 1,
        scaleY: 1,
        width: 300,
        height: 200,
      }),
    ])
    expect(page.physicalSize).toEqual({
      unit: 'mm',
      widthMm: 76.2,
      heightMm: 50.8,
      sourceDpi: 100,
    })
    expect(page.snapshot.editorState?.pdfImport).toEqual({
      kind: 'rasterized-pdf',
      pageNumber: 3,
      widthMm: 76.2,
      heightMm: 50.8,
      rotation: 90,
      dpi: 100,
    })
    const project = createProjectDocument({
      canvasSize: { width: page.snapshot.width, height: page.snapshot.height },
      fabricCanvas: page.snapshot.json as JsonObject,
      editorState: page.snapshot.editorState,
      physicalSize: page.physicalSize,
    })
    expect(parseProject(serializeProject(project))).toEqual(project)
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('validates physical dimensions and image headers before decoding', async () => {
    const decode = vi.spyOn(FabricImage, 'fromURL')
    await expect(
      createPdfDesignPage({ ...raster(), widthMm: 210 }),
    ).rejects.toThrow(/does not match/u)
    await expect(
      createPdfDesignPage({ ...raster(), width: 200, height: 300 }),
    ).rejects.toThrow(/do not match/u)
    expect(decode).not.toHaveBeenCalled()
  })

  it('cancels preparation and disposes its offscreen engine without changing a live document', async () => {
    const live = new FabricEditorEngine(document.createElement('canvas'), {
      width: 100,
      height: 100,
    })
    const selected = live.addRect({ name: 'Original' })
    live.getCanvas().setViewportTransform([2, 0, 0, 2, -10, -20])
    const before = live.snapshot()
    const viewport = [...live.getCanvas().viewportTransform]
    const controller = new AbortController()
    const image = decodedImage()
    const imageDispose = vi.spyOn(image, 'dispose')
    vi.spyOn(FabricImage, 'fromURL').mockImplementation(async () => {
      controller.abort()
      return image
    })
    const dispose = vi.spyOn(FabricEditorEngine.prototype, 'dispose')
    try {
      await expect(
        createPdfDesignPage(raster(), { signal: controller.signal }),
      ).rejects.toMatchObject({ name: 'AbortError' })
      expect(dispose).toHaveBeenCalledOnce()
      expect(imageDispose).toHaveBeenCalledOnce()
      expect(live.snapshot()).toEqual(before)
      expect(live.getSelectedLayerIds()).toEqual([selected])
      expect(live.getCanvas().viewportTransform).toEqual(viewport)
    } finally {
      await live.dispose()
    }
  })

  it('rejects already cancelled preparation before allocating an engine', async () => {
    const controller = new AbortController()
    controller.abort()
    const decode = vi.spyOn(FabricImage, 'fromURL')
    const dispose = vi.spyOn(FabricEditorEngine.prototype, 'dispose')
    await expect(
      createPdfDesignPage(raster(), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(decode).not.toHaveBeenCalled()
    expect(dispose).not.toHaveBeenCalled()
  })

  it('honors cancellation while releasing the prepared page renderer', async () => {
    const controller = new AbortController()
    vi.spyOn(FabricImage, 'fromURL').mockResolvedValue(decodedImage())
    const originalDispose = FabricEditorEngine.prototype.dispose
    vi.spyOn(FabricEditorEngine.prototype, 'dispose').mockImplementation(
      async function (this: FabricEditorEngine) {
        await originalDispose.call(this)
        controller.abort()
      },
    )
    await expect(
      createPdfDesignPage(raster(), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
