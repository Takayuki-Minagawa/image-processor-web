import { afterEach, describe, expect, it, vi } from 'vitest'
import { FabricEditorEngine } from './fabricEngine'
import {
  calculateRasterExportDimensions,
  RasterExportError,
} from '../export/rasterImage'
import { parseImageDimensions } from '../lib/imageMetadata'

const engines = new Set<FabricEditorEngine>()

const createEngine = (width = 200, height = 150): FabricEditorEngine => {
  const element = document.createElement('canvas')
  document.body.append(element)
  const engine = new FabricEditorEngine(element, { width, height })
  engines.add(engine)
  return engine
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all([...engines].map((engine) => engine.dispose()))
  engines.clear()
  document.body.replaceChildren()
})

describe('raster export', () => {
  it('captures a bounded preview without changing the document, selection, viewport or status', async () => {
    const engine = createEngine(2_000, 1_001)
    const selected = engine.addRect({ fill: '#ff0000' })
    const canvas = engine.getCanvas()
    canvas.setDimensions({ width: 320, height: 240 })
    canvas.setViewportTransform([2, 0, 0, 2, 17, -23])
    const before = engine.snapshot()
    const onChanged = vi.fn()
    const onStatus = vi.fn()
    engine.setCallbacks({ onChanged, onStatus })
    const render = vi.spyOn(canvas, 'toCanvasElement')

    const preview = await engine.renderPreview(
      9_999,
      new AbortController().signal,
    )

    expect(preview).toMatchObject({ width: 1_600, height: 800 })
    expect(
      parseImageDimensions(
        Uint8Array.from(atob(preview.dataUrl.split(',')[1]), (character) =>
          character.charCodeAt(0),
        ),
        'image/png',
      ),
    ).toEqual({ width: 1_600, height: 800 })
    expect(engine.snapshot()).toEqual(before)
    expect(engine.getSelectedLayerIds()).toEqual([selected])
    expect(canvas.viewportTransform).toEqual([2, 0, 0, 2, 17, -23])
    expect([canvas.getWidth(), canvas.getHeight()]).toEqual([320, 240])
    expect(onChanged).not.toHaveBeenCalled()
    expect(onStatus).not.toHaveBeenCalled()
    const output = render.mock.results[0].value as HTMLCanvasElement
    expect([output.width, output.height]).toEqual([0, 0])
  })

  it.each([
    [1, 8_192],
    [8_192, 1],
  ])(
    'keeps a thin %s × %s preview nonempty and bounded',
    async (width, height) => {
      const engine = createEngine(width, height)
      const preview = await engine.renderPreview(
        1_600,
        new AbortController().signal,
      )
      expect(preview.width).toBe(width === 1 ? 1 : 1_600)
      expect(preview.height).toBe(height === 1 ? 1 : 1_600)
    },
  )

  it('does not upscale a small preview', async () => {
    const engine = createEngine()
    expect(
      await engine.renderPreview(1_600, new AbortController().signal),
    ).toMatchObject({ width: 200, height: 150 })
  })

  it('uses a small intermediate when a requested one-pixel preview would truncate an edge', async () => {
    const engine = createEngine(200, 100)
    const render = vi.spyOn(engine.getCanvas(), 'toCanvasElement')
    const preview = await engine.renderPreview(1, new AbortController().signal)
    expect(preview).toMatchObject({ width: 1, height: 1 })
    expect(render.mock.calls[0][0]).toBeCloseTo(0.01)
  })

  it('rejects cancellation before or while waiting for adjustments without rendering', async () => {
    const engine = createEngine()
    const controller = new AbortController()
    const wait = vi
      .spyOn(engine, 'waitForAdjustmentLayers')
      .mockImplementation(async () => {
        controller.abort()
      })
    const render = vi.spyOn(engine.getCanvas(), 'toCanvasElement')
    await expect(
      engine.renderPreview(1_600, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    await expect(
      engine.renderPreview(1_600, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(wait).toHaveBeenCalledOnce()
    expect(render).not.toHaveBeenCalled()
  })

  it('releases a preview rejected after encoding without changing the viewport', async () => {
    const engine = createEngine()
    const controller = new AbortController()
    const output = document.createElement('canvas')
    output.width = 200
    output.height = 150
    engine.getCanvas().setViewportTransform([2, 0, 0, 2, 17, -23])
    vi.spyOn(engine.getCanvas(), 'toCanvasElement').mockReturnValue(output)
    vi.spyOn(output, 'toDataURL').mockImplementation(() => {
      controller.abort()
      return 'data:image/png;base64,AA=='
    })
    await expect(
      engine.renderPreview(1_600, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect([output.width, output.height]).toEqual([0, 0])
    expect(engine.getCanvas().viewportTransform).toEqual([2, 0, 0, 2, 17, -23])
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid preview size %s before rendering',
    async (size) => {
      const engine = createEngine()
      const render = vi.spyOn(engine.getCanvas(), 'toCanvasElement')
      await expect(
        engine.renderPreview(size, new AbortController().signal),
      ).rejects.toThrow(RangeError)
      expect(render).not.toHaveBeenCalled()
    },
  )

  it.each(['exportDataUrl', 'exportBlob'] as const)(
    '%s uses the same truncated dimensions as the shared export preview',
    async (method) => {
      const engine = createEngine(201, 151)
      const output = await engine[method]('png', 1, 0.5)
      const bytes =
        typeof output === 'string'
          ? Uint8Array.from(atob(output.split(',')[1]), (character) =>
              character.charCodeAt(0),
            )
          : new Uint8Array(await output.arrayBuffer())
      const dimensions = calculateRasterExportDimensions(201, 151, 0.5)

      expect(dimensions).toEqual({ width: 100, height: 75 })
      expect(parseImageDimensions(bytes, 'image/png')).toEqual(dimensions)
    },
  )

  it.each(['exportDataUrl', 'exportBlob'] as const)(
    '%s rejects a fractional scale yielding a zero-pixel edge before rendering',
    async (method) => {
      const engine = createEngine(1, 151)
      const render = vi.spyOn(engine.getCanvas(), 'toCanvasElement')

      expect(calculateRasterExportDimensions(1, 151, 0.5)).toEqual({
        width: 0,
        height: 75,
      })
      await expect(engine[method]('png', 1, 0.5)).rejects.toMatchObject({
        code: 'image-dimension-limit',
      })
      expect(render).not.toHaveBeenCalled()
    },
  )

  it.each(['exportDataUrl', 'exportBlob'] as const)(
    '%s checks ordinary export dimensions before allocating a bitmap',
    async (method) => {
      const engine = createEngine(2_000, 150)
      const render = vi.spyOn(engine.getCanvas(), 'toCanvasElement')

      await expect(engine[method]('png', 1, 8)).rejects.toThrow(/safety limit/u)
      expect(render).not.toHaveBeenCalled()
    },
  )

  it('encodes the document at the requested scale regardless of its viewport', async () => {
    const engine = createEngine()
    const canvas = engine.getCanvas()
    canvas.setDimensions({ width: 320, height: 240 })
    canvas.setViewportTransform([0.5, 0, 0, 0.5, 23, -17])
    const snapshot = vi.spyOn(canvas, 'toCanvasElement')

    const blob = await engine.exportBlob('png', 1, 2)
    expect(blob.type).toBe('image/png')
    expect(
      parseImageDimensions(new Uint8Array(await blob.arrayBuffer()), blob.type),
    ).toEqual({
      width: 400,
      height: 300,
    })
    expect(canvas.viewportTransform).toEqual([0.5, 0, 0, 0.5, 23, -17])
    expect([canvas.getWidth(), canvas.getHeight()]).toEqual([320, 240])
    const output = snapshot.mock.results[0].value as HTMLCanvasElement
    expect([output.width, output.height]).toEqual([0, 0])
  })

  it('restores the editor while asynchronous Blob encoding is still pending', async () => {
    const engine = createEngine()
    const canvas = engine.getCanvas()
    canvas.setViewportTransform([2, 0, 0, 2, 17, -23])
    const output = document.createElement('canvas')
    output.width = 200
    output.height = 150
    let complete!: BlobCallback
    vi.spyOn(canvas, 'toCanvasElement').mockReturnValue(output)
    const encode = vi.spyOn(output, 'toBlob').mockImplementation((callback) => {
      complete = callback
    })

    const pending = engine.exportBlob()
    await vi.waitFor(() => expect(encode).toHaveBeenCalledOnce())
    expect(canvas.viewportTransform).toEqual([2, 0, 0, 2, 17, -23])
    expect(output.width).toBe(200)
    complete(new Blob(['encoded'], { type: 'image/png' }))
    await pending
    expect([output.width, output.height]).toEqual([0, 0])
  })

  it.each(['exportDataUrl', 'exportBlob'] as const)(
    '%s rejects a browser PNG fallback when WebP was requested and releases the canvas',
    async (method) => {
      const engine = createEngine()
      const output = document.createElement('canvas')
      vi.spyOn(engine.getCanvas(), 'toCanvasElement').mockReturnValue(output)
      vi.spyOn(output, 'toDataURL').mockReturnValue(
        'data:image/png;base64,AA==',
      )
      vi.spyOn(output, 'toBlob').mockImplementation((callback) => {
        callback(new Blob(['png'], { type: 'image/png' }))
      })

      await expect(engine[method]('webp')).rejects.toMatchObject({
        name: 'RasterExportError',
        code: 'unsupported-format',
        format: 'webp',
      })
      expect([output.width, output.height]).toEqual([0, 0])
    },
  )

  it('rejects a failed Blob encoder and releases the canvas', async () => {
    const engine = createEngine()
    const output = document.createElement('canvas')
    vi.spyOn(engine.getCanvas(), 'toCanvasElement').mockReturnValue(output)
    vi.spyOn(output, 'toBlob').mockImplementation((callback) => callback(null))

    await expect(engine.exportBlob()).rejects.toMatchObject({
      code: 'encoding-failed',
    })
    expect([output.width, output.height]).toEqual([0, 0])
  })

  it('rejects an empty data URL from the browser encoder', async () => {
    const engine = createEngine()
    const output = document.createElement('canvas')
    vi.spyOn(engine.getCanvas(), 'toCanvasElement').mockReturnValue(output)
    vi.spyOn(output, 'toDataURL').mockReturnValue('data:,')

    await expect(engine.exportDataUrl()).rejects.toBeInstanceOf(
      RasterExportError,
    )
    expect([output.width, output.height]).toEqual([0, 0])
  })

  it('restores viewport and Fabric flags when rendering throws midway', async () => {
    const engine = createEngine()
    const canvas = engine.getCanvas()
    canvas.setDimensions({ width: 320, height: 240 })
    canvas.setViewportTransform([2, 0, 0, 2, 17, -23])
    const retina = canvas.enableRetinaScaling
    const drawingState = canvas as unknown as { skipControlsDrawing: boolean }
    const controls = drawingState.skipControlsDrawing
    vi.spyOn(canvas, 'toCanvasElement').mockImplementation(() => {
      canvas.enableRetinaScaling = false
      drawingState.skipControlsDrawing = true
      canvas.width = 800
      canvas.height = 600
      canvas.viewportTransform = [4, 0, 0, 4, 0, 0]
      throw new Error('Rendering failed')
    })

    await expect(engine.exportBlob('png', 1, 2)).rejects.toThrow(
      'Rendering failed',
    )
    expect(canvas.viewportTransform).toEqual([2, 0, 0, 2, 17, -23])
    expect([canvas.getWidth(), canvas.getHeight()]).toEqual([320, 240])
    expect(canvas.enableRetinaScaling).toBe(retina)
    expect(drawingState.skipControlsDrawing).toBe(controls)
  })
})
