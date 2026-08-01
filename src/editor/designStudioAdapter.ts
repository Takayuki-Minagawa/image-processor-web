import type { LoadedAsset, ShapeDefinition } from '../assets'
import type { BrandKit } from '../brand'
import type { ChartType } from '../charts'
import type { DesignTemplate, TemplateColor, TemplateFont } from '../templates'
import type { FabricEditorEngine, DesignShapeKind } from './fabricEngine'

export interface TemplateExpansionResult {
  addedLayerIds: string[]
  warnings: string[]
}

export interface AssetInsertionPoint {
  x: number
  y: number
}

const shapeKind = (definition: ShapeDefinition): DesignShapeKind => {
  switch (definition.type) {
    case 'rounded-rectangle':
      return 'rounded-rectangle'
    case 'polygon':
      return definition.sides === 3 ? 'triangle' : 'pentagon'
    case 'star':
      return 'star'
    case 'arrow':
      return 'arrow'
    case 'speech-bubble':
      return 'speech-bubble'
    case 'line':
      return 'line'
  }
}

/** Expands a deferred asset payload at the Fabric adapter boundary. */
export async function insertLoadedAsset(
  engine: FabricEditorEngine,
  asset: LoadedAsset,
  insertionPoint?: AssetInsertionPoint,
): Promise<string> {
  const placeAtInsertionPoint = (id: string): string => {
    if (
      !insertionPoint ||
      !Number.isFinite(insertionPoint.x) ||
      !Number.isFinite(insertionPoint.y)
    ) {
      return id
    }
    engine.selectLayer(id)
    const transform = engine.getSelectionTransform()
    if (!transform) return id
    const documentSize = engine.getDocumentSize()
    const x = Math.min(documentSize.width, Math.max(0, insertionPoint.x))
    const y = Math.min(documentSize.height, Math.max(0, insertionPoint.y))
    engine.updateSelectionTransform({
      left: x - transform.width / 2,
      top: y - transform.height / 2,
    })
    return id
  }

  if (asset.payload.type === 'svg') {
    return placeAtInsertionPoint(
      await engine.importSvg(asset.payload.source, asset.name.en),
    )
  }
  if (asset.payload.type === 'grid') {
    const grid = asset.payload
    const documentSize = engine.getDocumentSize()
    const extent = Math.min(documentSize.width, documentSize.height) * 0.68
    const left = (documentSize.width - extent) / 2
    const top = (documentSize.height - extent) / 2
    const ids = grid.cells.map((cell) => {
      const id = engine.addRect({
        left: left + cell.x * extent,
        top: top + cell.y * extent,
        width: cell.width * extent,
        height: cell.height * extent,
        fill: '#e2e8f0',
        stroke: '#64748b',
        strokeWidth: Math.max(1, grid.gapRatio * extent * 0.25),
        name: `${asset.name.en} · ${cell.id}`,
      })
      if (!engine.markLayerAsGridCell(id)) {
        throw new Error(`Grid cell ${cell.id} could not be initialized.`)
      }
      return id
    })
    ids.forEach((id, index) => engine.selectLayer(id, index > 0))
    return placeAtInsertionPoint(engine.groupSelection(asset.name.en) ?? ids[0])
  }
  if (
    asset.payload.type === 'frame' &&
    asset.payload.clipShape.type === 'polygon' &&
    asset.payload.clipShape.sides >= 24
  ) {
    const id = engine.addEllipse({ name: asset.name.en })
    if (!engine.markLayerAsDropFrame(id)) {
      throw new Error(`Frame ${asset.id} could not be initialized.`)
    }
    return placeAtInsertionPoint(id)
  }
  const definition =
    asset.payload.type === 'frame'
      ? asset.payload.clipShape
      : asset.payload.definition
  const id = engine.addDesignShape(shapeKind(definition), {
    name: asset.name.en,
  })
  if (asset.payload.type === 'frame' && !engine.markLayerAsDropFrame(id)) {
    throw new Error(`Frame ${asset.id} could not be initialized.`)
  }
  return placeAtInsertionPoint(id)
}

const fallbackBrandColors: Record<string, string> = {
  primary: '#6757e8',
  secondary: '#0ea5e9',
  accent: '#f59e0b',
  background: '#ffffff',
  foreground: '#111827',
}

const resolveColor = (value: TemplateColor, brand?: BrandKit): string => {
  if (typeof value === 'string') return value
  return (
    brand?.palettes[0]?.colors[value.role] ?? fallbackBrandColors[value.role]
  )
}

const templateShapeKind = (assetId: string): DesignShapeKind => {
  if (assetId.includes('triangle')) return 'triangle'
  if (assetId.includes('star')) return 'star'
  if (assetId.includes('arrow')) return 'arrow'
  if (assetId.includes('speech')) return 'speech-bubble'
  if (assetId.includes('line')) return 'line'
  if (assetId.includes('arch')) return 'arch'
  if (assetId.includes('polygon') || assetId.includes('pentagon'))
    return 'pentagon'
  return 'rounded-rectangle'
}

