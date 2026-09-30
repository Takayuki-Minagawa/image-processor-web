import {
  ActiveSelection,
  FabricImage,
  Group,
  Rect,
  type FabricObject,
} from 'fabric'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FabricEditorEngine } from './fabricEngine'

const engines = new Set<FabricEditorEngine>()
const createEngine = () => {
  const element = document.createElement('canvas')
  document.body.append(element)
  const onChanged = vi.fn()
  const engine = new FabricEditorEngine(element, {
    width: 200,
    height: 150,
    callbacks: { onChanged },
  })
  engines.add(engine)
  return { engine, onChanged }
}
const findObject = (engine: FabricEditorEngine, id: string): FabricObject =>
  engine
    .getCanvas()
    .getObjects()
    .find(
      (object) =>
        (object as FabricObject & { editorId?: string }).editorId === id,
    )!

afterEach(async () => {
  await Promise.all([...engines].map((engine) => engine.dispose()))
  engines.clear()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('keyboard selection operations', () => {
  it('selects visible unlocked layers without adding a history transaction', () => {
    const { engine, onChanged } = createEngine()
    const first = engine.addRect({ left: 10, top: 15 })
    const second = engine.addRect({ left: 60, top: 45 })
    const hidden = engine.addRect()
    const locked = engine.addRect()
    engine.setLayerVisible(hidden, false)
    engine.setLayerLocked(locked, true)
    onChanged.mockClear()

    expect(engine.selectAllLayers()).toEqual([first, second])
    expect(engine.getSelectedLayerIds()).toEqual([first, second])
    expect(onChanged).not.toHaveBeenCalled()
    expect(engine.getCanvas().getActiveObject()).toBeInstanceOf(ActiveSelection)
  })

  it('moves multiple objects by document pixels at any zoom and restores from history', async () => {
    const { engine, onChanged } = createEngine()
    const first = engine.addRect({ left: 10, top: 15, width: 20, height: 20 })
    const second = engine.addRect({ left: 60, top: 45, width: 20, height: 20 })
    engine.setZoom(2)
    engine.selectAllLayers()
    const before = engine.snapshot()
    onChanged.mockClear()

    expect(engine.nudgeSelection(10, -1)).toBe(true)
    expect(findObject(engine, first).getXY()).toMatchObject({ x: 20, y: 14 })
    expect(findObject(engine, second).getXY()).toMatchObject({ x: 70, y: 44 })
    expect(engine.getSelectedLayerIds()).toEqual([first, second])
    expect(onChanged).toHaveBeenCalledExactlyOnceWith('object-modified')
    expect(engine.getZoom()).toBe(2)

    await engine.restore(before)
    expect(findObject(engine, first).getXY()).toMatchObject({ x: 10, y: 15 })
    expect(findObject(engine, second).getXY()).toMatchObject({ x: 60, y: 45 })
  })

  it('moves a transformed group as one object without changing child transforms', () => {
    const { engine } = createEngine()
    engine.addRect({ left: 10, top: 15 })
    engine.addRect({ left: 60, top: 45 })
    engine.selectAllLayers()
    const groupId = engine.groupSelection()!
    engine.updateSelectionTransform({ angle: 30, width: 140 })
    const group = findObject(engine, groupId) as Group
    const before = group.getXY()
    const children = group
      .getObjects()
      .map((object) => ({ left: object.left, top: object.top }))

    expect(engine.nudgeSelection(-1, 10)).toBe(true)
    expect(group.getXY().x).toBeCloseTo(before.x - 1)
    expect(group.getXY().y).toBeCloseTo(before.y + 10)
    expect(
      group
        .getObjects()
        .map((object) => ({ left: object.left, top: object.top })),
    ).toEqual(children)
    expect(group.angle).toBe(30)
  })

  it('moves a nested child in scene coordinates while retaining the group', () => {
    const { engine } = createEngine()
    const first = engine.addRect({ left: 10, top: 15 })
    engine.addRect({ left: 60, top: 45 })
    engine.selectAllLayers()
    const groupId = engine.groupSelection()!
    engine.updateSelectionTransform({ angle: 30, width: 140 })
    const group = findObject(engine, groupId) as Group
    const child = group.getObjects()[0]
    engine.selectLayer(first)
    const before = child.getXY()

    expect(engine.nudgeSelection(1, 0)).toBe(true)
    expect(child.getXY().x).toBeCloseTo(before.x + 1)
    expect(child.getXY().y).toBeCloseTo(before.y)
    expect(child.group).toBe(group)
  })

  it('ignores invalid, empty and locked selections without creating history', () => {
    const { engine, onChanged } = createEngine()
    expect(engine.nudgeSelection(1, 0)).toBe(false)
    const id = engine.addRect({ left: 10, top: 15 })
    const object = findObject(engine, id)
    engine.setLayerLocked(id, true)
    // Defensive API guard, even if an external caller activates a locked object.
    engine.getCanvas().setActiveObject(object)
    onChanged.mockClear()
    expect(engine.nudgeSelection(1, 0)).toBe(false)
    expect(engine.nudgeSelection(NaN, 0)).toBe(false)
    expect(engine.nudgeSelection(0, Infinity)).toBe(false)
    expect(engine.nudgeSelection(0, 0)).toBe(false)
    expect(object.getXY()).toMatchObject({ x: 10, y: 15 })
    expect(onChanged).not.toHaveBeenCalled()
  })

  it.each(['locked', 'hidden'] as const)(
    'preserves children of a %s parent in a mixed active selection',
    (restriction) => {
      const { engine, onChanged } = createEngine()
      const childId = engine.addRect({
        left: 10,
        top: 10,
        width: 20,
        height: 20,
      })
      engine.addRect({ left: 40, top: 10, width: 20, height: 20 })
      engine.selectAllLayers()
      const groupId = engine.groupSelection()!
      if (restriction === 'locked') engine.setLayerLocked(groupId, true)
      else engine.setLayerVisible(groupId, false)
      const freeId = engine.addRect({
        left: 80,
        top: 10,
        width: 20,
        height: 20,
      })
      const group = findObject(engine, groupId) as Group
      const child = group.getObjects()[0]
      const before = child.getXY()
      engine.selectLayer(childId)
      engine.selectLayer(freeId, true)
      expect(child.parent).toBe(group)
      expect(child.group).toBeInstanceOf(ActiveSelection)
      onChanged.mockClear()

      expect(engine.nudgeSelection(10, 0)).toBe(true)

      expect(child.getXY().x).toBeCloseTo(before.x)
      expect(child.getXY().y).toBeCloseTo(before.y)
      expect(findObject(engine, freeId).getXY().x).toBeCloseTo(90)
      expect(onChanged).toHaveBeenCalledExactlyOnceWith('object-modified')
    },
  )

  it('moves a grid cell and its owned image exactly once', () => {
    const { engine } = createEngine()
    const cellId = engine.addRect({
      left: 10,
      top: 15,
      width: 40,
      height: 30,
      strokeWidth: 0,
    })
    engine.markLayerAsGridCell(cellId)
    const source = document.createElement('canvas')
    source.width = 40
    source.height = 30
    const image = new FabricImage(source) as FabricImage & {
      editorKind: string
      editorGridCellId: string
      editorClipFrameId: string
    }
    image.editorKind = 'grid-cell-image'
    image.editorGridCellId = cellId
    image.editorClipFrameId = 'grid-image-frame'
    const frame = new Rect({
      width: 40,
      height: 30,
      absolutePositioned: true,
    }) as Rect & { editorId: string }
    frame.editorId = image.editorClipFrameId
    image.clipPath = frame
    engine.getCanvas().add(image)
    engine.selectLayer(cellId)
    engine.nudgeSelection(1, 0)
    const before = image.getXY()
    expect(engine.selectAllLayers()).toEqual([cellId])

    expect(engine.nudgeSelection(10, 1)).toBe(true)
    expect(image.getXY().x).toBeCloseTo(before.x + 10)
    expect(image.getXY().y).toBeCloseTo(before.y + 1)
    expect(findObject(engine, cellId).getXY()).toMatchObject({ x: 21, y: 16 })
  })
})
