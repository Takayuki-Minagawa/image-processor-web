import { FabricImage, util, type FabricObject } from 'fabric'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FabricEditorEngine } from './fabricEngine'
import { SelectionMask } from '../selection/mask'
import {
  decodeSelectionMaskFromProject,
  encodeSelectionMaskForProject,
} from '../selection/codec'
import { createProjectDocument } from './project'
import type {
  EncodedSelectionMask,
  JsonObject,
  ProjectLayerTree,
} from './types'

const engines = new Set<FabricEditorEngine>()

const createEngine = (): FabricEditorEngine => {
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const engine = new FabricEditorEngine(canvas, { width: 200, height: 150 })
  engines.add(engine)
  return engine
}

type TestEditorObject = FabricObject & {
  editorId?: string
  editorClipFrameId?: string
  editorLayerMask?: unknown
  editorLayerMaskEnabled?: boolean
}

const findObject = (
  engine: FabricEditorEngine,
  id: string,
): TestEditorObject => {
  const object = engine
    .getCanvas()
    .getObjects()
    .find((candidate) => (candidate as TestEditorObject).editorId === id)
  if (!object) throw new Error(`Missing test layer ${id}.`)
  return object as TestEditorObject
}

const createImageLayer = (engine: FabricEditorEngine): string => {
  const source = document.createElement('canvas')
  source.width = 80
  source.height = 60
  const context = source.getContext('2d')
  if (!context) throw new Error('Missing test canvas context.')
  context.fillStyle = '#16a34a'
  context.fillRect(0, 0, source.width, source.height)
  engine.getCanvas().add(new FabricImage(source))
  return engine.getLayers()[0].id
}

const setRectangularSelection = (engine: FabricEditorEngine): void => {
  const bytes = new Uint8Array(200 * 150)
  for (let y = 20; y < 80; y += 1) {
    bytes.fill(255, y * 200 + 10, y * 200 + 90)
  }
  engine.setPixelSelectionMask(SelectionMask.fromBytes(200, 150, bytes))
}

const mockImageRestoration = (engine: FabricEditorEngine): void => {
  const sources = new Map<string, HTMLCanvasElement>()
  const visit = (object: FabricObject): void => {
    if (object instanceof FabricImage) {
      const source = String(
        (object.toObject() as unknown as Record<string, unknown>).src,
      )
      const canvas = document.createElement('canvas')
      canvas.width = object.width
      canvas.height = object.height
      canvas.getContext('2d')?.drawImage(object.getElement(), 0, 0)
      sources.set(source, canvas)
    }
    if (object.clipPath) visit(object.clipPath as FabricObject)
  }
  engine.getCanvas().getObjects().forEach(visit)

  vi.spyOn(FabricImage, 'fromObject').mockImplementation(
    async (serialized, options) => {
      const record = serialized as Record<string, unknown>
      const sourceId = record.src
      const object = { ...record }
      delete object.src
      delete object.type
      const source = sources.get(String(sourceId))
      if (!source) throw new Error('Unexpected image source in restore test.')
      const hydrated = await util.enlivenObjectEnlivables(object, options)
      return new FabricImage(source, {
        ...object,
        ...hydrated,
      } as ConstructorParameters<typeof FabricImage>[1])
    },
  )
}

