import {
  ActiveSelection,
  Ellipse,
  FabricImage,
  IText,
  Path,
  Rect,
  type FabricObject,
} from 'fabric'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FabricEditorEngine, type FabricEditorCallbacks } from './fabricEngine'
import { MAX_PROJECT_OBJECTS } from './snapshotValidation'

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
