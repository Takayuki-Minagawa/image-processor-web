import { afterEach, describe, expect, it, vi } from 'vitest'
import { FabricImage, Group, Point, util, type FabricObject } from 'fabric'
import { createBuiltinAssetRegistry } from '../assets'
import { setChartType } from '../charts'
import { updateTableCell } from '../tables'
import { createBuiltinTemplateRegistry } from '../templates'
import {
  expandTemplatePage,
  insertChartFromDelimitedText,
  insertLoadedAsset,
  insertTableFromDelimitedText,
} from './designStudioAdapter'
import { FabricEditorEngine } from './fabricEngine'

const engines = new Set<FabricEditorEngine>()

const pngHeaderDataUrl = (width: number, height: number): string => {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`
}

const decodedImage = (width = 80, height = 40): FabricImage => {
  const source = document.createElement('canvas')
  source.width = width
  source.height = height
  source.getContext('2d')?.fillRect(0, 0, width, height)
  return new FabricImage(source, { width, height })
}

const mockImageRestoration = (engine: FabricEditorEngine): void => {
  const image = engine
    .getCanvas()
    .getObjects()
    .find((object) => object instanceof FabricImage) as FabricImage | undefined
  if (!image) throw new Error('Missing grid image for restore test.')
  const source = document.createElement('canvas')
  source.width = image.width
  source.height = image.height
  source.getContext('2d')?.drawImage(image.getElement(), 0, 0)
  vi.spyOn(FabricImage, 'fromObject').mockImplementation(
    async (serialized, options) => {
      const record = serialized as Record<string, unknown>
      const object = { ...record }
      delete object.src
      delete object.type
      const hydrated = await util.enlivenObjectEnlivables(object, options)
      return new FabricImage(source, {
        ...object,
        ...hydrated,
      } as ConstructorParameters<typeof FabricImage>[1])
    },
  )
}

const createEngine = (onChanged = vi.fn()) => {
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const engine = new FabricEditorEngine(canvas, {
    width: 1080,
    height: 1080,
    callbacks: { onChanged },
  })
  engines.add(engine)
  return { engine, onChanged }
}

afterEach(async () => {
  await Promise.all([...engines].map((engine) => engine.dispose()))
  engines.clear()
  document.body.replaceChildren()
})

describe('design studio Fabric adapter', () => {
  it('inserts a deferred procedural asset as an editable layer', async () => {
    const { engine } = createEngine()
    const asset = await createBuiltinAssetRegistry().loadAsset('shape-star')
    const id = await engine.runAtomic('asset', () =>
      insertLoadedAsset(engine, asset),
    )
    expect(engine.getLayers()).toEqual([
      expect.objectContaining({ id, name: asset.name.en }),
    ])
  })

  it('places a dragged asset around its bounded document point', async () => {
    const { engine } = createEngine()
    const asset = await createBuiltinAssetRegistry().loadAsset('shape-star')
    const id = await engine.runAtomic('asset', () =>
      insertLoadedAsset(engine, asset, { x: 180, y: 220 }),
    )
    expect(engine.getSelectionTransform()).toMatchObject({ id })
    const transform = engine.getSelectionTransform()!
    expect(transform.left + transform.width / 2).toBeCloseTo(180)
    expect(transform.top + transform.height / 2).toBeCloseTo(220)
  })

  it('expands a photo grid into independently editable grouped cells', async () => {
    const { engine } = createEngine()
    const asset =
      await createBuiltinAssetRegistry().loadAsset('grid-three-columns')
    const groupId = await engine.runAtomic('asset', () =>
      insertLoadedAsset(engine, asset),
    )
    const tree = engine.getLayerTree()
    expect(tree.filter(({ parentId }) => parentId === groupId)).toHaveLength(3)
    expect(tree.find(({ id }) => id === groupId)).toMatchObject({
      hasChildren: true,
      name: asset.name.en,
    })
  })

  it('moves a selected grid boundary once and persists the bounded cell geometry', async () => {
    const { engine, onChanged } = createEngine()
    const asset =
      await createBuiltinAssetRegistry().loadAsset('grid-three-columns')
    const groupId = await engine.runAtomic('asset', () =>
      insertLoadedAsset(engine, asset),
    )
    onChanged.mockClear()
    const boundaries = engine.getSelectedGridBoundaries()
    expect(boundaries).toHaveLength(2)

    expect(engine.moveSelectedGridBoundary(boundaries[0].id, 0.45)).toBe(true)
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledWith('asset')
    const movedPosition = engine.getSelectedGridBoundaries()[0].position
    expect(movedPosition).toBeCloseTo(0.45)

    const snapshot = engine.snapshot()
    const { engine: restored } = createEngine()
    await restored.restore(snapshot)
    restored.selectLayer(groupId)
    expect(restored.getSelectedGridBoundaries()[0].position).toBeCloseTo(
      movedPosition,
    )
  })

  it('deletes grid-owned images together with their selected group', async () => {
    const { engine } = createEngine()
    const asset =
      await createBuiltinAssetRegistry().loadAsset('grid-two-columns')
    const groupId = await engine.runAtomic('asset', () =>
      insertLoadedAsset(engine, asset),
    )
    const cellIds = engine
      .getLayerTree()
      .filter(({ parentId }) => parentId === groupId)
      .map(({ id }) => id)
    vi.spyOn(FabricImage, 'fromURL')
      .mockResolvedValueOnce(decodedImage())
      .mockResolvedValueOnce(decodedImage())
    await engine.fillGridCell(cellIds[0], pngHeaderDataUrl(80, 40), 'Left')
    await engine.fillGridCell(cellIds[1], pngHeaderDataUrl(80, 40), 'Right')

    engine.selectLayer(groupId)
    expect(engine.deleteSelection()).toBe(true)
    expect(engine.getCanvas().getObjects()).toHaveLength(0)
  })

  it('duplicates grid-owned images with remapped cell and clip ownership', async () => {
    const { engine } = createEngine()
    const asset =
      await createBuiltinAssetRegistry().loadAsset('grid-two-columns')
    const groupId = await engine.runAtomic('asset', () =>
      insertLoadedAsset(engine, asset),
    )
    const originalCellIds = engine
      .getLayerTree()
      .filter(({ parentId }) => parentId === groupId)
      .map(({ id }) => id)
    vi.spyOn(FabricImage, 'fromURL')
      .mockResolvedValueOnce(decodedImage())
      .mockResolvedValueOnce(decodedImage())
    await engine.fillGridCell(
      originalCellIds[0],
      pngHeaderDataUrl(80, 40),
      'Left',
    )
    await engine.fillGridCell(
      originalCellIds[1],
      pngHeaderDataUrl(80, 40),
      'Right',
    )
    engine.selectLayer(groupId)
    mockImageRestoration(engine)

    const [duplicateGroupId] = await engine.duplicateSelection()
    const duplicateCellIds = engine
      .getLayerTree()
      .filter(({ parentId }) => parentId === duplicateGroupId)
      .map(({ id }) => id)
    expect(duplicateCellIds).toHaveLength(2)
    expect(duplicateCellIds).not.toEqual(originalCellIds)
    expect(duplicateCellIds.some((id) => originalCellIds.includes(id))).toBe(
      false,
    )

    const images = engine
      .getCanvas()
      .getObjects()
      .filter((object) => object instanceof FabricImage) as Array<
      FabricImage & {
        editorGridCellId?: string
        editorClipFrameId?: string
      }
    >
    expect(images).toHaveLength(4)
    expect(
      images.filter(({ editorGridCellId }) =>
        duplicateCellIds.includes(editorGridCellId ?? ''),
      ),
    ).toHaveLength(2)
    images.forEach((image) => {
      expect(image.editorClipFrameId).toBeTruthy()
      expect(
        (image.clipPath as FabricObject & { editorId?: string }).editorId,
      ).toBe(image.editorClipFrameId)
    })
  })

  it('copies, cuts, and pastes a filled grid without orphaning its images', async () => {
    const { engine } = createEngine()
    const asset =
      await createBuiltinAssetRegistry().loadAsset('grid-two-columns')
    const groupId = await engine.runAtomic('asset', () =>
      insertLoadedAsset(engine, asset),
    )
    const cellId = engine
      .getLayerTree()
      .find(({ parentId }) => parentId === groupId)!.id
    vi.spyOn(FabricImage, 'fromURL').mockResolvedValue(decodedImage())
    await engine.fillGridCell(cellId, pngHeaderDataUrl(80, 40), 'Photo')
    engine.selectLayer(groupId)
    mockImageRestoration(engine)

    expect(await engine.copySelection()).toBe(true)
    const [pastedGroupId] = await engine.pasteSelection()
    expect(pastedGroupId).toBeTruthy()
    expect(
      engine
        .getCanvas()
        .getObjects()
        .filter((object) => object instanceof FabricImage),
    ).toHaveLength(2)

    expect(await engine.cutSelection()).toBe(true)
    expect(engine.getLayerTree().some(({ id }) => id === pastedGroupId)).toBe(
      false,
    )
    expect(await engine.pasteSelection()).toHaveLength(1)

    const cellIds = new Set(
      engine
        .getLayerTree()
        .filter(({ type }) => type === 'grid-cell')
        .map(({ id }) => id),
    )
    const images = engine
      .getCanvas()
      .getObjects()
      .filter((object) => object instanceof FabricImage) as Array<
      FabricImage & { editorGridCellId?: string }
    >
    expect(images).toHaveLength(2)
    expect(
      images.every(
        ({ editorGridCellId }) =>
          Boolean(editorGridCellId) && cellIds.has(editorGridCellId!),
      ),
    ).toBe(true)
  })

  it('propagates grid visibility and moves the filled grid as one front stack', async () => {
    const { engine } = createEngine()
    const asset =
      await createBuiltinAssetRegistry().loadAsset('grid-two-columns')
    const groupId = await engine.runAtomic('asset', () =>
      insertLoadedAsset(engine, asset),
    )
    const cellId = engine
      .getLayerTree()
      .find(({ parentId }) => parentId === groupId)!.id
    vi.spyOn(FabricImage, 'fromURL').mockResolvedValue(decodedImage())
    await engine.fillGridCell(cellId, pngHeaderDataUrl(80, 40), 'Photo')
    const image = engine
      .getCanvas()
      .getObjects()
      .find((object) => object instanceof FabricImage)!
    const overlayId = engine.addRect({ name: 'Overlay' })

    expect(engine.setLayerVisible(groupId, false)).toBe(true)
    expect(image.visible).toBe(false)
    expect(engine.setLayerVisible(groupId, true)).toBe(true)
    expect(image.visible).toBe(true)
    expect(engine.moveLayerToFront(groupId)).toBe(true)

    const order = engine.getCanvas().getObjects()
    const groupIndex = order.findIndex(
      (object) =>
        (object as FabricObject & { editorId?: string }).editorId === groupId,
    )
    const imageIndex = order.indexOf(image)
    const overlayIndex = order.findIndex(
      (object) =>
        (object as FabricObject & { editorId?: string }).editorId === overlayId,
    )
    expect(overlayIndex).toBeLessThan(groupIndex)
    expect(groupIndex).toBeLessThan(imageIndex)
    expect(
      engine.getLayers().some(({ type }) => type === 'grid-cell-image'),
    ).toBe(false)

    engine.selectLayer(groupId)
    engine.selectLayer(overlayId, true)
    expect(engine.groupSelection('Unsafe outer group')).toBeNull()
    expect(engine.getCanvas().getObjects()).toContain(image)
    expect(engine.getLayerTree().some(({ id }) => id === groupId)).toBe(true)
  })

  it('fills, replaces, follows, restores, and exports a dropped grid image', async () => {
    const { engine } = createEngine()
    const asset =
      await createBuiltinAssetRegistry().loadAsset('grid-two-columns')
    const groupId = await engine.runAtomic('asset', () =>
      insertLoadedAsset(engine, asset),
    )
    const cellId = engine
      .getLayerTree()
      .find(({ parentId }) => parentId === groupId)!.id
    const group = engine
      .getCanvas()
      .getObjects()
      .find(
        (object) =>
          (object as FabricObject & { editorId?: string }).editorId === groupId,
      )
    expect(group).toBeInstanceOf(Group)
    const cell = (group as Group)
      .getObjects()
      .find(
        (object) =>
          (object as FabricObject & { editorId?: string }).editorId === cellId,
      )!
    const bounds = cell.getBoundingRect()
    vi.spyOn(engine.getCanvas(), 'getScenePoint').mockReturnValue(
      new Point(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2),
    )
    expect(engine.getCanvasDropTarget(new MouseEvent('drop'))).toMatchObject({
      gridCellId: cellId,
    })

    const first = decodedImage()
    const second = decodedImage()
    const disposeFirst = vi.spyOn(first, 'dispose')
    vi.spyOn(FabricImage, 'fromURL')
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
    await engine.fillGridCell(cellId, pngHeaderDataUrl(80, 40), 'First')
    await engine.fillGridCell(cellId, pngHeaderDataUrl(80, 40), 'Second')
    expect(disposeFirst).toHaveBeenCalledOnce()

    const selectedImage = engine.getCanvas().getActiveObject() as FabricObject
    const frameWidthBefore = selectedImage.clipPath?.getScaledWidth()
    const [gridBoundary] = engine.getSelectedGridBoundaries()
    expect(gridBoundary).toBeDefined()
    expect(engine.moveSelectedGridBoundary(gridBoundary.id, 0.6)).toBe(true)
    expect(selectedImage.clipPath?.getScaledWidth()).not.toBe(frameWidthBefore)

    const beforeMove = (
      engine.snapshot().json.objects as Array<Record<string, unknown>>
    ).find(({ editorKind }) => editorKind === 'grid-cell-image')!
    engine.selectLayer(groupId)
    const groupTransform = engine.getSelectionTransform()!
    engine.updateSelectionTransform({
      left: groupTransform.left + 32,
      top: groupTransform.top + 18,
      width: groupTransform.width * 0.8,
      height: groupTransform.height * 0.8,
    })
    const snapshot = engine.snapshot()
    const afterMove = (
      snapshot.json.objects as Array<Record<string, unknown>>
    ).find(({ editorKind }) => editorKind === 'grid-cell-image')!
    expect(Number(afterMove.left)).toBeGreaterThan(Number(beforeMove.left))
    expect(afterMove).toMatchObject({
      editorGridCellId: cellId,
      clipPath: {
        type: 'Rect',
        absolutePositioned: true,
        editorKind: 'frame',
      },
    })
    expect(await engine.exportSvg('document')).toContain('<clipPath')

    mockImageRestoration(engine)
    const { engine: restored } = createEngine()
    await restored.restore(snapshot)
    const restoredImage = (
      restored.snapshot().json.objects as Array<Record<string, unknown>>
    ).find(({ editorKind }) => editorKind === 'grid-cell-image')
    expect(restoredImage).toMatchObject({
      editorGridCellId: cellId,
      clipPath: { editorKind: 'frame' },
    })
    expect(await restored.exportSvg('document')).toContain('<clipPath')
  })

  it('fills a catalog frame through the existing clip-frame adapter', async () => {
    const { engine } = createEngine()
    const asset = await createBuiltinAssetRegistry().loadAsset('frame-circle')
    const frameId = await engine.runAtomic('asset', () =>
      insertLoadedAsset(engine, asset),
    )
    const frame = engine.getCanvas().getObjects()[0]
    const bounds = frame.getBoundingRect()
    vi.spyOn(engine.getCanvas(), 'getScenePoint').mockReturnValue(
      new Point(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2),
    )
    expect(engine.getCanvasDropTarget(new MouseEvent('drop'))).toMatchObject({
      frameLayerId: frameId,
    })

    vi.spyOn(FabricImage, 'fromURL').mockResolvedValue(decodedImage())
    const imageId = await engine.fillDropFrame(
      frameId,
      pngHeaderDataUrl(80, 40),
      'Portrait',
    )
    const record = (
      engine.snapshot().json.objects as Array<Record<string, unknown>>
    ).find(({ editorId }) => editorId === imageId)
    expect(record).toMatchObject({
      editorClipFrameId: frameId,
      clipPath: { editorId: frameId, editorKind: 'frame' },
    })
    expect(await engine.exportSvg('document')).toContain('<clipPath')
  })

  it('expands a template page into ordinary layers in one transaction', async () => {
    const { engine, onChanged } = createEngine()
    const { template } =
      await createBuiltinTemplateRegistry().loadTemplate('social-bold')
    const result = await expandTemplatePage(engine, template)
    expect(result.warnings).toEqual([])
    expect(result.addedLayerIds.length).toBeGreaterThan(1)
    expect(engine.getLayers()).toHaveLength(result.addedLayerIds.length)
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenLastCalledWith('template')
    const textLayers = (
      engine.snapshot().json.objects as Array<Record<string, unknown>>
    ).filter(({ type }) => String(type).toLocaleLowerCase().includes('text'))
    expect(textLayers.length).toBeGreaterThan(0)
    expect(textLayers.every(({ scaleY }) => Number(scaleY) === 1)).toBe(true)
  })

  it('turns CSV data into safe chart and table SVG layers', async () => {
    const { engine } = createEngine()
    const source = 'Month,Sales\nJan,10\nFeb,20'
    const chartId = await insertChartFromDelimitedText(engine, 'bar', source, [
      '#6757E8',
    ])
    const tableId = await insertTableFromDelimitedText(engine, source)
    expect(engine.getLayers().map(({ name }) => name)).toEqual([
      'Table',
      'Chart',
    ])
    expect(engine.getChartLayer(chartId)).toMatchObject({
      layerId: chartId,
      model: {
        schemaVersion: 1,
        type: 'bar',
        data: { labels: ['Jan', 'Feb'] },
      },
      palette: ['#6757e8'],
    })
    const chartCopy = engine.getChartLayer(chartId)!
    chartCopy.model.title = 'Mutated outside the engine'
    chartCopy.palette[0] = '#000000'
    expect(engine.getChartLayer(chartId)).toMatchObject({
      model: { title: '' },
      palette: ['#6757e8'],
    })
    expect(engine.getTableLayer(tableId)).toMatchObject({
      layerId: tableId,
      model: {
        schemaVersion: 1,
        rows: [
          { cells: [{ text: 'Month' }, { text: 'Sales' }] },
          { cells: [{ text: 'Jan' }, { text: '10' }] },
          { cells: [{ text: 'Feb' }, { text: '20' }] },
        ],
      },
    })
    expect(await engine.exportSvg('document')).not.toMatch(/<script/iu)
  })

  it('persists semantic chart and table metadata through snapshots', async () => {
    const { engine } = createEngine()
    const source = 'Month,Sales\nJan,10\nFeb,20'
    const chartId = await insertChartFromDelimitedText(engine, 'pie', source, [
      '#0ea5e9',
      '#14b8a6',
    ])
    const tableId = await insertTableFromDelimitedText(engine, source)
    const snapshot = engine.snapshot()
    const records = snapshot.json.objects as Array<Record<string, unknown>>
    expect(records[0]).toMatchObject({
      editorId: chartId,
      editorKind: 'chart',
      editorChartModel: { schemaVersion: 1, type: 'pie' },
      editorChartPalette: ['#0ea5e9', '#14b8a6'],
    })
    expect(records[1]).toMatchObject({
      editorId: tableId,
      editorKind: 'table',
      editorTableModel: { schemaVersion: 1 },
    })

    const { engine: restored } = createEngine()
    await restored.restore(snapshot)
    expect(restored.getChartLayer(chartId)).toEqual(
      engine.getChartLayer(chartId),
    )
    expect(restored.getTableLayer(tableId)).toEqual(
      engine.getTableLayer(tableId),
    )
    expect(await restored.exportSvg('document')).not.toMatch(/<script/iu)
  })

  it('updates semantic layers in one mutation and supports snapshot undo/redo', async () => {
    const { engine, onChanged } = createEngine()
    const source = 'Month,Sales\nJan,10\nFeb,20'
    const chartId = await insertChartFromDelimitedText(engine, 'bar', source, [
      '#6757e8',
    ])
    const tableId = await insertTableFromDelimitedText(engine, source)
    engine.selectLayer(chartId)
    engine.updateSelectionTransform({ left: 72, top: 96, angle: 8 })
    const chartObjectBefore = engine
      .getCanvas()
      .getObjects()
      .find(
        (object) =>
          (object as unknown as { editorId?: string }).editorId === chartId,
      )
    expect(chartObjectBefore).toBeTruthy()
    const transformBefore = {
      left: chartObjectBefore!.left,
      top: chartObjectBefore!.top,
      angle: chartObjectBefore!.angle,
    }

    const beforeChartUpdate = engine.snapshot()
    const chart = engine.getChartLayer(chartId)!
    onChanged.mockClear()
    expect(
      await engine.updateChartLayer(
        {
          ...setChartType(chart.model, 'line'),
          title: 'Updated revenue',
        },
        { palette: ['#ABCDEF'] },
      ),
    ).toBe(true)
    expect(onChanged).toHaveBeenCalledOnce()
    expect(onChanged).toHaveBeenLastCalledWith('chart')
    expect(engine.getChartLayer(chartId)).toMatchObject({
      layerId: chartId,
      model: { type: 'line', title: 'Updated revenue' },
      palette: ['#abcdef'],
    })
    const chartObjectAfter = engine
      .getCanvas()
      .getObjects()
      .find(
        (object) =>
          (object as unknown as { editorId?: string }).editorId === chartId,
      )
    expect(chartObjectAfter).toMatchObject(transformBefore)
    const afterChartUpdate = engine.snapshot()

    await engine.restore(beforeChartUpdate)
    expect(engine.getChartLayer(chartId)?.model).toMatchObject({
      type: 'bar',
      title: '',
    })
    await engine.restore(afterChartUpdate)
    expect(engine.getChartLayer(chartId)?.model).toMatchObject({
      type: 'line',
      title: 'Updated revenue',
    })

    const table = engine.getTableLayer(tableId)!
    onChanged.mockClear()
    expect(
      await engine.updateTableLayer(
        updateTableCell(table.model, 1, 1, { text: '42' }),
        { id: tableId },
      ),
    ).toBe(true)
    expect(onChanged).toHaveBeenCalledOnce()
    expect(onChanged).toHaveBeenLastCalledWith('table')
    expect(engine.getTableLayer(tableId)?.model.rows[1].cells[1].text).toBe(
      '42',
    )
    expect(await engine.exportSvg('document')).toContain('Updated revenue')
    expect(await engine.exportSvg('document')).toContain('42')
  })
})