afterEach(async () => {
  await Promise.all([...engines].map((engine) => engine.dispose()))
  engines.clear()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('FabricEditorEngine design structure', () => {
  it('groups nested layers and preserves the tree through snapshots', async () => {
    const engine = createEngine()
    const first = engine.addRect({ name: 'First' })
    engine.addEllipse({ name: 'Second' })
    engine.selectLayer(first, true)
    const inner = engine.groupSelection('Inner')
    expect(inner).toBeTruthy()

    engine.addDesignShape('star', { name: 'Star' })
    engine.selectLayer(inner!, true)
    const outer = engine.groupSelection('Outer')
    expect(outer).toBeTruthy()
    expect(engine.getLayerTree().map(({ depth }) => depth)).toEqual([
      0, 1, 1, 2, 2,
    ])

    const restored = createEngine()
    await restored.restore(engine.snapshot())
    expect(
      restored.getLayerTree().map(({ name, depth }) => [name, depth]),
    ).toEqual(engine.getLayerTree().map(({ name, depth }) => [name, depth]))
    expect(restored.ungroupSelection()).toEqual([])
    restored.selectLayer(outer!)
    expect(restored.ungroupSelection()).toHaveLength(2)
  })

  it('deletes a selected nested group child through its persistent parent', () => {
    const engine = createEngine()
    const first = engine.addRect({ name: 'First' })
    const second = engine.addRect({ name: 'Second' })
    engine.selectLayer(first)
    engine.selectLayer(second, true)
    const groupId = engine.groupSelection('Editable group')!
    const group = findObject(engine, groupId) as TestEditorObject & {
      getObjects(): FabricObject[]
    }

    engine.selectLayer(first)
    expect(engine.deleteSelection()).toBe(true)
    expect(group.getObjects()).toHaveLength(1)
    expect(engine.getLayerTree().some(({ id }) => id === first)).toBe(false)
  })

  it('cuts a selected nested group child through its persistent parent', async () => {
    const engine = createEngine()
    const first = engine.addRect({ name: 'First' })
    const second = engine.addRect({ name: 'Second' })
    engine.selectLayer(first)
    engine.selectLayer(second, true)
    const groupId = engine.groupSelection('Editable group')!
    const group = findObject(engine, groupId) as TestEditorObject & {
      getObjects(): FabricObject[]
    }

    engine.selectLayer(first)
    expect(await engine.cutSelection()).toBe(true)
    expect(group.getObjects()).toHaveLength(1)
    expect(engine.getLayerTree().some(({ id }) => id === first)).toBe(false)

    const [pastedId] = await engine.pasteSelection()
    expect(pastedId).toBeTruthy()
    expect(pastedId).not.toBe(first)
  })

  it('reorders a nested group child within its parent', () => {
    const engine = createEngine()
    const first = engine.addRect({ name: 'First' })
    const second = engine.addRect({ name: 'Second' })
    const third = engine.addRect({ name: 'Third' })
    engine.selectLayer(first)
    engine.selectLayer(second, true)
    engine.selectLayer(third, true)
    const groupId = engine.groupSelection('Editable group')!
    const group = findObject(engine, groupId) as TestEditorObject & {
      getObjects(): FabricObject[]
    }
    const childIds = (): Array<string | undefined> =>
      group.getObjects().map((object) => (object as TestEditorObject).editorId)

    expect(engine.moveLayerToFront(first)).toBe(true)
    expect(childIds().at(-1)).toBe(first)
    expect(engine.moveLayerToBack(first)).toBe(true)
    expect(childIds()[0]).toBe(first)
    expect(engine.moveLayer(first, 0)).toBe(true)
    expect(childIds().at(-1)).toBe(first)
  })

  it('creates and releases an image clipping frame', async () => {
    const engine = createEngine()
    const image = createImageLayer(engine)
    engine.addEllipse({ name: 'Circle frame', width: 12, height: 12 })
    engine.selectLayer(image, true)

    expect(engine.createClipFrame()).toBe(image)
    expect(engine.getLayerTree()).toEqual([
      expect.objectContaining({ id: image, clipped: true }),
    ])
    expect(engine.releaseClipFrame(image)).toBeTruthy()
    expect(engine.getLayers()).toHaveLength(2)
  })

  it('applies, disables, reenables, and removes an 8-bit layer mask', () => {
    const engine = createEngine()
    const layer = engine.addRect({ width: 80, height: 60 })
    setRectangularSelection(engine)

    expect(engine.applySelectionAsLayerMask(layer)).toBe(true)
    expect(engine.getLayerTree()[0].masked).toBe(true)
    expect(engine.setLayerMaskEnabled(layer, false)).toBe(true)
    expect(engine.setLayerMaskEnabled(layer, true)).toBe(true)
    expect(engine.removeLayerMask(layer)).toBe(true)
    expect(engine.getLayerTree()[0].masked).toBe(false)
  })

  it('keeps a clip frame while a layer mask is applied, toggled, and removed', () => {
    const engine = createEngine()
    const image = createImageLayer(engine)
    const frame = engine.addEllipse({
      name: 'Persistent frame',
      left: 8,
      top: 12,
      width: 64,
      height: 48,
    })
    engine.selectLayer(image, true)
    expect(engine.createClipFrame()).toBe(image)

    setRectangularSelection(engine)
    expect(engine.applySelectionAsLayerMask(image)).toBe(true)
    const target = findObject(engine, image)
    const embeddedFrame = target.clipPath as TestEditorObject
    expect(embeddedFrame.editorId).toBe(frame)
    expect(embeddedFrame.clipPath?.type.toLowerCase()).toBe('image')

    const serialized = engine.snapshot().json.objects as Array<
      Record<string, unknown>
    >
    expect(serialized[0]).toMatchObject({
      editorClipFrameId: frame,
      editorLayerMaskEnabled: true,
      clipPath: {
        editorId: frame,
        editorKind: 'frame',
        clipPath: {
          type: 'Image',
          absolutePositioned: true,
          src: expect.stringMatching(/^data:image\/png;base64,/u),
        },
      },
    })

    expect(engine.setLayerMaskEnabled(image, false)).toBe(true)
    expect(target.clipPath).toBe(embeddedFrame)
    expect(embeddedFrame.clipPath).toBeUndefined()
    expect(engine.getLayerTree()[0]).toEqual(
      expect.objectContaining({ clipped: true, masked: true }),
    )

    expect(engine.setLayerMaskEnabled(image, true)).toBe(true)
    expect(target.clipPath).toBe(embeddedFrame)
    expect(embeddedFrame.clipPath?.type.toLowerCase()).toBe('image')

    expect(engine.removeLayerMask(image)).toBe(true)
    expect(target.clipPath).toBe(embeddedFrame)
    expect(embeddedFrame.clipPath).toBeUndefined()
    expect(engine.getLayerTree()[0]).toEqual(
      expect.objectContaining({ clipped: true, masked: false }),
    )
  })

  it('round-trips a frame and mask and preserves the enabled mask on release', async () => {
    const engine = createEngine()
    const image = createImageLayer(engine)
    setRectangularSelection(engine)
    expect(engine.applySelectionAsLayerMask(image)).toBe(true)
    const originalMaskClip = findObject(engine, image).clipPath

    const frame = engine.addEllipse({
      name: 'Round-trip frame',
      left: 8,
      top: 12,
      width: 64,
      height: 48,
    })
    engine.selectLayer(image, true)
    expect(engine.createClipFrame()).toBe(image)
    expect(findObject(engine, image).clipPath?.clipPath).toBe(originalMaskClip)

    const snapshot = engine.snapshot()
    mockImageRestoration(engine)
    const restored = createEngine()
    await restored.restore(snapshot)
    const restoredImage = findObject(restored, image)
    const restoredFrame = restoredImage.clipPath as TestEditorObject
    expect(restoredFrame.editorId).toBe(frame)
    expect(restoredFrame.clipPath?.type.toLowerCase()).toBe('image')
    const compositeSvg = await restored.exportSvg()
    expect(compositeSvg).toContain('<image ')
    expect(compositeSvg).toContain('href="data:image/png;base64,')
    expect(compositeSvg).not.toContain('url(#undefined)')

    expect(restored.releaseClipFrame(image)).toBe(frame)
    expect(restoredImage.editorClipFrameId).toBeUndefined()
    expect(restoredImage.editorLayerMask).toBeTruthy()
    expect(restoredImage.editorLayerMaskEnabled).toBe(true)
    expect(restoredImage.clipPath?.type.toLowerCase()).toBe('image')
    expect(restoredFrame.clipPath).toBeUndefined()
    const releasedSvg = await restored.exportSvg()
    expect(releasedSvg).toContain('<clipPath')
    expect(releasedSvg).not.toContain('url(#undefined)')

    const releasedSnapshot = restored.snapshot()
    const restoredAgain = createEngine()
    await restoredAgain.restore(releasedSnapshot)
    const restoredAgainImage = findObject(restoredAgain, image)
    expect(restoredAgainImage.editorClipFrameId).toBeUndefined()
    expect(restoredAgainImage.editorLayerMask).toBeTruthy()
    expect(restoredAgainImage.clipPath?.type.toLowerCase()).toBe('image')
  })

  it('round-trips every canonical clip and mask setting through engine snapshots', async () => {
    const payload = encodeSelectionMaskForProject(
      SelectionMask.fromBytes(2, 2, new Uint8Array([0, 64, 192, 255])),
    )
    const layerTree: ProjectLayerTree = [
      {
        id: 'frame',
        name: 'Frame',
        kind: 'layer',
        layerType: 'frame',
        visible: true,
        locked: false,
        opacity: 1,
      },
      {
        id: 'photo',
        name: 'Photo',
        kind: 'layer',
        layerType: 'image',
        visible: true,
        locked: false,
        opacity: 1,
        clip: {
          frameLayerId: 'frame',
          fit: 'contain',
          position: { x: 0.25, y: 0.8 },
          scale: 1.4,
          rotation: 17,
        },
        mask: {
          enabled: false,
          inverted: true,
          opacity: 0.65,
          offsetX: 12,
          offsetY: -7,
          payload,
        },
      },
    ]
    const project = createProjectDocument({
      canvasSize: { width: 200, height: 150 },
      fabricCanvas: {
        objects: [
          {
            type: 'Rect',
            editorId: 'photo',
            editorClipFrameId: 'frame',
            clipPath: {
              type: 'Ellipse',
              editorId: 'frame',
              editorKind: 'frame',
            },
            editorLayerMask: payload as unknown as JsonObject,
            editorLayerMaskEnabled: false,
          },
        ],
      },
      layerTree,
    })
    const engine = createEngine()
    await engine.restore({
      json: project.fabricCanvas as Record<string, unknown>,
      width: project.canvasSize.width,
      height: project.canvasSize.height,
      editorState: project.editorState,
    })

    const snapshot = engine.snapshot()
    const rendererPhoto = (
      snapshot.json.objects as Array<Record<string, unknown>>
    )[0]
    expect(rendererPhoto).toMatchObject({
      editorClipSettings: {
        fit: 'contain',
        position: { x: 0.25, y: 0.8 },
        scale: 1.4,
        rotation: 17,
      },
      editorLayerMaskSettings: {
        inverted: true,
        opacity: 0.65,
        offsetX: 12,
        offsetY: -7,
      },
    })
    const savedAgain = createProjectDocument({
      canvasSize: { width: snapshot.width, height: snapshot.height },
      fabricCanvas: snapshot.json as JsonObject,
      editorState: snapshot.editorState,
    })
    expect(savedAgain.pages[0].layerTree).toEqual(layerTree)
  })

  it('bakes an enabled layer mask into a same-id raster layer', async () => {
    const engine = createEngine()
    const layer = engine.addRect({
      left: 0,
      top: 10,
      width: 100,
      height: 100,
      fill: '#dc2626',
      strokeWidth: 0,
    })
    setRectangularSelection(engine)
    expect(engine.applySelectionAsLayerMask(layer)).toBe(true)

    expect(await engine.rasterizeLayerMask(layer)).toBe(true)
    const rasterized = findObject(engine, layer)
    expect(rasterized).toBeInstanceOf(FabricImage)
    expect(rasterized.editorLayerMask).toBeUndefined()
    expect(rasterized.clipPath).toBeUndefined()
    expect(engine.getLayerTree()[0]).toEqual(
      expect.objectContaining({ id: layer, clipped: false, masked: false }),
    )

    const pixels = await engine.getDocumentImageData()
    const alphaAt = (x: number, y: number): number =>
      pixels.data[(y * pixels.width + x) * 4 + 3]
    expect(alphaAt(20, 30)).toBe(255)
    expect(alphaAt(95, 30)).toBe(0)
  })

  it('keeps a live clip frame when baking a layer mask', async () => {
    const engine = createEngine()
    const image = createImageLayer(engine)
    const frame = engine.addEllipse({
      name: 'Live frame',
      left: 0,
      top: 0,
      width: 80,
      height: 60,
    })
    engine.selectLayer(image, true)
    expect(engine.createClipFrame()).toBe(image)
    setRectangularSelection(engine)
    expect(engine.applySelectionAsLayerMask(image)).toBe(true)

    expect(await engine.rasterizeLayerMask(image)).toBe(true)
    const rasterized = findObject(engine, image)
    const embeddedFrame = rasterized.clipPath as TestEditorObject
    expect(rasterized).toBeInstanceOf(FabricImage)
    expect(rasterized.editorLayerMask).toBeUndefined()
    expect(rasterized.editorClipFrameId).toBe(frame)
    expect(embeddedFrame.editorId).toBe(frame)
    expect(embeddedFrame.clipPath).toBeUndefined()
    expect(engine.getLayerTree()[0]).toEqual(
      expect.objectContaining({ clipped: true, masked: false }),
    )

    expect(engine.releaseClipFrame(image)).toBe(frame)
    expect(rasterized.clipPath).toBeUndefined()
  })

  it('intersects wipe animation clips with an existing frame and mask', () => {
    const engine = createEngine()
    const image = createImageLayer(engine)
    const frame = engine.addEllipse({
      name: 'Animation frame',
      left: 0,
      top: 0,
      width: 80,
      height: 60,
    })
    engine.selectLayer(image, true)
    expect(engine.createClipFrame()).toBe(image)
    setRectangularSelection(engine)
    expect(engine.applySelectionAsLayerMask(image)).toBe(true)
    const target = findObject(engine, image)
    const bounds = target.getBoundingRect()

    engine.applyEvaluatedAnimationState([
      {
        elementId: image,
        visible: true,
        opacity: 1,
        translateX: 0,
        translateY: 0,
        scaleX: 1,
        scaleY: 1,
        clipProgress: 0.25,
        clipDirection: 'left',
        activeClipIds: ['wipe'],
      },
    ])

    const embeddedFrame = target.clipPath as TestEditorObject
    const maskClip = embeddedFrame.clipPath as FabricObject
    const wipeClip = maskClip.clipPath
    expect(embeddedFrame.editorId).toBe(frame)
    expect(maskClip.type.toLowerCase()).toBe('image')
    expect(wipeClip?.type.toLowerCase()).toBe('rect')
    expect(wipeClip?.width).toBeCloseTo(bounds.width * 0.25)
    expect(wipeClip?.left).toBeCloseTo(bounds.left + bounds.width * 0.75)
  })

  it('anchors right-directed wipe clips at the left edge', () => {
    const engine = createEngine()
    const layer = engine.addRect({ left: 20, top: 30, width: 80, height: 60 })
    const target = findObject(engine, layer)
    const bounds = target.getBoundingRect()

    engine.applyEvaluatedAnimationState([
      {
        elementId: layer,
        visible: true,
        opacity: 1,
        translateX: 0,
        translateY: 0,
        scaleX: 1,
        scaleY: 1,
        clipProgress: 0.4,
        clipDirection: 'right',
        activeClipIds: ['wipe'],
      },
    ])

    expect(target.clipPath?.type.toLowerCase()).toBe('rect')
    expect(target.clipPath?.left).toBeCloseTo(bounds.left)
    expect(target.clipPath?.width).toBeCloseTo(bounds.width * 0.4)
  })

  it('magic-resizes positions and geometry in one mutation', () => {
    const engine = createEngine()
    engine.addRect({ left: 10, top: 20, width: 40, height: 30 })
    engine.magicResize(400, 300, 'top-left', 'fit')
    const object = engine.getCanvas().getObjects()[0]
    expect(engine.getDocumentSize()).toEqual({ width: 400, height: 300 })
    expect(object.left).toBeCloseTo(20)
    expect(object.top).toBeCloseTo(40)
    expect(object.getScaledWidth()).toBeCloseTo(80)
  })

  it('keeps absolute frames and layer-mask payloads aligned through resize and crop', () => {
    const engine = createEngine()
    const image = createImageLayer(engine)
    const frame = engine.addEllipse({
      name: 'Transform frame',
      left: 8,
      top: 12,
      width: 64,
      height: 48,
    })
    engine.selectLayer(image, true)
    expect(engine.createClipFrame()).toBe(image)
    setRectangularSelection(engine)
    expect(engine.applySelectionAsLayerMask(image)).toBe(true)

    const target = findObject(engine, image)
    const frameBefore = target.clipPath!
    const framePositionBefore = { left: frameBefore.left, top: frameBefore.top }
    engine.magicResize(400, 300, 'top-left', 'fit')

    const transformedFrame = target.clipPath!
    expect(transformedFrame.left).toBeCloseTo(framePositionBefore.left * 2)
    expect(transformedFrame.top).toBeCloseTo(framePositionBefore.top * 2)
    expect(transformedFrame.scaleX).toBeCloseTo(2)
    expect(transformedFrame.scaleY).toBeCloseTo(2)
    let storedMask = decodeSelectionMaskFromProject(
      target.editorLayerMask as EncodedSelectionMask,
    )
    expect([storedMask.width, storedMask.height]).toEqual([400, 300])
    expect(transformedFrame.clipPath?.absolutePositioned).toBe(true)

    const selectedBounds = target.getBoundingRect()
    const cropLeft = Math.max(0, Math.floor(selectedBounds.left))
    const cropTop = Math.max(0, Math.floor(selectedBounds.top))
    const framePositionBeforeCrop = {
      left: transformedFrame.left,
      top: transformedFrame.top,
    }
    const cropped = engine.cropToSelection()
    expect(cropped).not.toBeNull()
    storedMask = decodeSelectionMaskFromProject(
      target.editorLayerMask as EncodedSelectionMask,
    )
    expect([storedMask.width, storedMask.height]).toEqual([
      cropped!.width,
      cropped!.height,
    ])
    expect(target.clipPath?.left).toBeCloseTo(
      framePositionBeforeCrop.left - cropLeft,
    )
    expect(target.clipPath?.top).toBeCloseTo(
      framePositionBeforeCrop.top - cropTop,
    )
    expect(target.clipPath?.clipPath?.absolutePositioned).toBe(true)
    expect(target.editorClipFrameId).toBe(frame)
  })

  it('adds vertical wrapped text, effects, and serializable backgrounds', () => {
    const engine = createEngine()
    engine.addText('日本語', { vertical: true, layoutMode: 'wrap', width: 80 })
    expect(engine.applyTextEffect('neon')).toBe(true)
    engine.setGradientBackground('#7c3aed', '#22d3ee', 90)
    const snapshot = engine.snapshot()
    const objects = snapshot.json.objects as Array<Record<string, unknown>>
    expect(objects[0].text).toBe('日\n本\n語')
    expect(snapshot.json.background).toBeTruthy()
  })
})