const fontFamily = (font: TemplateFont, brand?: BrandKit): string => {
  if ('type' in font) {
    const reference =
      font.role === 'body'
        ? brand?.fonts.body
        : font.role === 'subheading'
          ? (brand?.fonts.subheading ?? brand?.fonts.heading)
          : brand?.fonts.heading
    return reference
      ? `${reference.family}, ${reference.fallback}`
      : 'system-ui, sans-serif'
  }
  return `${font.family}, ${font.fallback}`
}

/**
 * Expands one template page into ordinary editable engine layers. The outer
 * transaction intentionally turns a many-layer expansion into one undo step.
 */
export async function expandTemplatePage(
  engine: FabricEditorEngine,
  template: DesignTemplate,
  pageIndex = 0,
  brand?: BrandKit,
): Promise<TemplateExpansionResult> {
  const page = template.document.pages[pageIndex]
  if (!page)
    throw new RangeError(`Template page ${pageIndex + 1} does not exist.`)
  const addedLayerIds: string[] = []
  const warnings: string[] = []

  await engine.runAtomic('template', async () => {
    engine.magicResize(
      template.document.width,
      template.document.height,
      'center',
      'fit',
    )
    engine.setSolidBackground(resolveColor(page.background, brand))
    for (const element of page.elements) {
      try {
        if (element.kind === 'text') {
          const id = engine.addText(element.text, {
            left: element.x,
            top: element.y,
            width: element.width,
            fontFamily: fontFamily(element.font, brand),
            fontSize: element.fontSize,
            fontWeight: element.fontWeight,
            fill: resolveColor(element.color, brand),
            layoutMode:
              element.resizeMode === 'auto-width'
                ? 'auto'
                : element.resizeMode === 'fixed'
                  ? 'fixed'
                  : 'wrap',
            vertical: element.writingMode === 'vertical-rl',
            name: element.id,
          })
          engine.updateSelectionTransform({
            left: element.x,
            top: element.y,
            width: element.width,
            height: element.height,
            angle: element.rotation,
          })
          engine.setSelectedTextStyle({
            fill: resolveColor(element.color, brand),
            charSpacing: element.letterSpacing,
            lineHeight: element.lineHeight,
          })
          engine.setLayerOpacity(id, element.opacity)
          addedLayerIds.push(id)
          continue
        }
        if (element.kind === 'shape') {
          const id = engine.addDesignShape(
            templateShapeKind(element.shapeAssetId),
            {
              left: element.x,
              top: element.y,
              width: element.width,
              height: element.height,
              fill:
                element.fill === 'none'
                  ? 'transparent'
                  : resolveColor(element.fill, brand),
              stroke:
                element.stroke === 'none'
                  ? 'transparent'
                  : resolveColor(element.stroke, brand),
              strokeWidth: element.strokeWidth,
              name: element.id,
            },
          )
          engine.updateSelectionTransform({ angle: element.rotation })
          engine.setLayerOpacity(id, element.opacity)
          addedLayerIds.push(id)
          continue
        }
        if (element.kind === 'image-placeholder') {
          const id = engine.addRect({
            left: element.x,
            top: element.y,
            width: element.width,
            height: element.height,
            fill: '#e2e8f0',
            stroke: '#64748b',
            strokeWidth: 2,
            name: element.label,
          })
          engine.updateSelectionTransform({ angle: element.rotation })
          engine.setLayerOpacity(id, element.opacity)
          addedLayerIds.push(id)
          continue
        }
        warnings.push(
          `Asset reference ${element.id} needs a local asset mapping.`,
        )
      } catch (error) {
        warnings.push(
          `${element.id}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  })
  return { addedLayerIds, warnings }
}

export async function insertChartFromDelimitedText(
  engine: FabricEditorEngine,
  type: ChartType,
  source: string,
  palette: readonly string[],
): Promise<string> {
  const [{ delimitedTextToChartData }, charts] = await Promise.all([
    import('../data'),
    import('../charts'),
  ])
  const { data } = delimitedTextToChartData(source, { firstRowIsHeader: true })
  const model = charts.createChartModel(type, data, {
    style: { background: '#ffffff', foreground: '#111827' },
  })
  return engine.insertChartModel(model, palette, 'Chart')
}

export async function insertTableFromDelimitedText(
  engine: FabricEditorEngine,
  source: string,
): Promise<string> {
  const { delimitedTextToTable } = await import('../data')
  const { table } = delimitedTextToTable(source, { firstRowIsHeader: true })
  return engine.insertTableModel(table, 'Table')
}
