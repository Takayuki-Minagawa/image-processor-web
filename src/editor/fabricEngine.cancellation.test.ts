import { FabricImage } from 'fabric'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FabricEditorEngine,
  type FabricEditorCallbacks,
  type EditorSnapshot,
} from './fabricEngine'
import { CompactHistory } from './compactHistory'

const engines = new Set<FabricEditorEngine>()
const createEngine = (callbacks: FabricEditorCallbacks = {}) => {
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const engine = new FabricEditorEngine(canvas, {
    width: 200,
    height: 150,
    callbacks,
  })
  engines.add(engine)
  return engine
}

const image = () => ({ width: 2, height: 2, data: new Uint8ClampedArray(16) })

const decodedImage = () => {
  const source = document.createElement('canvas')
  source.width = 2
  source.height = 2
  return new FabricImage(source)
}

afterEach(async () => {
  await Promise.all([...engines].map((engine) => engine.dispose()))
  engines.clear()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('FabricEditorEngine image result cancellation', () => {
  it('rejects an already cancelled result before starting an import', async () => {
    const engine = createEngine()
    const importImage = vi.spyOn(engine, 'importImage')
    const controller = new AbortController()
    controller.abort()

    await expect(
      engine.addImageDataLayer(
        image(),
        'Cancelled',
        'filter',
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(importImage).not.toHaveBeenCalled()
    expect(engine.getLayers()).toHaveLength(0)
  })

  it('cancels decoding without changing document, selection, viewport, or staged filter state', async () => {
    const history = new CompactHistory<EditorSnapshot>()
    const onChanged = vi.fn(() => history.push(engine.snapshot()))
    const onSelectionChanged = vi.fn()
    const onLayersChanged = vi.fn()
    const onZoomChanged = vi.fn()
    const engine = createEngine({
      onChanged,
      onSelectionChanged,
      onLayersChanged,
      onZoomChanged,
    })
    const originalId = engine.addRect({ name: 'Original' })
    engine.getCanvas().setViewportTransform([2, 0, 0, 2, -30, -40])
    const before = engine.snapshot()
    const selectedBefore = engine.getCanvas().getActiveObject()
    const viewportBefore = [...engine.getCanvas().viewportTransform]
    onChanged.mockClear()
    onSelectionChanged.mockClear()
    onLayersChanged.mockClear()
    onZoomChanged.mockClear()
    let started!: () => void
    const decodingStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    let finishDecoding!: (value: FabricImage) => void
    const decoded = new Promise<FabricImage>((resolve) => {
      finishDecoding = resolve
    })
    vi.spyOn(FabricImage, 'fromURL').mockImplementation(() => {
      started()
      return decoded
    })
    const controller = new AbortController()
    const operation = engine.addImageDataLayer(
      image(),
      'Cancelled',
      'filter',
      controller.signal,
    )
    const rejection = expect(operation).rejects.toMatchObject({
      name: 'AbortError',
    })
    await decodingStarted
    expect(FabricImage.fromURL).toHaveBeenCalledWith(expect.any(String), {
      signal: controller.signal,
    })
    controller.abort()
    const cancelledImage = decodedImage()
    const dispose = vi.spyOn(cancelledImage, 'dispose')
    finishDecoding(cancelledImage)
    await rejection

    expect(engine.snapshot()).toEqual(before)
    expect(engine.getLayers()).toHaveLength(1)
    expect(engine.getLayers()[0].name).toBe('Original')
    expect(engine.getSelectedLayerIds()).toEqual([originalId])
    expect(engine.getCanvas().getActiveObject()).toBe(selectedBefore)
    expect(engine.getCanvas().viewportTransform).toEqual(viewportBefore)
    expect(onChanged).not.toHaveBeenCalled()
    // The UI reloads filters on selection events, so even a temporary empty
    // selection would lose the user's unapplied selection-only adjustments.
    expect(onSelectionChanged).not.toHaveBeenCalled()
    expect(onLayersChanged).not.toHaveBeenCalled()
    expect(onZoomChanged).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledOnce()
    expect(history.size).toBe(1)
    expect(history.canUndo).toBe(false)
  })

  it('publishes a completed result as one change when it is not cancelled', async () => {
    const onChanged = vi.fn()
    const onSelectionChanged = vi.fn()
    const engine = createEngine({ onChanged, onSelectionChanged })
    onSelectionChanged.mockClear()
    vi.spyOn(FabricImage, 'fromURL').mockResolvedValue(decodedImage())

    await engine.addImageDataLayer(
      image(),
      'Completed',
      'filter',
      new AbortController().signal,
    )

    expect(engine.getLayers()).toHaveLength(1)
    expect(engine.getLayers()[0].name).toBe('Completed')
    expect(onChanged).toHaveBeenCalledExactlyOnceWith('filter')
    expect(onSelectionChanged).toHaveBeenCalledOnce()
  })

  it('normalizes a decoder abort Event without reporting an image failure', async () => {
    const onSelectionChanged = vi.fn()
    const onStatus = vi.fn()
    const engine = createEngine({ onSelectionChanged, onStatus })
    const originalId = engine.addRect({ name: 'Original' })
    onSelectionChanged.mockClear()
    onStatus.mockClear()
    let started!: () => void
    const decodingStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    vi.spyOn(FabricImage, 'fromURL').mockImplementation((_url, options) => {
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', reject, { once: true })
        started()
      })
    })
    const controller = new AbortController()
    const operation = engine.addImageDataLayer(
      image(),
      'Cancelled',
      'filter',
      controller.signal,
    )
    const rejection = expect(operation).rejects.toMatchObject({
      name: 'AbortError',
    })
    await decodingStarted
    controller.abort()
    await rejection

    expect(engine.getSelectedLayerIds()).toEqual([originalId])
    expect(onSelectionChanged).not.toHaveBeenCalled()
    expect(onStatus).not.toHaveBeenCalled()
  })
})
