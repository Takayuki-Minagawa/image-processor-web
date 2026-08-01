import {
  ActiveSelection,
  Ellipse,
  FabricImage,
  IText,
  Path,
  Point,
  Rect,
  type FabricObject,
} from 'fabric'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FabricEditorEngine, type FabricEditorCallbacks } from './fabricEngine'
import { MAX_PROJECT_OBJECTS } from './snapshotValidation'
import { SelectionMask } from '../selection/mask'
import {
  createProjectDocument,
  parseProject,
  serializeProject,
} from './project'
import type { JsonObject } from './types'
import type { FilterOperation } from './filters/types'

const SERIALIZED_EDITOR_PROPERTIES = [
  'editorId',
  'editorName',
  'editorLocked',
] as const

const engines = new Set<FabricEditorEngine>()

const createEngine = (
  callbacks: FabricEditorCallbacks = {},
): FabricEditorEngine => {
  const element = document.createElement('canvas')
  document.body.append(element)
  const engine = new FabricEditorEngine(element, {
    width: 200,
    height: 150,
    callbacks,
  })
  engines.add(engine)
  return engine
}

afterEach(async () => {
  await Promise.all([...engines].map((engine) => engine.dispose()))
  engines.clear()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const pngHeaderDataUrl = (width: number, height: number): string => {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`
}

const objectRecord = (
  object: FabricObject,
): FabricObject & {
  editorId?: string
  editorName?: string
  editorLocked?: boolean
} => object

const serializeObject = (object: FabricObject): Record<string, unknown> =>
  object.toObject([...SERIALIZED_EDITOR_PROPERTIES]) as Record<string, unknown>

const deferred = <T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe('FabricEditorEngine export multiplier safety', () => {
  it('uses an exact multiplier above the interactive cap after validating output dimensions', async () => {
    const engine = createEngine()
    const toDataUrl = vi
      .spyOn(engine.getCanvas(), 'toDataURL')
      .mockReturnValue('data:image/png;base64,AA==')

    await engine.exportDataUrl('png', 1, 16, {
      exactSafeMultiplier: true,
    })

    expect(toDataUrl).toHaveBeenCalledWith(
      expect.objectContaining({ multiplier: 16 }),
    )
  })

  it('rejects an exact export multiplier outside the shared raster budget', async () => {
    const engine = createEngine()

    await expect(
      engine.exportDataUrl('png', 1, 50, { exactSafeMultiplier: true }),
    ).rejects.toThrow(/safety limit/u)
  })
})

describe('FabricEditorEngine top-left coordinates', () => {
  it('places generated rectangles, ellipses, and text at their requested bounds', () => {
    const engine = createEngine()

    engine.addRect({
      left: 10,
      top: 20,
      width: 40,
      height: 30,
      strokeWidth: 0,
    })
    engine.addEllipse({
      left: 60,
      top: 35,
      width: 50,
      height: 25,
      strokeWidth: 0,
    })
    engine.addText('Origin', {
      left: 25,
      top: 80,
      fontSize: 20,
    })

    const [rectangle, ellipse, text] = engine.getCanvas().getObjects()
    expect(rectangle).toBeInstanceOf(Rect)
    expect(ellipse).toBeInstanceOf(Ellipse)
    expect(text).toBeInstanceOf(IText)

    for (const [object, left, top] of [
      [rectangle, 10, 20],
      [ellipse, 60, 35],
      [text, 25, 80],
    ] as const) {
      expect(object.originX).toBe('left')
      expect(object.originY).toBe('top')
      expect(object.getBoundingRect().left).toBeCloseTo(left)
      expect(object.getBoundingRect().top).toBeCloseTo(top)
    }
  })

  it('places a decoded image at the top-left of an empty resized document', async () => {
    const engine = createEngine()
    const element = document.createElement('canvas')
    element.width = 20
    element.height = 10
    const image = new FabricImage(element, { width: 20, height: 10 })
    vi.spyOn(FabricImage, 'fromURL').mockResolvedValue(image)

    await expect(
      engine.importImage(pngHeaderDataUrl(20, 10), 'Photo', {
        resizeCanvasIfEmpty: true,
      }),
    ).resolves.toEqual(expect.any(String))

    expect(FabricImage.fromURL).toHaveBeenCalledOnce()
    expect(engine.getDocumentSize()).toEqual({ width: 20, height: 10 })
    expect(image.originX).toBe('left')
    expect(image.originY).toBe('top')
    expect(image.getBoundingRect()).toMatchObject({
      left: 0,
      top: 0,
      width: 20,
      height: 10,
    })
  })

  it('exposes a stable code when decoded image dimensions do not match the header', async () => {
    const engine = createEngine()
    const element = document.createElement('canvas')
    element.width = 21
    element.height = 10
    const decodedImage = new FabricImage(element, {
      width: 21,
      height: 10,
    })
    const disposeImage = vi.spyOn(decodedImage, 'dispose')
    vi.spyOn(FabricImage, 'fromURL').mockResolvedValue(decodedImage)

    await expect(
      engine.importImage(pngHeaderDataUrl(20, 10), 'Mismatched image'),
    ).rejects.toMatchObject({
      name: 'ImageSafetyError',
      code: 'image-dimension-mismatch',
    })
    expect(disposeImage).toHaveBeenCalledOnce()
    expect(engine.getCanvas().getObjects()).not.toContain(decodedImage)
  })

  it('normalizes restored origins and keeps restored layer names unique', async () => {
    const engine = createEngine()
    engine.setTool('eraser')

    const rectangle = new Rect({
      left: 25,
      top: 35,
      width: 20,
      height: 10,
      strokeWidth: 0,
    })
    objectRecord(rectangle).editorName = 'Restored layer'

    const path = new Path(
      [
        ['M', 0, 0],
        ['L', 20, 20],
      ],
      {
        left: 70,
        top: 45,
        fill: null,
        stroke: '#123456',
        strokeWidth: 2,
        opacity: 0.35,
        globalCompositeOperation: 'source-over',
      },
    )
    objectRecord(path).editorName = 'Restored layer'

    await engine.restore({
      width: 200,
      height: 150,
      json: {
        version: '7.4.0',
        objects: [serializeObject(rectangle), serializeObject(path)],
        background: 'transparent',
      },
    })

    const [restoredRectangle, restoredPath] = engine.getCanvas().getObjects()
    expect(restoredRectangle.originX).toBe('left')
    expect(restoredRectangle.originY).toBe('top')
    expect(restoredRectangle.getBoundingRect().left).toBeCloseTo(25)
    expect(restoredRectangle.getBoundingRect().top).toBeCloseTo(35)
    expect(restoredPath.originX).toBe('left')
    expect(restoredPath.originY).toBe('top')
    expect(restoredPath.getBoundingRect().left).toBeCloseTo(70)
    expect(restoredPath.getBoundingRect().top).toBeCloseTo(45)

    expect(restoredPath.globalCompositeOperation).toBe('source-over')
    expect(restoredPath.opacity).toBeCloseTo(0.35)
    expect(engine.getLayers().map(({ name }) => name)).toEqual([
      'Restored layer 2',
      'Restored layer',
    ])
  })

  it('keeps a newly drawn path in place and names the first stroke correctly', () => {
    const engine = createEngine()
    engine.setTool('brush')
    const path = new Path(
      [
        ['M', 15, 20],
        ['L', 45, 50],
      ],
      {
        fill: null,
        stroke: '#111827',
        strokeWidth: 4,
      },
    )
    const before = path.getBoundingRect()

    engine.getCanvas().add(path)

    expect(path.originX).toBe('left')
    expect(path.originY).toBe('top')
    expect(path.getBoundingRect()).toEqual(before)
    expect(engine.getLayers()[0].name).toBe('Brush stroke')
  })
})

describe('FabricEditorEngine pixel-selection edit semantics', () => {
  const leftHalfMask = (): SelectionMask => {
    const bytes = new Uint8Array(200 * 150)
    for (let y = 0; y < 150; y += 1) {
      bytes.fill(255, y * 200, y * 200 + 100)
    }
    return SelectionMask.fromBytes(200, 150, bytes)
  }

  const pixelAt = (
    engine: FabricEditorEngine,
    x: number,
    y: number,
  ): Promise<number[]> => {
    return engine.getDocumentImageData().then((image) => {
      const offset = (y * image.width + x) * 4
      return [...image.data.slice(offset, offset + 4)]
    })
  }

  const mockClipImageRestoration = (engine: FabricEditorEngine): void => {
    const sources = new Map<string, HTMLCanvasElement>()
    engine
      .getCanvas()
      .getObjects()
      .map(({ clipPath }) => clipPath)
      .filter((clip): clip is FabricImage => clip instanceof FabricImage)
      .forEach((clip) => {
        const source = String(
          (clip.toObject() as unknown as Record<string, unknown>).src,
        )
        const canvas = document.createElement('canvas')
        canvas.width = clip.width
        canvas.height = clip.height
        canvas.getContext('2d')?.drawImage(clip.getElement(), 0, 0)
        sources.set(source, canvas)
      })

    vi.spyOn(FabricImage, 'fromObject').mockImplementation(
      async (serialized) => {
        const record = serialized as Record<string, unknown>
        const source = sources.get(String(record.src))
        if (!source) {
          throw new Error('Unexpected clip image source.')
        }
        const canvas = document.createElement('canvas')
        canvas.width = source.width
        canvas.height = source.height
        canvas.getContext('2d')?.drawImage(source, 0, 0)
        return new FabricImage(
          canvas,
          record as ConstructorParameters<typeof FabricImage>[1],
        )
      },
    )
  }

  it('clips brush strokes to the mask captured when the stroke is drawn', async () => {
    const engine = createEngine()
    expect(engine.setPixelSelectionMask(leftHalfMask())).toBe(true)
    engine.setTool('brush', { color: '#ef4444', size: 12, opacity: 1 })
    const path = new Path(
      [
        ['M', 20, 75],
        ['L', 180, 75],
      ],
      {
        fill: null,
        stroke: '#ef4444',
        strokeWidth: 12,
        strokeLineCap: 'round',
      },
    )

    engine.getCanvas().add(path)

    expect(path.clipPath?.type).toBe('image')
    expect(await pixelAt(engine, 50, 75)).toEqual([239, 68, 68, 255])
    expect((await pixelAt(engine, 150, 75))[3]).toBe(0)

    const drawn = engine.snapshot()
    expect(
      (drawn.json.objects as Array<Record<string, unknown>>)[0],
    ).toMatchObject({
      clipPath: {
        type: 'Image',
        absolutePositioned: true,
        src: expect.stringMatching(/^data:image\/png;base64,/),
      },
    })

    expect(engine.setPixelSelectionMask(SelectionMask.full(200, 150))).toBe(
      true,
    )
    expect((await pixelAt(engine, 150, 75))[3]).toBe(0)

    mockClipImageRestoration(engine)
    await engine.restore(drawn)
    expect(await pixelAt(engine, 50, 75)).toEqual([239, 68, 68, 255])
    expect((await pixelAt(engine, 150, 75))[3]).toBe(0)
  })

  it('clips eraser strokes so pixels outside the mask stay intact', async () => {
    const engine = createEngine()
    engine.addRect({
      left: 0,
      top: 0,
      width: 200,
      height: 150,
      fill: '#2563eb',
      strokeWidth: 0,
    })
    expect(engine.setPixelSelectionMask(leftHalfMask())).toBe(true)
    engine.setTool('eraser', { size: 12, opacity: 1 })
    const path = new Path(
      [
        ['M', 20, 75],
        ['L', 180, 75],
      ],
      {
        fill: null,
        stroke: '#000000',
        strokeWidth: 12,
        strokeLineCap: 'round',
      },
    )

    engine.getCanvas().add(path)

    expect(path.globalCompositeOperation).toBe('destination-out')
    expect(path.clipPath?.type).toBe('image')
    expect((await pixelAt(engine, 50, 75))[3]).toBe(0)
    expect(await pixelAt(engine, 150, 75)).toEqual([37, 99, 235, 255])
  })

  it('adds a serializable, undoable pixel deletion layer for the mask only', async () => {
    const onChanged = vi.fn()
    const engine = createEngine({ onChanged })
    engine.addRect({
      left: 0,
      top: 0,
      width: 200,
      height: 150,
      fill: '#16a34a',
      strokeWidth: 0,
      name: 'Base',
    })
    expect(engine.setPixelSelectionMask(leftHalfMask())).toBe(true)
    const before = engine.snapshot()
    onChanged.mockClear()

    const deletionId = engine.deleteSelectedPixels()

    expect(deletionId).toEqual(expect.any(String))
    expect(onChanged).toHaveBeenCalledOnce()
    expect(onChanged).toHaveBeenCalledWith('pixel-delete')
    expect(engine.getLayers()[0]).toMatchObject({
      id: deletionId,
      name: 'Pixel deletion',
      type: 'pixel-delete',
      locked: true,
    })
    expect((await pixelAt(engine, 50, 75))[3]).toBe(0)
    expect(await pixelAt(engine, 150, 75)).toEqual([22, 163, 74, 255])

    const deleted = engine.snapshot()
    expect(
      (deleted.json.objects as Array<Record<string, unknown>>).at(-1),
    ).toMatchObject({
      editorKind: 'pixel-delete',
      globalCompositeOperation: 'destination-out',
      clipPath: {
        type: 'Image',
        width: 100,
        height: 150,
        src: expect.stringMatching(/^data:image\/png;base64,/),
      },
    })

    expect(engine.setPixelSelectionMask(undefined)).toBe(true)
    expect((await pixelAt(engine, 50, 75))[3]).toBe(0)

    mockClipImageRestoration(engine)
    await engine.restore(before)
    expect(await pixelAt(engine, 50, 75)).toEqual([22, 163, 74, 255])
    await engine.restore(deleted)
    expect((await pixelAt(engine, 50, 75))[3]).toBe(0)
    expect(await pixelAt(engine, 150, 75)).toEqual([22, 163, 74, 255])
  })

  it('does not create a deletion layer for a missing or empty pixel mask', () => {
    const onChanged = vi.fn()
    const engine = createEngine({ onChanged })

    expect(engine.deleteSelectedPixels()).toBeNull()
    expect(engine.setPixelSelectionMask(SelectionMask.empty(200, 150))).toBe(
      true,
    )
    onChanged.mockClear()
    expect(engine.deleteSelectedPixels()).toBeNull()
    expect(engine.getCanvas().getObjects()).toHaveLength(0)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('preserves 8-bit feather alpha when deleting selected pixels', async () => {
    const engine = createEngine()
    engine.addRect({
      left: 0,
      top: 0,
      width: 200,
      height: 150,
      fill: '#ffffff',
      strokeWidth: 0,
    })
    expect(
      engine.setPixelSelectionMask(SelectionMask.full(200, 150, 128)),
    ).toBe(true)

    expect(engine.deleteSelectedPixels()).toEqual(expect.any(String))
    expect((await pixelAt(engine, 100, 75))[3]).toBe(127)
  })
})

describe('FabricEditorEngine transactional restore', () => {
  const assertCanvasIdentity = (
    engine: FabricEditorEngine,
    expectedObjects: FabricObject[],
    expectedSelection: FabricObject | undefined,
    expectedClip: FabricObject | undefined,
    expectedViewportTransform: number[],
  ) => {
    const actualObjects = engine.getCanvas().getObjects()
    expect(actualObjects).toHaveLength(expectedObjects.length)
    actualObjects.forEach((object, index) => {
      expect(object).toBe(expectedObjects[index])
    })
    expect(engine.getCanvas().getActiveObject()).toBe(expectedSelection)
    expect(engine.getCanvas().clipPath).toBe(expectedClip)
    expect(engine.getCanvas().viewportTransform).toEqual(
      expectedViewportTransform,
    )
  }

  it('leaves the canvas completely unchanged when validation fails', async () => {
    const engine = createEngine()
    const firstId = engine.addRect({ left: 10, top: 10 })
    const secondId = engine.addEllipse({ left: 60, top: 40 })
    engine.selectLayer(firstId)
    engine.selectLayer(secondId, true)
    engine.getCanvas().setZoom(2)

    const objects = engine.getCanvas().getObjects()
    const selection = engine.getCanvas().getActiveObject()
    const clip = engine.getCanvas().clipPath
    const viewportTransform = [...engine.getCanvas().viewportTransform]
    expect(selection).toBeInstanceOf(ActiveSelection)

    await expect(
      engine.restore({
        width: 200,
        height: 150,
        json: {
          objects: Array.from({ length: MAX_PROJECT_OBJECTS + 1 }, () => ({
            type: 'Rect',
          })),
        },
      }),
    ).rejects.toThrow(`at most ${MAX_PROJECT_OBJECTS}`)

    assertCanvasIdentity(engine, objects, selection, clip, viewportTransform)
  })

  it('leaves selection and clip untouched when Fabric enlivening fails', async () => {
    const engine = createEngine()
    const backgroundElement = document.createElement('canvas')
    backgroundElement.width = 2
    backgroundElement.height = 2
    const preparedBackground = new FabricImage(backgroundElement)
    const disposePreparedBackground = vi.spyOn(preparedBackground, 'dispose')
    vi.spyOn(FabricImage, 'fromObject').mockResolvedValue(preparedBackground)
    const firstId = engine.addRect({ left: 10, top: 10 })
    const secondId = engine.addEllipse({ left: 60, top: 40 })
    engine.selectLayer(firstId)
    engine.selectLayer(secondId, true)
    engine.getCanvas().setZoom(2)

    const objects = engine.getCanvas().getObjects()
    const selection = engine.getCanvas().getActiveObject()
    const clip = engine.getCanvas().clipPath
    const viewportTransform = [...engine.getCanvas().viewportTransform]

    await expect(
      engine.restore({
        width: 200,
        height: 150,
        json: {
          objects: [{ type: 'UnknownPixelweaveLayer' }],
          backgroundImage: {
            type: 'Image',
            src: pngHeaderDataUrl(2, 2),
          },
        },
      }),
    ).rejects.toThrow()

    assertCanvasIdentity(engine, objects, selection, clip, viewportTransform)
    expect(engine.getCanvas().renderOnAddRemove).toBe(true)
    expect(disposePreparedBackground).toHaveBeenCalledOnce()
  })

  it('disposes canvas resources replaced by a successful restore', async () => {
    const engine = createEngine()
    engine.addRect({ name: 'Replaced layer' })
    const replaced = engine.getCanvas().getObjects()[0]
    const disposeReplaced = vi.spyOn(replaced, 'dispose')
    const backgroundElement = document.createElement('canvas')
    backgroundElement.width = 2
    backgroundElement.height = 2
    const replacedBackground = new FabricImage(backgroundElement)
    const disposeBackground = vi.spyOn(replacedBackground, 'dispose')
    engine.getCanvas().backgroundImage = replacedBackground
    const replacement = new Ellipse({
      originX: 'left',
      originY: 'top',
      left: 30,
      top: 25,
      rx: 15,
      ry: 10,
    })

    await engine.restore({
      width: 120,
      height: 90,
      json: {
        objects: [serializeObject(replacement)],
        background: 'transparent',
      },
    })

    expect(disposeReplaced).toHaveBeenCalledOnce()
    expect(disposeBackground).toHaveBeenCalledOnce()
    expect(engine.getCanvas().getObjects()).toHaveLength(1)
    expect(engine.getCanvas().getObjects()[0]).not.toBe(replaced)
  })

  it('rolls back view state and disposes incoming resources after apply starts', async () => {
    const onSelectionChanged = vi.fn()
    const onZoomChanged = vi.fn()
    const engine = createEngine({ onSelectionChanged, onZoomChanged })
    const firstId = engine.addRect({
      left: 15,
      top: 25,
      width: 30,
      height: 20,
      name: 'Before',
      strokeWidth: 0,
    })
    const secondId = engine.addEllipse({
      left: 55,
      top: 45,
      width: 25,
      height: 20,
      name: 'Also before',
      strokeWidth: 0,
    })
    engine.selectLayer(firstId)
    engine.selectLayer(secondId, true)
    engine.getCanvas().setViewportTransform([2, 0, 0, 2, 17, -9])
    const before = engine.snapshot()
    const selectedBefore = engine.getSelectedLayerIds()
    const viewportBefore = [...engine.getCanvas().viewportTransform]
    onSelectionChanged.mockClear()
    onZoomChanged.mockClear()
    const replacement = new Ellipse({
      originX: 'left',
      originY: 'top',
      left: 80,
      top: 60,
      rx: 20,
      ry: 15,
    })

    const internals = engine as unknown as {
      setDocumentClip: () => void
    }
    const disposeIncoming = vi.fn()
    vi.spyOn(internals, 'setDocumentClip').mockImplementationOnce(() => {
      const incoming = engine.getCanvas().getObjects()[0]
      vi.spyOn(incoming, 'dispose').mockImplementation(disposeIncoming)
      throw new Error('apply failed')
    })

    await expect(
      engine.restore({
        width: 120,
        height: 90,
        json: {
          objects: [serializeObject(replacement)],
          background: 'transparent',
        },
      }),
    ).rejects.toThrow('apply failed')

    expect(engine.snapshot()).toEqual(before)
    expect(engine.getSelectedLayerIds()).toEqual(selectedBefore)
    expect(engine.getCanvas().viewportTransform).toEqual(viewportBefore)
    expect(disposeIncoming).toHaveBeenCalledOnce()
    expect(onSelectionChanged).toHaveBeenLastCalledWith(selectedBefore)
    expect(onZoomChanged).toHaveBeenLastCalledWith(2)
  })
})

describe('FabricEditorEngine asynchronous clipboard operations', () => {
  it('cuts the selection captured before cloning instead of a later selection', async () => {
    const engine = createEngine()
    const originalId = engine.addRect({ name: 'Original' })
    const laterId = engine.addEllipse({ name: 'Later' })
    engine.selectLayer(originalId)

    const original = engine
      .getCanvas()
      .getObjects()
      .find((object) => objectRecord(object).editorId === originalId)!
    const delayedClone = (await original.clone([
      ...SERIALIZED_EDITOR_PROPERTIES,
    ])) as FabricObject
    const clone = deferred<FabricObject>()
    vi.spyOn(original, 'clone').mockReturnValue(clone.promise)

    const pendingCut = engine.cutSelection()
    engine.selectLayer(laterId)
    clone.resolve(delayedClone)

    await expect(pendingCut).resolves.toBe(true)
    expect(
      engine
        .getCanvas()
        .getObjects()
        .map((object) => objectRecord(object).editorId),
    ).toEqual([laterId])
  })

  it('keeps the prior clipboard when the cut target disappears', async () => {
    const engine = createEngine()
    const clipboardId = engine.addEllipse({ name: 'Clipboard ellipse' })
    engine.selectLayer(clipboardId)
    await engine.copySelection()

    const targetId = engine.addRect({ name: 'Transient rectangle' })
    const target = engine
      .getCanvas()
      .getObjects()
      .find((object) => objectRecord(object).editorId === targetId)!
    const delayedClone = (await target.clone([
      ...SERIALIZED_EDITOR_PROPERTIES,
    ])) as FabricObject
    const clone = deferred<FabricObject>()
    vi.spyOn(target, 'clone').mockReturnValue(clone.promise)

    const pendingCut = engine.cutSelection()
    expect(engine.deleteSelection()).toBe(true)
    clone.resolve(delayedClone)

    await expect(pendingCut).resolves.toBe(false)
    await engine.pasteSelection()
    expect(engine.getCanvas().getObjects().at(-1)).toBeInstanceOf(Ellipse)
  })

  it('rejects a copy that finishes after disposal and disposes its clone', async () => {
    const engine = createEngine()
    engine.addRect({ name: 'Disposable' })
    const source = engine.getCanvas().getActiveObjects()[0]
    const delayedClone = (await source.clone([
      ...SERIALIZED_EDITOR_PROPERTIES,
    ])) as FabricObject
    const disposeClone = vi.spyOn(delayedClone, 'dispose')
    const clone = deferred<FabricObject>()
    vi.spyOn(source, 'clone').mockReturnValue(clone.promise)

    const pendingCopy = engine.copySelection()
    const pendingDispose = engine.dispose()
    clone.resolve(delayedClone)

    await expect(pendingCopy).rejects.toThrow('disposed')
    await pendingDispose
    expect(disposeClone).toHaveBeenCalledOnce()
  })

  it('rejects a duplicate that finishes after disposal and disposes its clone', async () => {
    const engine = createEngine()
    engine.addRect({ name: 'Disposable duplicate' })
    const source = engine.getCanvas().getActiveObjects()[0]
    const delayedClone = (await source.clone([
      ...SERIALIZED_EDITOR_PROPERTIES,
    ])) as FabricObject
    const disposeClone = vi.spyOn(delayedClone, 'dispose')
    const clone = deferred<FabricObject>()
    vi.spyOn(source, 'clone').mockReturnValue(clone.promise)

    const pendingDuplicate = engine.duplicateSelection()
    const pendingDispose = engine.dispose()
    clone.resolve(delayedClone)

    await expect(pendingDuplicate).rejects.toThrow('disposed')
    await pendingDispose
    expect(disposeClone).toHaveBeenCalledOnce()
  })

  it('rejects a paste that finishes after disposal and disposes its clone', async () => {
    const engine = createEngine()
    engine.addRect({ name: 'Disposable paste' })
    await engine.copySelection()
    const clipboardSource = (engine as unknown as { clipboard: FabricObject[] })
      .clipboard[0]
    const delayedClone = (await clipboardSource.clone([
      ...SERIALIZED_EDITOR_PROPERTIES,
    ])) as FabricObject
    const disposeClone = vi.spyOn(delayedClone, 'dispose')
    const clone = deferred<FabricObject>()
    vi.spyOn(clipboardSource, 'clone').mockReturnValue(clone.promise)

    const pendingPaste = engine.pasteSelection()
    const pendingDispose = engine.dispose()
    clone.resolve(delayedClone)

    await expect(pendingPaste).rejects.toThrow('disposed')
    await pendingDispose
    expect(disposeClone).toHaveBeenCalledOnce()
  })

  it('does not suppress unrelated canvas events while grouped clones await', async () => {
    const onChanged = vi.fn()
    const engine = createEngine({ onChanged })
    const firstId = engine.addRect({ left: 10, top: 10 })
    const secondId = engine.addEllipse({ left: 60, top: 40 })
    const [first, second] = engine.getCanvas().getObjects()
    const firstClone = (await first.clone([
      ...SERIALIZED_EDITOR_PROPERTIES,
    ])) as FabricObject
    const secondClone = (await second.clone([
      ...SERIALIZED_EDITOR_PROPERTIES,
    ])) as FabricObject
    engine.selectLayer(firstId)
    engine.selectLayer(secondId, true)
    expect(engine.getCanvas().getActiveObject()).toBeInstanceOf(ActiveSelection)

    const firstDeferred = deferred<FabricObject>()
    const secondDeferred = deferred<FabricObject>()
    vi.spyOn(first, 'clone').mockReturnValue(firstDeferred.promise)
    vi.spyOn(second, 'clone').mockReturnValue(secondDeferred.promise)
    onChanged.mockClear()

    const pendingCopy = engine.copySelection()
    engine.getCanvas().add(
      new Rect({
        originX: 'left',
        originY: 'top',
        left: 120,
        top: 90,
        width: 10,
        height: 10,
      }),
    )

    expect(onChanged).toHaveBeenCalledWith('object-added')
    firstDeferred.resolve(firstClone)
    secondDeferred.resolve(secondClone)
    await pendingCopy
    expect(engine.getCanvas().getActiveObjects()).toEqual([first, second])
  })

  it('does not restore a stale grouped selection after the document is cleared', async () => {
    const engine = createEngine()
    const firstId = engine.addRect({ left: 10, top: 10 })
    const secondId = engine.addEllipse({ left: 60, top: 40 })
    const [first, second] = engine.getCanvas().getObjects()
    const firstClone = (await first.clone([
      ...SERIALIZED_EDITOR_PROPERTIES,
    ])) as FabricObject
    const secondClone = (await second.clone([
      ...SERIALIZED_EDITOR_PROPERTIES,
    ])) as FabricObject
    engine.selectLayer(firstId)
    engine.selectLayer(secondId, true)

    const firstDeferred = deferred<FabricObject>()
    const secondDeferred = deferred<FabricObject>()
    vi.spyOn(first, 'clone').mockReturnValue(firstDeferred.promise)
    vi.spyOn(second, 'clone').mockReturnValue(secondDeferred.promise)

    const pendingCopy = engine.copySelection()
    engine.clear()
    firstDeferred.resolve(firstClone)
    secondDeferred.resolve(secondClone)

    await pendingCopy
    expect(engine.getCanvas().getObjects()).toHaveLength(0)
    expect(engine.getCanvas().getActiveObjects()).toHaveLength(0)
  })

  it('does not reselect a layer that becomes locked while clones await', async () => {
    const engine = createEngine()
    const firstId = engine.addRect({ left: 10, top: 10 })
    const secondId = engine.addEllipse({ left: 60, top: 40 })
    const [first, second] = engine.getCanvas().getObjects()
    const firstClone = (await first.clone([
      ...SERIALIZED_EDITOR_PROPERTIES,
    ])) as FabricObject
    const secondClone = (await second.clone([
      ...SERIALIZED_EDITOR_PROPERTIES,
    ])) as FabricObject
    engine.selectLayer(firstId)
    engine.selectLayer(secondId, true)

    const firstDeferred = deferred<FabricObject>()
    const secondDeferred = deferred<FabricObject>()
    vi.spyOn(first, 'clone').mockReturnValue(firstDeferred.promise)
    vi.spyOn(second, 'clone').mockReturnValue(secondDeferred.promise)

    const pendingCopy = engine.copySelection()
    expect(engine.setLayerLocked(firstId, true)).toBe(true)
    firstDeferred.resolve(firstClone)
    secondDeferred.resolve(secondClone)

    await pendingCopy
    expect(first.selectable).toBe(false)
    expect(engine.getCanvas().getActiveObjects()).toHaveLength(0)
  })

  it('disposes successful clones when another grouped clone fails', async () => {
    const engine = createEngine()
    const firstId = engine.addRect({ left: 10, top: 10 })
    const secondId = engine.addEllipse({ left: 60, top: 40 })
    const [first, second] = engine.getCanvas().getObjects()
    const firstClone = (await first.clone([
      ...SERIALIZED_EDITOR_PROPERTIES,
    ])) as FabricObject
    const disposeClone = vi.spyOn(firstClone, 'dispose')
    engine.selectLayer(firstId)
    engine.selectLayer(secondId, true)

    vi.spyOn(first, 'clone').mockResolvedValue(firstClone)
    vi.spyOn(second, 'clone').mockRejectedValue(new Error('clone failed'))

    await expect(engine.copySelection()).rejects.toThrow('clone failed')
    expect(disposeClone).toHaveBeenCalledOnce()
    expect(engine.getCanvas().getActiveObjects()).toEqual([first, second])
  })
})

describe('FabricEditorEngine layer lookup', () => {
  it('stops normalizing after the requested layer is found', () => {
    const engine = createEngine()
    const firstId = engine.addRect({ name: 'First' })
    engine.addRect({ name: 'Second' })
    const second = engine.getCanvas().getObjects()[1]
    objectRecord(second).editorName = undefined

    expect(engine.selectLayer(firstId)).toBe(true)
    expect(objectRecord(second).editorName).toBeUndefined()
  })
})

describe('FabricEditorEngine feature expansion', () => {
  it('applies an extracted palette color to only the requested paint target', () => {
    const engine = createEngine()
    engine.addRect({
      fill: '#102030',
      stroke: '#405060',
      strokeWidth: 4,
    })

    expect(engine.setSelectionColor('#abcdef', 'stroke')).toBe(true)
    expect(engine.getCanvas().getActiveObject()).toMatchObject({
      fill: '#102030',
      stroke: '#abcdef',
    })
    expect(engine.setSelectionColor('#fedcba', 'fill')).toBe(true)
    expect(engine.getCanvas().getActiveObject()).toMatchObject({
      fill: '#fedcba',
      stroke: '#abcdef',
    })
  })

  it('stores guides in snapshots and restores them with one document state', async () => {
    const engine = createEngine()
    expect(engine.addGuide('x', 40)).toBe(true)
    expect(engine.addGuide('y', 60)).toBe(true)
    expect(engine.setSnapTolerance(12)).toBe(12)
    const snapshot = engine.snapshot()

    expect(snapshot.editorState).toEqual({
      guides: [
        { axis: 'x', position: 40 },
        { axis: 'y', position: 60 },
      ],
      snapTolerance: 12,
    })

    engine.clearGuides()
    await engine.restore(snapshot)
    expect(engine.getEditorState()).toEqual(snapshot.editorState)
  })

  it('creates a guide at the document coordinate where a ruler drag ends', () => {
    const engine = createEngine()
    vi.spyOn(engine.getCanvas(), 'getScenePoint').mockReturnValue(
      new Point(73, 91),
    )

    expect(engine.addGuideFromPointer('x', new MouseEvent('dragend'))).toBe(
      true,
    )
    expect(engine.addGuideFromPointer('y', new MouseEvent('dragend'))).toBe(
      true,
    )
    expect(engine.getEditorState().guides).toEqual([
      { axis: 'x', position: 73 },
      { axis: 'y', position: 91 },
    ])
  })

  it('animates the main-canvas selection boundary only while a mask exists', async () => {
    const engine = createEngine()
    const requestRender = vi.spyOn(engine.getCanvas(), 'requestRenderAll')
    expect(engine.setPixelSelectionMask(SelectionMask.full(200, 150))).toBe(
      true,
    )
    requestRender.mockClear()

    await new Promise((resolve) => globalThis.setTimeout(resolve, 140))
    expect(requestRender).toHaveBeenCalled()

    expect(engine.setPixelSelectionMask(undefined)).toBe(true)
    requestRender.mockClear()
    await new Promise((resolve) => globalThis.setTimeout(resolve, 160))
    expect(requestRender).not.toHaveBeenCalled()
  })

  it('aligns and distributes a multi-selection as one mutation', () => {
    const onChanged = vi.fn()
    const engine = createEngine({ onChanged })
    const firstId = engine.addRect({
      left: 10,
      top: 15,
      width: 20,
      height: 20,
      strokeWidth: 0,
    })
    const secondId = engine.addRect({
      left: 70,
      top: 45,
      width: 20,
      height: 20,
      strokeWidth: 0,
    })
    const thirdId = engine.addRect({
      left: 150,
      top: 80,
      width: 20,
      height: 20,
      strokeWidth: 0,
    })
    engine.selectLayer(firstId)
    engine.selectLayer(secondId, true)
    engine.selectLayer(thirdId, true)
    onChanged.mockClear()

    expect(engine.alignSelection('top')).toBe(true)
    expect(
      engine
        .getCanvas()
        .getActiveObjects()
        .map((object) => object.getBoundingRect().top),
    ).toEqual([15, 15, 15])
    expect(onChanged).toHaveBeenCalledOnce()
    expect(onChanged).toHaveBeenLastCalledWith('alignment')

    expect(engine.alignSelection('distribute-x')).toBe(true)
    const lefts = engine
      .getCanvas()
      .getActiveObjects()
      .map((object) => object.getBoundingRect().left)
      .sort((left, right) => left - right)
    expect(lefts[1] - lefts[0]).toBeCloseTo(lefts[2] - lefts[1])
  })

  it('imports a supported SVG as one vector layer and exports the selection', async () => {
    const engine = createEngine()
    const id = await engine.importSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect width="40" height="20" fill="#7c3aed"/></svg>',
      'Vector mark',
    )

    expect(engine.getLayers()).toEqual([
      expect.objectContaining({
        id,
        name: 'Vector mark',
      }),
    ])
    const exported = await engine.exportSvg('selection')
    expect(exported).toContain('<svg')
    expect(exported).toContain('Vector mark')
    expect(exported).toContain('rgb(124,58,237)')
  })

  it('keeps gradient, outline, shadow, spacing, and arc text serializable', () => {
    const engine = createEngine()
    engine.addText('Pixelweave')
    expect(
      engine.setSelectedTextStyle({
        stroke: '#ffffff',
        strokeWidth: 4,
        gradient: {
          start: '#7c3aed',
          end: '#22d3ee',
          angle: 30,
        },
        shadow: {
          color: 'rgba(0,0,0,0.5)',
          blur: 12,
          offsetX: 4,
          offsetY: 6,
        },
        charSpacing: 120,
        lineHeight: 1.4,
      }),
    ).toBe(true)
    expect(engine.setSelectedTextArc(80)).toBe(true)

    const [serialized] = engine.snapshot().json.objects as Array<
      Record<string, unknown>
    >
    expect(serialized).toMatchObject({
      stroke: '#ffffff',
      strokeWidth: 4,
      charSpacing: 120,
      lineHeight: 1.4,
      paintFirst: 'stroke',
    })
    expect(serialized.fill).toMatchObject({ type: 'linear' })
    expect(serialized.shadow).toMatchObject({
      blur: 12,
      offsetX: 4,
      offsetY: 6,
    })
    expect(serialized.path).toMatchObject({ type: 'Path' })
  })

  it('uses the first gradient stop as a valid solid-fill fallback', () => {
    const engine = createEngine()
    engine.addText('Gradient fallback', { fill: '#123456' })
    expect(
      engine.setSelectedTextStyle({
        gradient: {
          start: '#1d4ed8',
          end: '#22d3ee',
        },
      }),
    ).toBe(true)

    const gradientStyle = engine.getSelectedTextStyle()
    expect(gradientStyle).toMatchObject({
      fill: '#1d4ed8',
      gradient: {
        start: '#1d4ed8',
        end: '#22d3ee',
      },
    })
    expect(gradientStyle?.fill).not.toBe('[object Object]')

    expect(
      engine.setSelectedTextStyle({
        gradient: null,
        fill: gradientStyle?.fill,
      }),
    ).toBe(true)
    expect(engine.getSelectedTextStyle()).toMatchObject({
      fill: '#1d4ed8',
      gradient: null,
    })
  })

  it('commits a successful transaction once and rolls a failed one back', async () => {
    const onChanged = vi.fn()
    const engine = createEngine({ onChanged })
    onChanged.mockClear()

    await engine.runAtomic('macro', () => {
      engine.addRect({ name: 'Macro rectangle' })
      engine.addText('Macro text')
    })
    expect(engine.getCanvas().getObjects()).toHaveLength(2)
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenLastCalledWith('macro')

    const before = engine.snapshot()
    await expect(
      engine.runAtomic('script', () => {
        engine.addEllipse({ name: 'Rolled back' })
        throw new Error('script failed')
      }),
    ).rejects.toThrow('script failed')
    expect(engine.snapshot()).toEqual(before)
  })

  it('allows a nested atomic operation to join the active transaction', async () => {
    const onChanged = vi.fn()
    const engine = createEngine({ onChanged })
    onChanged.mockClear()

    await engine.runAtomic('macro', async () => {
      engine.addRect({ name: 'Outer operation' })
      await engine.runAtomic('asset', () => {
        engine.addEllipse({ name: 'Nested operation' })
      })
    })

    expect(engine.getLayers().map(({ name }) => name)).toEqual([
      'Nested operation',
      'Outer operation',
    ])
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenLastCalledWith('macro')
  })

  it('does not deadlock background image insertion inside an atomic operation', async () => {
    const engine = createEngine()
    vi.spyOn(engine, 'importImage').mockResolvedValue('background-layer')

    await expect(
      engine.runAtomic('background-removal', () =>
        engine.addImageDataLayer({
          width: 4,
          height: 4,
          data: new Uint8ClampedArray(4 * 4 * 4).fill(255),
        }),
      ),
    ).resolves.toBe('background-layer')
  })

  it('isolates concurrent atomic operations across a rollback', async () => {
    const engine = createEngine()
    const gate = deferred<void>()
    const first = engine.runAtomic('macro', async () => {
      engine.addRect({ name: 'Will roll back' })
      await gate.promise
      throw new Error('first operation failed')
    })
    const second = engine.runAtomic('script', () => {
      engine.addEllipse({ name: 'Independent operation' })
    })

    await Promise.resolve()
    expect(engine.getLayers().map(({ name }) => name)).toEqual([
      'Will roll back',
    ])
    gate.resolve()
    await expect(first).rejects.toThrow('first operation failed')
    await expect(second).resolves.toBeUndefined()
    expect(engine.getLayers().map(({ name }) => name)).toEqual([
      'Independent operation',
    ])
  })

  it('persists an immutable pixel selection and clears it after resizing', () => {
    const engine = createEngine()
    const bytes = new Uint8Array(200 * 150)
    bytes.fill(255, 10 * 200 + 10, 20 * 200 + 20)
    const mask = SelectionMask.fromBytes(200, 150, bytes)

    expect(engine.setPixelSelectionMask(mask)).toBe(true)
    expect(engine.getPixelSelectionMask()?.equals(mask)).toBe(true)
    expect(engine.snapshot().editorState?.selectionMask).toMatchObject({
      width: 200,
      height: 150,
      encoding: 'rle-base64',
    })

    engine.setCanvasSize(100, 100)
    expect(engine.getPixelSelectionMask()).toBeUndefined()
  })

  it('rebuilds an adjustment layer from the current visible lower stack', async () => {
    const engine = createEngine()
    const baseId = engine.addRect({
      left: 0,
      top: 0,
      width: 200,
      height: 150,
      fill: '#102030',
      strokeWidth: 0,
      name: 'Base',
    })
    const adjustmentId = await engine.addAdjustmentLayer(
      { invert: 1 },
      'Invert',
    )
    const centerPixel = async (): Promise<number[]> => {
      const pixels = (await engine.getDocumentImageData()).data
      const offset = (75 * 200 + 100) * 4
      return [...pixels.slice(offset, offset + 4)]
    }

    const adjustment = engine
      .getCanvas()
      .getObjects()
      .find((object) => objectRecord(object).editorId === adjustmentId)
    expect(adjustment).toMatchObject({
      selectable: true,
      hasControls: false,
      lockMovementX: true,
      lockScalingX: true,
    })
    expect(await centerPixel()).toEqual([239, 223, 207, 255])

    expect(engine.selectLayer(baseId)).toBe(true)
    expect(engine.setSelectionPaint('#80a0c0')).toBe(true)
    expect(await centerPixel()).toEqual([127, 95, 63, 255])

    expect(engine.setLayerVisible(adjustmentId, false)).toBe(true)
    expect(await centerPixel()).toEqual([128, 160, 192, 255])
    expect(engine.setLayerVisible(adjustmentId, true)).toBe(true)
    expect(await centerPixel()).toEqual([127, 95, 63, 255])
  })

  it('keeps noise deterministic across refresh and equivalent reloads', async () => {
    const addNoisyStack = async (
      engine: FabricEditorEngine,
    ): Promise<string> => {
      engine.addRect({
        left: 0,
        top: 0,
        width: 200,
        height: 150,
        fill: '#808080',
        strokeWidth: 0,
      })
      return engine.addAdjustmentLayer({ noise: 0.4 }, 'Seeded noise')
    }
    const engine = createEngine()
    const adjustmentId = await addNoisyStack(engine)
    const initial = (await engine.getDocumentImageData()).data.slice()

    expect(engine.renameLayer(adjustmentId, 'Seeded noise renamed')).toBe(true)
    expect((await engine.getDocumentImageData()).data).toEqual(initial)
    expect(engine.setAdjustmentLayerFilters(adjustmentId, { noise: 0.4 })).toBe(
      true,
    )
    expect((await engine.getDocumentImageData()).data).toEqual(initial)

    const reloadedEquivalent = createEngine()
    await addNoisyStack(reloadedEquivalent)
    expect((await reloadedEquivalent.getDocumentImageData()).data).toEqual(
      initial,
    )

    const serializedAdjustment = (
      engine.snapshot().json.objects as Array<Record<string, unknown>>
    ).find(({ editorId }) => editorId === adjustmentId)
    expect(serializedAdjustment?.filters).toEqual([
      expect.objectContaining({
        type: 'PixelweaveDeterministicNoise',
        noise: 200,
        seed: expect.any(Number),
      }),
    ])
  })

  it('persists editable adjustment parameters and restores an undo snapshot', async () => {
    const onChanged = vi.fn()
    const engine = createEngine({ onChanged })
    engine.addRect({
      left: 0,
      top: 0,
      width: 200,
      height: 150,
      fill: '#334455',
      strokeWidth: 0,
    })
    const adjustmentId = await engine.addAdjustmentLayer(
      {
        brightness: 0.25,
        contrast: 0.1,
        gamma: 1.4,
      },
      'Color correction',
    )
    const undoSnapshot = engine.snapshot()

    expect(engine.getAdjustmentLayerFilters(adjustmentId)).toMatchObject({
      brightness: 0.25,
      contrast: 0.1,
      gamma: 1.4,
    })
    onChanged.mockClear()
    expect(
      engine.applyImageFilters({
        brightness: -0.3,
        grayscale: true,
      }),
    ).toBe(true)
    expect(onChanged).toHaveBeenCalledOnce()
    expect(onChanged).toHaveBeenLastCalledWith('adjustment-layer')
    expect(engine.getAdjustmentLayerFilters(adjustmentId)).toMatchObject({
      brightness: -0.3,
      grayscale: true,
    })

    vi.spyOn(FabricImage, 'fromObject').mockImplementation(
      async (serialized) => {
        const record = serialized as Record<string, unknown>
        const element = document.createElement('canvas')
        element.width = Number(record.width)
        element.height = Number(record.height)
        const restored = new FabricImage(element, {
          width: Number(record.width),
          height: Number(record.height),
          left: Number(record.left),
          top: Number(record.top),
          originX: 'left',
          originY: 'top',
          globalCompositeOperation: 'copy',
        })
        Object.assign(restored, {
          editorId: record.editorId,
          editorName: record.editorName,
          editorLocked: record.editorLocked,
          editorKind: record.editorKind,
          editorFilterSettings: record.editorFilterSettings,
        })
        return restored
      },
    )
    const reloaded = createEngine()
    await reloaded.restore(undoSnapshot)
    expect(reloaded.getAdjustmentLayerFilters(adjustmentId)).toMatchObject({
      brightness: 0.25,
      contrast: 0.1,
      gamma: 1.4,
    })
    expect(
      reloaded.setAdjustmentLayerFilters(adjustmentId, {
        brightness: 0.4,
        sepia: 1,
      }),
    ).toBe(true)

    await engine.restore(undoSnapshot)
    expect(engine.getLayers()).toEqual([
      expect.objectContaining({
        id: adjustmentId,
        name: 'Color correction',
        type: 'adjustment',
      }),
      expect.objectContaining({ type: 'rectangle' }),
    ])
    expect(engine.getAdjustmentLayerFilters(adjustmentId)).toMatchObject({
      brightness: 0.25,
      contrast: 0.1,
      gamma: 1.4,
    })
    expect(onChanged).toHaveBeenCalledOnce()

    expect(
      engine.setAdjustmentLayerFilters(adjustmentId, {
        brightness: 0.4,
        sepia: 1,
      }),
    ).toBe(true)
    const serializedAdjustment = (
      engine.snapshot().json.objects as Array<Record<string, unknown>>
    ).find(({ editorId }) => editorId === adjustmentId)
    expect(serializedAdjustment).toMatchObject({
      editorKind: 'adjustment',
      editorFilterSettings: {
        brightness: 0.4,
        sepia: 1,
      },
    })
  })

  it('rasterizes the current adjustment result into a frozen normal image', async () => {
    const engine = createEngine()
    const baseId = engine.addRect({
      left: 0,
      top: 0,
      width: 200,
      height: 150,
      fill: '#000000',
      strokeWidth: 0,
      name: 'Base',
    })
    const adjustmentId = await engine.addAdjustmentLayer(
      { invert: 1 },
      'Invert',
    )

    expect(await engine.rasterizeAdjustmentLayer(adjustmentId)).toBe(true)
    expect(engine.getLayers()[0]).toMatchObject({
      id: adjustmentId,
      type: 'image',
      blend: 'source-over',
    })
    expect(engine.getCanvas().getObjects()[1]).toMatchObject({
      hasControls: true,
      lockMovementX: false,
      lockScalingX: false,
    })
    expect(engine.getAdjustmentLayerFilters(adjustmentId)).toBeNull()

    expect(engine.selectLayer(baseId)).toBe(true)
    expect(engine.setSelectionPaint('#ff0000')).toBe(true)
    const pixels = (await engine.getDocumentImageData()).data
    const offset = (75 * 200 + 100) * 4
    expect([...pixels.slice(offset, offset + 4)]).toEqual([255, 255, 255, 255])

    const serializedAdjustment = (
      engine.snapshot().json.objects as Array<Record<string, unknown>>
    ).find(({ editorId }) => editorId === adjustmentId)
    expect(serializedAdjustment).toMatchObject({
      filters: [],
    })
    expect(serializedAdjustment).not.toHaveProperty('editorKind')
    expect(serializedAdjustment).not.toHaveProperty('editorFilterSettings')
  })

  it('applies precise CPU filter operations as one undoable raster layer', async () => {
    const onChanged = vi.fn()
    const engine = createEngine({ onChanged })
    engine.addRect({
      left: 0,
      top: 0,
      width: 200,
      height: 150,
      fill: '#102030',
      strokeWidth: 0,
      name: 'Original',
    })
    const before = engine.snapshot()
    const decodedCanvas = document.createElement('canvas')
    decodedCanvas.width = 200
    decodedCanvas.height = 150
    vi.spyOn(FabricImage, 'fromURL').mockResolvedValue(
      new FabricImage(decodedCanvas, { width: 200, height: 150 }),
    )
    onChanged.mockClear()

    const id = await engine.applyAdvancedFilterOperations(
      [
        {
          id: 'levels',
          params: {
            inputBlack: 8,
            inputWhite: 244,
            gamma: 0.9,
            outputBlack: 0,
            outputWhite: 255,
          },
        },
        {
          id: 'duotone',
          params: {
            shadows: { r: 12, g: 18, b: 48 },
            highlights: { r: 250, g: 204, b: 112 },
          },
        },
      ],
      'Precise grade',
    )

    expect(engine.getLayers()[0]).toMatchObject({
      id,
      name: 'Precise grade',
      type: 'image',
    })
    expect(onChanged).toHaveBeenCalledOnce()
    expect(onChanged).toHaveBeenCalledWith('filter')
    expect(
      (engine.snapshot().json.objects as Array<Record<string, unknown>>).at(-1),
    ).toMatchObject({ type: 'Image', editorName: 'Precise grade' })

    await engine.restore(before)
    expect(engine.getLayers()).toEqual([
      expect.objectContaining({ name: 'Original', type: 'rectangle' }),
    ])
    expect(onChanged).toHaveBeenCalledOnce()
  })

  it('persists, restores, re-edits, and rasterizes an exact advanced adjustment chain', async () => {
    const engine = createEngine()
    engine.addRect({
      left: 0,
      top: 0,
      width: 200,
      height: 150,
      fill: '#102030',
      strokeWidth: 0,
      name: 'Base',
    })
    const operations: FilterOperation[] = [
      {
        id: 'levels',
        params: {
          inputBlack: 8,
          inputWhite: 244,
          gamma: 0.9,
          outputBlack: 4,
          outputWhite: 250,
        },
      },
      {
        id: 'duotone',
        params: {
          shadows: { r: 12, g: 18, b: 48 },
          highlights: { r: 250, g: 204, b: 112 },
        },
      },
    ]

    const adjustmentId = await engine.addAdvancedAdjustmentLayer(
      operations,
      'Exact grade',
    )
    expect(engine.getAdvancedAdjustmentLayerOperations(adjustmentId)).toEqual(
      operations,
    )

    const snapshot = engine.snapshot()
    const serialized = (
      snapshot.json.objects as Array<Record<string, unknown>>
    ).find(({ editorId }) => editorId === adjustmentId)
    expect(serialized).toMatchObject({
      editorKind: 'adjustment',
      editorFilterOperations: operations,
    })
    expect(serialized).not.toHaveProperty('editorFilterSettings')

    const project = createProjectDocument({
      fabricCanvas: snapshot.json as JsonObject,
      canvasSize: { width: snapshot.width, height: snapshot.height },
      editorState: snapshot.editorState,
      updatedAt: '2026-07-31T00:00:00.000Z',
    })
    const projectRoundTrip = parseProject(serializeProject(project))
    expect(
      (
        projectRoundTrip.fabricCanvas.objects as Array<Record<string, unknown>>
      ).find(({ editorId }) => editorId === adjustmentId),
    ).toMatchObject({ editorFilterOperations: operations })

    const updated: FilterOperation[] = [
      { id: 'invert', params: { amount: 0.65 } },
      {
        id: 'white-balance',
        params: { temperature: 0.24, tint: -0.18 },
      },
    ]
    expect(
      await engine.setAdvancedAdjustmentLayerOperations(adjustmentId, updated),
    ).toBe(true)
    expect(engine.getAdvancedAdjustmentLayerOperations(adjustmentId)).toEqual(
      updated,
    )

    expect(await engine.rasterizeAdvancedAdjustmentLayer(adjustmentId)).toBe(
      true,
    )
    expect(engine.getAdvancedAdjustmentLayerOperations(adjustmentId)).toBeNull()
    expect(engine.getLayers()[0]).toMatchObject({
      id: adjustmentId,
      type: 'image',
      blend: 'source-over',
    })
    expect(
      (engine.snapshot().json.objects as Array<Record<string, unknown>>).find(
        ({ editorId }) => editorId === adjustmentId,
      ),
    ).toMatchObject({
      filters: [],
    })
    const rasterized = (
      engine.snapshot().json.objects as Array<Record<string, unknown>>
    ).find(({ editorId }) => editorId === adjustmentId)
    expect(rasterized).not.toHaveProperty('editorKind')
    expect(rasterized).not.toHaveProperty('editorFilterOperations')
  })

  it('rebuilds an advanced adjustment from the latest visible lower stack', async () => {
    const engine = createEngine()
    const baseId = engine.addRect({
      left: 0,
      top: 0,
      width: 200,
      height: 150,
      fill: '#102030',
      strokeWidth: 0,
      name: 'Base',
    })
    const adjustmentId = await engine.addAdvancedAdjustmentLayer(
      [{ id: 'invert', params: { amount: 1 } }],
      'Live invert',
    )
    const centerPixel = async (): Promise<number[]> => {
      const pixels = (await engine.getDocumentImageData()).data
      const offset = (75 * 200 + 100) * 4
      return [...pixels.slice(offset, offset + 4)]
    }

    expect(await centerPixel()).toEqual([239, 223, 207, 255])
    expect(engine.selectLayer(baseId)).toBe(true)
    expect(engine.setSelectionPaint('#80a0c0')).toBe(true)
    await engine.waitForAdjustmentLayers()
    expect(await centerPixel()).toEqual([127, 95, 63, 255])

    expect(engine.setLayerVisible(adjustmentId, false)).toBe(true)
    await engine.waitForAdjustmentLayers()
    expect(await centerPixel()).toEqual([128, 160, 192, 255])
  })

  it('keeps a document read pending through a newer adjustment rebuild', async () => {
    const engine = createEngine()
    const baseId = engine.addRect({
      left: 0,
      top: 0,
      width: 200,
      height: 150,
      fill: '#202020',
      strokeWidth: 0,
    })
    await engine.addAdvancedAdjustmentLayer([
      { id: 'invert', params: { amount: 1 } },
    ])
    expect(engine.selectLayer(baseId)).toBe(true)

    const first = deferred<{
      width: number
      height: number
      data: Uint8ClampedArray
    }>()
    const second = deferred<{
      width: number
      height: number
      data: Uint8ClampedArray
    }>()
    const internals = engine as unknown as {
      runAdvancedFilterOperations: () => Promise<{
        width: number
        height: number
        data: Uint8ClampedArray
      }>
    }
    const runFilter = vi
      .spyOn(internals, 'runAdvancedFilterOperations')
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)

    expect(engine.setSelectionPaint('#404040')).toBe(true)
    await vi.waitFor(() => expect(runFilter).toHaveBeenCalledOnce())
    let readSettled = false
    const latestPixels = engine.getDocumentImageData().finally(() => {
      readSettled = true
    })
    await Promise.resolve()
    expect(readSettled).toBe(false)

    expect(engine.setSelectionPaint('#606060')).toBe(true)
    const solid = (red: number, green: number, blue: number) => {
      const data = new Uint8ClampedArray(200 * 150 * 4)
      for (let offset = 0; offset < data.length; offset += 4) {
        data.set([red, green, blue, 255], offset)
      }
      return { width: 200, height: 150, data }
    }

    first.resolve(solid(255, 0, 0))
    await vi.waitFor(() => expect(runFilter).toHaveBeenCalledTimes(2))
    await Promise.resolve()
    expect(readSettled).toBe(false)

    second.resolve(solid(12, 34, 56))
    const pixels = (await latestPixels).data
    const centerOffset = (75 * 200 + 100) * 4
    expect([...pixels.slice(centerOffset, centerOffset + 4)]).toEqual([
      12, 34, 56, 255,
    ])
  })

  it('validates and restores serialized advanced adjustment operations', async () => {
    const engine = createEngine()
    engine.addRect({
      left: 0,
      top: 0,
      width: 200,
      height: 150,
      fill: '#334455',
      strokeWidth: 0,
    })
    const operations: FilterOperation[] = [
      {
        id: 'vignette',
        params: {
          amount: 0.4,
          midpoint: 0.3,
          softness: 0.8,
          color: { r: 4, g: 8, b: 12 },
        },
      },
    ]
    const adjustmentId = await engine.addAdvancedAdjustmentLayer(operations)
    const snapshot = engine.snapshot()

    vi.spyOn(FabricImage, 'fromObject').mockImplementation(
      async (serialized) => {
        const record = serialized as Record<string, unknown>
        const element = document.createElement('canvas')
        element.width = Number(record.width)
        element.height = Number(record.height)
        const restored = new FabricImage(element, {
          width: Number(record.width),
          height: Number(record.height),
          left: Number(record.left),
          top: Number(record.top),
          originX: 'left',
          originY: 'top',
          globalCompositeOperation: 'copy',
        })
        Object.assign(restored, {
          editorId: record.editorId,
          editorName: record.editorName,
          editorLocked: record.editorLocked,
          editorKind: record.editorKind,
          editorFilterSettings: record.editorFilterSettings,
          editorFilterOperations: record.editorFilterOperations,
        })
        return restored
      },
    )

    const restored = createEngine()
    await restored.restore(snapshot)
    expect(restored.getAdvancedAdjustmentLayerOperations(adjustmentId)).toEqual(
      operations,
    )

    const malformed = structuredClone(snapshot)
    const malformedAdjustment = (
      malformed.json.objects as Array<Record<string, unknown>>
    ).find(({ editorId }) => editorId === adjustmentId)!
    malformedAdjustment.editorFilterOperations = [
      { id: 'levels', params: { inputBlack: 0 } },
    ]
    await expect(restored.restore(malformed)).rejects.toThrow(
      /editorFilterOperations/u,
    )
    expect(restored.getAdvancedAdjustmentLayerOperations(adjustmentId)).toEqual(
      operations,
    )
  })

  it('rejects an empty advanced filter chain before changing the document', async () => {
    const onChanged = vi.fn()
    const engine = createEngine({ onChanged })
    const before = engine.snapshot()

    await expect(engine.applyAdvancedFilterOperations([])).rejects.toThrow(
      '詳細フィルターを1つ以上指定してください。',
    )
    expect(engine.snapshot()).toEqual(before)
    expect(onChanged).not.toHaveBeenCalled()
  })
})
