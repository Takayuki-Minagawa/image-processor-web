import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import {
  Boxes,
  ChartColumn,
  Download,
  FileStack,
  Film,
  Palette,
  Plus,
  Search,
  Sparkles,
  Type,
} from 'lucide-react'
import {
  createBuiltinAssetRegistry,
  writeBuiltinAssetDragPayload,
  type LoadedAsset,
  type UserAssetMetadata,
} from '../assets'
import {
  createBuiltinFontRegistry,
  detectUserFontFormat,
  type UserFontMetadata,
} from '../fonts'
import { createBuiltinTemplateRegistry } from '../templates'
import {
  DESIGN_SIZE_PRESETS,
  presetPixelDimensions,
} from '../editor/designPresets'
import type {
  GridBoundaryInfo,
  MagicResizeMode,
  ResizeAnchor,
  TextEffectPreset,
  TextLayoutMode,
} from '../editor/fabricEngine'
import type {
  ProjectAnimationPreset,
  ProjectPageTimeline,
  ProjectPageTransition,
} from '../editor/types'
import { designStudioCopy } from '../i18n.design'
import type { AppLocale } from '../uiPreferences'
import type { ChartModel, ChartType } from '../charts'
import {
  chartDataToDelimitedText,
  delimitedTextToTable,
  parseDelimitedText,
  serializeDelimitedRows,
  tableModelToDelimitedText,
} from '../data'
import {
  resizeTableColumn,
  resizeTableRow,
  updateTableCell,
  type TableModel,
} from '../tables'
import { resolveAnimationSchedule } from '../animation/timeline'
import './DesignStudioPanel.css'

interface LocalFontDataLike {
  family: string
  fullName: string
  postscriptName: string
  blob(): Promise<Blob>
}

type WindowWithLocalFonts = Window & {
  queryLocalFonts?: () => Promise<LocalFontDataLike[]>
}

export interface DesignPageSummary {
  id: string
  name: string
  width: number
  height: number
  thumbnail?: string
  durationMs: number
  timeline?: ProjectPageTimeline
}

export interface DesignTextRequest {
  text: string
  fontFamily: string
  fontSize: number
  layoutMode: TextLayoutMode
  vertical: boolean
}

export interface DesignChartRequest {
  type: ChartType
  csv: string
  palette: string[]
}

export type DesignSelectedData =
  | {
      kind: 'chart'
      layerId: string
      model: ChartModel
      palette: string[]
    }
  | { kind: 'table'; layerId: string; model: TableModel }

export type DesignDataUpdateRequest =
  | ({ kind: 'chart'; layerId: string } & DesignChartRequest)
  | { kind: 'table'; layerId: string; model: TableModel }

export interface DesignBrandInput {
  name: string
  primary: string
  secondary: string
  accent: string
  headingFont: string
  bodyFont: string
}

export interface DesignBrandSummary {
  id: string
  name: string
  colors: {
    primary: string
    secondary: string
    accent: string
  }
  fonts: {
    heading: { family: string; fallback: string; sourceId?: string }
    body: { family: string; fallback: string; sourceId?: string }
  }
}

export interface DesignExportRequest {
  format: 'pdf' | 'gif' | 'video' | 'png-zip'
  scope: 'active' | 'all' | 'selected'
  selectedPageIds: string[]
  dpi: number
  bleedMm: number
  cropMarks: boolean
}

export interface DesignExportProgress {
  value: number
  label: string
}

export interface DesignPageSizeRequest {
  width: number
  height: number
  physicalSize?: {
    unit: 'mm'
    widthMm: number
    heightMm: number
    sourceDpi: number
  }
}

export interface DesignStudioPanelProps {
  locale: AppLocale
  pages: readonly DesignPageSummary[]
  activePageId: string
  selectedLayerIds: readonly string[]
  gridBoundaries: readonly GridBoundaryInfo[]
  onAddPage: (size?: DesignPageSizeRequest) => void | Promise<void>
  onDuplicatePage: () => void | Promise<void>
  onDeletePage: () => void | Promise<void>
  onSelectPage: (pageId: string) => void | Promise<void>
  onReorderPage: (pageId: string, direction: -1 | 1) => void
  onMagicResize: (
    width: number,
    height: number,
    anchor: ResizeAnchor,
    mode: MagicResizeMode,
  ) => void
  onBackground: (
    background:
      | { kind: 'color'; color: string }
      | { kind: 'gradient'; start: string; end: string; angle: number },
  ) => void
  onInsertAsset: (asset: LoadedAsset) => void | Promise<void>
  onMoveGridBoundary: (boundaryId: string, position: number) => void
  onImportUserAsset: (file: File) => void | Promise<void>
  userAssets: readonly UserAssetMetadata[]
  onUseUserAsset: (assetId: string) => void | Promise<void>
  onRemoveUserAsset: (assetId: string) => void | Promise<void>
  onGroup: () => void
  onUngroup: () => void
  onClip: () => void
  onReleaseClip: () => void
  onApplyMask: () => void
  onSetMaskEnabled: (enabled: boolean) => void
  onRemoveMask: () => void
  onRasterizeMask: () => void | Promise<void>
  onInsertText: (request: DesignTextRequest) => void
  onSetFont: (fontFamily: string) => void
  userFonts: readonly UserFontMetadata[]
  onImportUserFont: (file: File) => void | Promise<void>
  onRemoveUserFont: (fontId: string) => void | Promise<void>
  onTextEffect: (preset: TextEffectPreset) => void
  onApplyTemplate: (templateId: string) => void | Promise<void>
  onImportTemplate: (file: File) => void | Promise<void>
  onExportTemplate: () => void | Promise<void>
  onSaveBrand: (brand: DesignBrandInput) => void | Promise<void>
  savedBrands: readonly DesignBrandSummary[]
  activeBrandId?: string
  onSelectBrand: (brandId: string) => void
  onRemoveBrand: (brandId: string) => void | Promise<void>
  onInsertChart: (request: DesignChartRequest) => void | Promise<void>
  onInsertTable: (csv: string) => void | Promise<void>
  selectedData?: DesignSelectedData
  onUpdateData: (request: DesignDataUpdateRequest) => void | Promise<void>
  onTimeline: (timeline: ProjectPageTimeline) => void
  onPreviewMotion: (playing: boolean) => void
  onExport: (request: DesignExportRequest) => void | Promise<void>
  exportProgress?: DesignExportProgress
  onCancelExport: () => void
}

type DesignTab =
  'pages' | 'elements' | 'text' | 'templates' | 'data' | 'motion' | 'export'

const TABS: Array<{ id: DesignTab; icon: typeof FileStack }> = [
  { id: 'pages', icon: FileStack },
  { id: 'elements', icon: Boxes },
  { id: 'text', icon: Type },
  { id: 'templates', icon: Palette },
  { id: 'data', icon: ChartColumn },
  { id: 'motion', icon: Film },
  { id: 'export', icon: Download },
]

const TEMPLATE_CATEGORY_COLORS: Record<string, string> = {
  social: '#7c3aed',
  thumbnail: '#ea580c',
  banner: '#0891b2',
  'business-card': '#0f766e',
  flyer: '#db2777',
  presentation: '#2563eb',
}

const DEFAULT_CSV = `Category,Series A,Series B
Jan,12,8
Feb,19,14
Mar,15,22
Apr,27,18`

type TextListStyle = 'none' | 'bullet' | 'number'

const formatDesignTextList = (value: string, style: TextListStyle): string => {
  if (style === 'none') return value
  return value
    .split(/\r?\n/u)
    .map((line, index) =>
      style === 'bullet' ? `• ${line}` : `${index + 1}. ${line}`,
    )
    .join('\n')
}

export default function DesignStudioPanel({
  locale,
  pages,
  activePageId,
  selectedLayerIds,
  gridBoundaries,
  onAddPage,
  onDuplicatePage,
  onDeletePage,
  onSelectPage,
  onReorderPage,
  onMagicResize,
  onBackground,
  onInsertAsset,
  onMoveGridBoundary,
  onImportUserAsset,
  userAssets,
  onUseUserAsset,
  onRemoveUserAsset,
  onGroup,
  onUngroup,
  onClip,
  onReleaseClip,
  onApplyMask,
  onSetMaskEnabled,
  onRemoveMask,
  onRasterizeMask,
  onInsertText,
  onSetFont,
  userFonts,
  onImportUserFont,
  onRemoveUserFont,
  onTextEffect,
  onApplyTemplate,
  onImportTemplate,
  onExportTemplate,
  onSaveBrand,
  savedBrands,
  activeBrandId,
  onSelectBrand,
  onRemoveBrand,
  onInsertChart,
  onInsertTable,
  selectedData,
  onUpdateData,
  onTimeline,
  onPreviewMotion,
  onExport,
  exportProgress,
  onCancelExport,
}: DesignStudioPanelProps) {
  const copy = designStudioCopy(locale)
  const [tab, setTab] = useState<DesignTab>('pages')
  const [query, setQuery] = useState('')
  const [assetCategory, setAssetCategory] = useState('')
  const [recentAssetIds, setRecentAssetIds] = useState<string[]>([])
  const [templateQuery, setTemplateQuery] = useState('')
  const [loadingAssetId, setLoadingAssetId] = useState<string>()
  const [customWidth, setCustomWidth] = useState(1080)
  const [customHeight, setCustomHeight] = useState(1080)
  const [resizeMode, setResizeMode] = useState<MagicResizeMode>('fit')
  const [anchor, setAnchor] = useState<ResizeAnchor>('center')
  const [backgroundStart, setBackgroundStart] = useState('#f8fafc')
  const [backgroundEnd, setBackgroundEnd] = useState('#ddd6fe')
  const [backgroundAngle, setBackgroundAngle] = useState(45)
  const [text, setText] = useState('Pixelweave')
  const [vertical, setVertical] = useState(false)
  const [textLayout, setTextLayout] = useState<TextLayoutMode>('auto')
  const [textListStyle, setTextListStyle] = useState<TextListStyle>('none')
  const [fontId, setFontId] = useState('system-sans')
  const [fontSize, setFontSize] = useState(64)
  const [effect, setEffect] = useState<TextEffectPreset>('none')
  const [fontLicenseAcknowledged, setFontLicenseAcknowledged] = useState(false)
  const [localFonts, setLocalFonts] = useState<LocalFontDataLike[]>([])
  const [localFontIndex, setLocalFontIndex] = useState(0)
  const [csv, setCsv] = useState(DEFAULT_CSV)
  const [chartType, setChartType] = useState<ChartType>('bar')
  const [dataCell, setDataCell] = useState({ row: 0, column: 0 })
  const [tableCellBackground, setTableCellBackground] = useState('#ffffff')
  const [tableBorderColor, setTableBorderColor] = useState('#d1d5db')
  const [tableBorderStyle, setTableBorderStyle] =
    useState<TableModel['border']['style']>('solid')
  const [tableRowHeight, setTableRowHeight] = useState(48)
  const [tableColumnWidth, setTableColumnWidth] = useState(160)
  const [dataError, setDataError] = useState<string>()
  const [brand, setBrand] = useState<DesignBrandInput>({
    name: 'Pixelweave Brand',
    primary: '#6757e8',
    secondary: '#0ea5e9',
    accent: '#f59e0b',
    headingFont: 'space-grotesk',
    bodyFont: 'inter',
  })
  const [durationMs, setDurationMs] = useState(3000)
  const [transition, setTransition] =
    useState<ProjectPageTransition['type']>('fade')
  const [animation, setAnimation] = useState<ProjectAnimationPreset>('fade')
  const [playing, setPlaying] = useState(false)
  const [exportFormat, setExportFormat] =
    useState<DesignExportRequest['format']>('pdf')
  const [exportScope, setExportScope] =
    useState<DesignExportRequest['scope']>('all')
  const [dpi, setDpi] = useState(300)
  const [bleedMm, setBleedMm] = useState(0)
  const [cropMarks, setCropMarks] = useState(false)
  const [selectedExportPageIds, setSelectedExportPageIds] = useState<string[]>(
    () => pages.map(({ id }) => id),
  )
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fontInputRef = useRef<HTMLInputElement>(null)
  const templateInputRef = useRef<HTMLInputElement>(null)
  const gridBoundaryDraftRef = useRef(new Map<string, number>())
  const [gridBoundaryDrafts, setGridBoundaryDrafts] = useState<
    Record<string, number>
  >({})
  const assetRegistry = useMemo(() => createBuiltinAssetRegistry(), [])
  const fontRegistry = useMemo(() => createBuiltinFontRegistry(), [])
  const templateRegistry = useMemo(() => createBuiltinTemplateRegistry(), [])

  const assets = useMemo(
    () =>
      assetRegistry.search(query, {
        ...(assetCategory ? { category: assetCategory } : {}),
        limit: 60,
      }),
    [assetCategory, assetRegistry, query],
  )
  const assetCategories = useMemo(
    () => [...new Set(assetRegistry.list().map(({ category }) => category))],
    [assetRegistry],
  )
  const recentAssets = useMemo(
    () =>
      recentAssetIds
        .map((id) => assetRegistry.getEntry(id))
        .filter((entry) => entry !== undefined),
    [assetRegistry, recentAssetIds],
  )
  const fonts = useMemo(() => fontRegistry.list(), [fontRegistry])
  const templates = useMemo(
    () => templateRegistry.search(templateQuery),
    [templateQuery, templateRegistry],
  )

  const activePage = pages.find(({ id }) => id === activePageId)
  const activeBrand = savedBrands.find(({ id }) => id === activeBrandId)
  const csvRows = useMemo(() => {
    try {
      return parseDelimitedText(csv).rows
    } catch {
      return []
    }
  }, [csv])
  useEffect(() => {
    setSelectedExportPageIds((current) => {
      const valid = current.filter((id) => pages.some((page) => page.id === id))
      return valid.length > 0 ? valid : pages.map(({ id }) => id)
    })
  }, [pages])
  const estimatedExportMegabytes = useMemo(() => {
    const selectedPages =
      exportScope === 'active' && activePage
        ? [activePage]
        : exportScope === 'selected'
          ? pages.filter(({ id }) => selectedExportPageIds.includes(id))
          : pages
    const pixels = selectedPages.reduce(
      (total, page) => total + page.width * page.height,
      0,
    )
    const bytesPerPixel =
      exportFormat === 'gif' ? 0.45 : exportFormat === 'video' ? 0.3 : 0.72
    return Math.max(0.1, (pixels * bytesPerPixel) / (1024 * 1024))
  }, [activePage, exportFormat, exportScope, pages, selectedExportPageIds])

  const updateGridBoundaryDraft = (id: string, value: number): void => {
    gridBoundaryDraftRef.current.set(id, value)
    setGridBoundaryDrafts((current) => ({ ...current, [id]: value }))
  }

  const commitGridBoundaryDraft = (id: string): void => {
    const value = gridBoundaryDraftRef.current.get(id)
    if (value === undefined) return
    gridBoundaryDraftRef.current.delete(id)
    setGridBoundaryDrafts((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    onMoveGridBoundary(id, value)
  }

  const resolveBrandFontFamily = async (
    brandFont: DesignBrandSummary['fonts']['heading'],
    sample: string,
  ): Promise<string> => {
    const sourceId = brandFont.sourceId
    const definition = sourceId ? fontRegistry.get(sourceId) : undefined
    if (
      !sourceId ||
      !definition ||
      definition.family.toLocaleLowerCase() !==
        brandFont.family.toLocaleLowerCase()
    ) {
      return brandFont.fallback
    }
    try {
      const result = await fontRegistry.ensureLoaded(sourceId, [
        { weight: 400, sample: sample || definition.sampleText || 'Aa' },
      ])
      return result.available
        ? fontRegistry.resolveStack(sourceId)
        : brandFont.fallback
    } catch {
      return brandFont.fallback
    }
  }

  const addText = async () => {
    const formattedText = formatDesignTextList(text, textListStyle)
    const brandFont =
      activeBrand && fontId === `brand:${activeBrand.id}:heading`
        ? activeBrand.fonts.heading
        : activeBrand && fontId === `brand:${activeBrand.id}:body`
          ? activeBrand.fonts.body
          : undefined
    if (brandFont) {
      onInsertText({
        text: formattedText,
        fontFamily: await resolveBrandFontFamily(brandFont, formattedText),
        fontSize,
        layoutMode: textLayout,
        vertical,
      })
      return
    }
    const userFont = userFonts.find(({ id }) => `user:${id}` === fontId)
    if (userFont) {
      onInsertText({
        text: formattedText,
        fontFamily: `${userFont.family}, ${userFont.fallback}`,
        fontSize,
        layoutMode: textLayout,
        vertical,
      })
      return
    }
    const result = await fontRegistry.ensureLoaded(fontId, [
      { weight: 400, sample: formattedText },
    ])
    const definition = fontRegistry.get(fontId)!
    const family = result.available
      ? fontRegistry.resolveStack(fontId)
      : definition.fallbackStack
    onInsertText({
      text: formattedText,
      fontFamily: family,
      fontSize,
      layoutMode: textLayout,
      vertical,
    })
  }

  useEffect(() => {
    if (!activeBrand) return
    setBrand((current) => ({
      ...current,
      name: activeBrand.name,
      ...activeBrand.colors,
      headingFont: activeBrand.fonts.heading.sourceId ?? current.headingFont,
      bodyFont: activeBrand.fonts.body.sourceId ?? current.bodyFont,
    }))
  }, [activeBrand])

  useEffect(() => {
    if (selectedData?.kind === 'chart') {
      setChartType(selectedData.model.type)
      setCsv(chartDataToDelimitedText(selectedData.model.data))
      return
    }
    if (selectedData?.kind === 'table') {
      setCsv(tableModelToDelimitedText(selectedData.model))
      setTableBorderColor(selectedData.model.border.color)
      setTableBorderStyle(selectedData.model.border.style)
      setDataCell((current) => ({
        row: Math.min(current.row, selectedData.model.rows.length - 1),
        column: Math.min(current.column, selectedData.model.columns.length - 1),
      }))
    }
    setDataError(undefined)
  }, [selectedData])

  useEffect(() => {
    setDurationMs(activePage?.timeline?.durationMs ?? 3_000)
    setTransition(activePage?.timeline?.transition?.type ?? 'none')
  }, [activePage])

  useEffect(() => {
    if (selectedData?.kind !== 'table') return
    const row = Math.min(dataCell.row, selectedData.model.rows.length - 1)
    const column = Math.min(
      dataCell.column,
      selectedData.model.columns.length - 1,
    )
    setTableCellBackground(
      selectedData.model.rows[row]?.cells[column]?.background ?? '#ffffff',
    )
    setTableRowHeight(selectedData.model.rows[row]?.height ?? 48)
    setTableColumnWidth(selectedData.model.columns[column]?.width ?? 160)
  }, [dataCell.column, dataCell.row, selectedData])

  const updateCsvCell = (row: number, column: number, value: string) => {
    const rows = csvRows.map((record) => [...record])
    rows[row][column] = value
    setCsv(serializeDelimitedRows(rows))
    setDataCell({ row, column })
  }

  const resizeCsvGrid = (dimension: 'row' | 'column', direction: -1 | 1) => {
    const rows = csvRows.map((record) => [...record])
    if (rows.length === 0) return
    if (dimension === 'row') {
      if (direction > 0) rows.push(Array(rows[0].length).fill(''))
      else if (rows.length > 1) rows.pop()
    } else if (direction > 0) {
      rows.forEach((record) => record.push(''))
    } else if (rows[0].length > 1) {
      rows.forEach((record) => record.pop())
    }
    setCsv(serializeDelimitedRows(rows))
  }

  const updateSelectedTable = () => {
    if (selectedData?.kind !== 'table') return
    try {
      let model = delimitedTextToTable(csv, { firstRowIsHeader: true }).table
      model = {
        ...model,
        border: {
          ...selectedData.model.border,
          color: tableBorderColor,
          style: tableBorderStyle,
        },
        rows: model.rows.map((row, rowIndex) => ({
          ...row,
          height: selectedData.model.rows[rowIndex]?.height ?? row.height,
          cells: row.cells.map((cell, columnIndex) => ({
            ...cell,
            ...(selectedData.model.rows[rowIndex]?.cells[columnIndex] ?? {}),
            text: cell.text,
          })),
        })),
        columns: model.columns.map((column, columnIndex) => ({
          ...column,
          width: selectedData.model.columns[columnIndex]?.width ?? column.width,
        })),
      }
      const row = Math.min(dataCell.row, model.rows.length - 1)
      const column = Math.min(dataCell.column, model.columns.length - 1)
      model = updateTableCell(model, row, column, {
        background: tableCellBackground,
      })
      model = resizeTableRow(model, row, tableRowHeight)
      model = resizeTableColumn(model, column, tableColumnWidth)
      void onUpdateData({
        kind: 'table',
        layerId: selectedData.layerId,
        model,
      })
      setDataError(undefined)
    } catch {
      setDataError(copy.data.invalid)
    }
  }

  const loadAsset = async (id: string) => {
    setLoadingAssetId(id)
    try {
      await onInsertAsset(await assetRegistry.loadAsset(id))
      setRecentAssetIds((current) =>
        [id, ...current.filter((candidate) => candidate !== id)].slice(0, 8),
      )
    } finally {
      setLoadingAssetId(undefined)
    }
  }

  const updateMotion = () => {
    const selected = new Set(selectedLayerIds)
    const elements: ProjectPageTimeline['elements'] = Object.fromEntries(
      Object.entries(activePage?.timeline?.elements ?? {}).map(
        ([layerId, clips]) => [layerId, clips.map((clip) => ({ ...clip }))],
      ),
    )
    const endTime = (
      source: ProjectPageTimeline['elements'],
      excludeSelected: boolean,
    ): number => {
      const schedule = resolveAnimationSchedule(
        Object.entries(source).flatMap(([elementId, clips]) =>
          excludeSelected && selected.has(elementId)
            ? []
            : clips.map((clip) => ({ ...clip, elementId })),
        ),
      )
      return schedule.reduce((latest, clip) => Math.max(latest, clip.endMs), 0)
    }
    const retainedEndMs = endTime(elements, true)
    const requestedDuration = Number.isFinite(durationMs)
      ? Math.min(60_000, Math.max(250, Math.round(durationMs)))
      : 3_000
    const minimumDuration = Math.max(requestedDuration, retainedEndMs)
    const usedAnimationIds = new Set(
      Object.entries(elements)
        .filter(([layerId]) => !selected.has(layerId))
        .flatMap(([, clips]) => clips.map(({ id }) => id)),
    )
    selectedLayerIds.forEach((id, index) => {
      const animationDurationMs = Math.min(600, minimumDuration)
      const baseId = `animation-${index + 1}`
      let animationId = baseId
      let suffix = 2
      while (usedAnimationIds.has(animationId)) {
        animationId = `${baseId}-${suffix}`
        suffix += 1
      }
      usedAnimationIds.add(animationId)
      elements[id] = [
        {
          id: animationId,
          phase: 'enter',
          effect: animation,
          start: {
            mode: 'with-page',
            delayMs: Math.min(
              index * 120,
              Math.max(0, minimumDuration - animationDurationMs),
            ),
          },
          durationMs: animationDurationMs,
          easing: 'ease-out',
          ...(animation.startsWith('slide-') ? { distancePx: 72 } : {}),
        },
      ]
    })
    const normalizedDuration = Math.max(
      minimumDuration,
      endTime(elements, false),
    )
    if (normalizedDuration !== durationMs) setDurationMs(normalizedDuration)
    onTimeline({
      durationMs: normalizedDuration,
      transition: {
        type: transition,
        durationMs:
          transition === 'none' ? 0 : Math.min(500, normalizedDuration),
        easing: 'ease-in-out',
      },
      elements,
    })
  }

  const importAsset = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void onImportUserAsset(file)
  }

  const importFont = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void onImportUserFont(file)
  }

  const discoverLocalFonts = async () => {
    const queryLocalFonts = (window as WindowWithLocalFonts).queryLocalFonts
    if (!queryLocalFonts) return
    const available = await queryLocalFonts.call(window)
    setLocalFonts(available)
    setLocalFontIndex(0)
  }

  const importDiscoveredFont = async () => {
    const localFont = localFonts[localFontIndex]
    if (!localFont) return
    const blob = await localFont.blob()
    const extension = detectUserFontFormat(
      await blob.slice(0, 4).arrayBuffer(),
      blob.type,
    )
    await onImportUserFont(
      new File([blob], `${localFont.postscriptName}.${extension}`, {
        type: blob.type || `font/${extension}`,
      }),
    )
  }

  const importTemplate = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void onImportTemplate(file)
  }

  const submitBrand = (event: FormEvent) => {
    event.preventDefault()
    void onSaveBrand(brand)
  }

  return (
    <section className="design-studio" aria-labelledby="design-studio-title">
      <header className="design-studio-header">
        <div>
          <span className="design-studio-kicker">
            <Sparkles aria-hidden="true" /> Pixelweave
          </span>
          <h2 id="design-studio-title">{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
        <span className="design-local-badge">{copy.status.localOnly}</span>
      </header>

      <div className="design-studio-layout">
        <nav className="design-studio-nav" aria-label={copy.title}>
          {TABS.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
            >
              <Icon aria-hidden="true" />
              <span>{copy.tabs[id]}</span>
            </button>
          ))}
        </nav>

        <div className="design-studio-content">
          {tab === 'pages' ? (
            <div className="design-panel-stack">
              <section>
                <div className="design-section-title">
                  <h3>{copy.pages.heading}</h3>
                  <div>
                    <button type="button" onClick={() => void onAddPage()}>
                      <Plus aria-hidden="true" /> {copy.pages.add}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDuplicatePage()}
                    >
                      {copy.pages.duplicate}
                    </button>
                    <button
                      type="button"
                      disabled={pages.length <= 1}
                      onClick={() => void onDeletePage()}
                    >
                      {copy.pages.remove}
                    </button>
                  </div>
                </div>
                <div className="design-page-strip" role="list">
                  {pages.map((page, index) => (
                    <article
                      key={page.id}
                      role="listitem"
                      className={page.id === activePageId ? 'active' : ''}
                    >
                      <button
                        type="button"
                        onClick={() => void onSelectPage(page.id)}
                      >
                        <span
                          className="design-page-thumb"
                          style={{
                            aspectRatio: `${page.width}/${page.height}`,
                          }}
                        >
                          {page.thumbnail ? (
                            <img src={page.thumbnail} alt="" />
                          ) : (
                            <span>{index + 1}</span>
                          )}
                        </span>
                        <strong>{page.name}</strong>
                        <small>
                          {page.width} × {page.height}
                        </small>
                      </button>
                      <div>
                        <button
                          type="button"
                          disabled={index === 0}
                          aria-label={copy.pages.previous}
                          onClick={() => onReorderPage(page.id, -1)}
                        >
                          ←
                        </button>
                        <button
                          type="button"
                          disabled={index === pages.length - 1}
                          aria-label={copy.pages.next}
                          onClick={() => onReorderPage(page.id, 1)}
                        >
                          →
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section>
                <h3>{copy.pages.presets}</h3>
                <div className="design-preset-grid">
                  {DESIGN_SIZE_PRESETS.map((preset) => {
                    const size = presetPixelDimensions(preset)
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() =>
                          void onAddPage({
                            ...size,
                            ...(preset.unit === 'mm'
                              ? {
                                  physicalSize: {
                                    unit: 'mm' as const,
                                    widthMm: preset.width,
                                    heightMm: preset.height,
                                    sourceDpi: preset.dpi ?? 300,
                                  },
                                }
                              : {}),
                          })
                        }
                      >
                        <span>{preset.name[locale]}</span>
                        <small>
                          {preset.width} × {preset.height} {preset.unit}
                        </small>
                      </button>
                    )
                  })}
                </div>
              </section>

              <section className="design-control-card">
                <h3>{copy.pages.resize}</h3>
                <div className="design-inline-fields">
                  <label>
                    {copy.pages.width}
                    <input
                      type="number"
                      min="1"
                      max="8192"
                      value={customWidth}
                      onChange={(event) =>
                        setCustomWidth(Number(event.target.value))
                      }
                    />
                  </label>
                  <label>
                    {copy.pages.height}
                    <input
                      type="number"
                      min="1"
                      max="8192"
                      value={customHeight}
                      onChange={(event) =>
                        setCustomHeight(Number(event.target.value))
                      }
                    />
                  </label>
                  <label>
                    {copy.pages.anchor}
                    <select
                      value={anchor}
                      onChange={(event) =>
                        setAnchor(event.target.value as ResizeAnchor)
                      }
                    >
                      {[
                        'top-left',
                        'top',
                        'top-right',
                        'left',
                        'center',
                        'right',
                        'bottom-left',
                        'bottom',
                        'bottom-right',
                      ].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {copy.pages.mode}
                    <select
                      value={resizeMode}
                      onChange={(event) =>
                        setResizeMode(event.target.value as MagicResizeMode)
                      }
                    >
                      <option value="fit">{copy.pages.fit}</option>
                      <option value="fill">{copy.pages.fill}</option>
                      <option value="stretch">{copy.pages.stretch}</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      onMagicResize(
                        customWidth,
                        customHeight,
                        anchor,
                        resizeMode,
                      )
                    }
                  >
                    {copy.apply}
                  </button>
                </div>
              </section>

              <section className="design-control-card">
                <h3>{copy.pages.background}</h3>
                <div className="design-color-row">
                  <input
                    type="color"
                    value={backgroundStart}
                    aria-label={copy.pages.solid}
                    onChange={(event) => setBackgroundStart(event.target.value)}
                  />
                  <input
                    type="color"
                    value={backgroundEnd}
                    aria-label={copy.pages.gradient}
                    onChange={(event) => setBackgroundEnd(event.target.value)}
                  />
                  <input
                    type="range"
                    aria-label={copy.pages.gradientAngle}
                    min="0"
                    max="360"
                    value={backgroundAngle}
                    onChange={(event) =>
                      setBackgroundAngle(Number(event.target.value))
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onBackground({ kind: 'color', color: backgroundStart })
                    }
                  >
                    {copy.pages.solid}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onBackground({
                        kind: 'gradient',
                        start: backgroundStart,
                        end: backgroundEnd,
                        angle: backgroundAngle,
                      })
                    }
                  >
                    {copy.pages.gradient}
                  </button>
                </div>
                {activeBrand ? (
                  <div
                    className="design-brand-colors"
                    aria-label={activeBrand.name}
                  >
                    {Object.entries(activeBrand.colors).map(([role, color]) => (
                      <button
                        key={role}
                        type="button"
                        className="design-brand-swatch"
                        aria-label={`${activeBrand.name}: ${role}`}
                        title={`${role}: ${color}`}
                        style={{ background: color }}
                        onClick={() => {
                          setBackgroundStart(color)
                          onBackground({ kind: 'color', color })
                        }}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            </div>
          ) : null}

          {tab === 'elements' ? (
            <div className="design-panel-stack">
              <section>
                <div className="design-section-title">
                  <h3>{copy.elements.heading}</h3>
                  <label className="design-search">
                    <Search aria-hidden="true" />
                    <span className="sr-only">{copy.search}</span>
                    <input
                      type="search"
                      value={query}
                      placeholder={copy.search}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                </div>
                <label>
                  {copy.elements.category}
                  <select
                    value={assetCategory}
                    onChange={(event) => setAssetCategory(event.target.value)}
                  >
                    <option value="">{copy.elements.allCategories}</option>
                    {assetCategories.map((category) => (
                      <option key={category}>{category}</option>
                    ))}
                  </select>
                </label>
                {recentAssets.length > 0 ? (
                  <section aria-label={copy.elements.recent}>
                    <h4>{copy.elements.recent}</h4>
                    <div className="design-action-grid">
                      {recentAssets.map((asset) => (
                        <button
                          key={asset.id}
                          type="button"
                          draggable
                          onClick={() => void loadAsset(asset.id)}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'copy'
                            writeBuiltinAssetDragPayload(
                              event.dataTransfer,
                              asset.id,
                            )
                          }}
                        >
                          {asset.name[locale]}
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}
                <div className="design-asset-grid">
                  {assets.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      draggable
                      disabled={loadingAssetId === asset.id}
                      onClick={() => void loadAsset(asset.id)}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'copy'
                        writeBuiltinAssetDragPayload(
                          event.dataTransfer,
                          asset.id,
                        )
                      }}
                    >
                      <span
                        className={`asset-preview ${asset.kind}`}
                        aria-hidden="true"
                      >
                        {asset.kind === 'icon'
                          ? '◇'
                          : asset.kind === 'grid'
                            ? '▦'
                            : '◆'}
                      </span>
                      <strong>{asset.name[locale]}</strong>
                      <small>{asset.category}</small>
                    </button>
                  ))}
                </div>
                {assets.length === 0 ? <p>{copy.status.empty}</p> : null}
              </section>
              <section className="design-control-card">
                <p>{copy.elements.hint}</p>
                {gridBoundaries.length > 0 ? (
                  <fieldset className="design-grid-boundaries">
                    <legend>{copy.elements.gridBoundary}</legend>
                    <p>{copy.elements.gridHint}</p>
                    {gridBoundaries.map((boundary, index) => {
                      const value =
                        gridBoundaryDrafts[boundary.id] ?? boundary.position
                      return (
                        <label key={boundary.id}>
                          <span>
                            {boundary.axis === 'x'
                              ? copy.elements.gridHorizontal
                              : copy.elements.gridVertical}{' '}
                            {index + 1}: {Math.round(value * 100)}%
                          </span>
                          <input
                            type="range"
                            min={boundary.minimum}
                            max={boundary.maximum}
                            step={0.001}
                            value={value}
                            aria-label={`${copy.elements.gridBoundary} ${index + 1}`}
                            onChange={(event) =>
                              updateGridBoundaryDraft(
                                boundary.id,
                                event.currentTarget.valueAsNumber,
                              )
                            }
                            onPointerUp={() =>
                              commitGridBoundaryDraft(boundary.id)
                            }
                            onKeyUp={() => commitGridBoundaryDraft(boundary.id)}
                            onBlur={() => commitGridBoundaryDraft(boundary.id)}
                          />
                        </label>
                      )
                    })}
                  </fieldset>
                ) : null}
                <div className="design-action-grid">
                  <button type="button" onClick={onGroup}>
                    {copy.elements.group}
                  </button>
                  <button type="button" onClick={onUngroup}>
                    {copy.elements.ungroup}
                  </button>
                  <button type="button" onClick={onClip}>
                    {copy.elements.clip}
                  </button>
                  <button type="button" onClick={onReleaseClip}>
                    {copy.elements.releaseClip}
                  </button>
                  <button type="button" onClick={onApplyMask}>
                    {copy.elements.mask}
                  </button>
                  <button
                    type="button"
                    disabled={selectedLayerIds.length !== 1}
                    onClick={() => onSetMaskEnabled(false)}
                  >
                    {copy.elements.disableMask}
                  </button>
                  <button
                    type="button"
                    disabled={selectedLayerIds.length !== 1}
                    onClick={() => onSetMaskEnabled(true)}
                  >
                    {copy.elements.enableMask}
                  </button>
                  <button type="button" onClick={onRemoveMask}>
                    {copy.elements.removeMask}
                  </button>
                  <button
                    type="button"
                    disabled={selectedLayerIds.length !== 1}
                    onClick={() => void onRasterizeMask()}
                  >
                    {copy.elements.rasterizeMask}
                  </button>
                </div>
              </section>
              <section className="design-control-card">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  hidden
                  onChange={importAsset}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Plus aria-hidden="true" /> {copy.elements.importAsset}
                </button>
                <h4>{copy.elements.myAssets}</h4>
                {userAssets.length > 0 ? (
                  <div className="design-user-library" role="list">
                    {userAssets.map((asset) => (
                      <article key={asset.id} role="listitem">
                        <button
                          type="button"
                          onClick={() => void onUseUserAsset(asset.id)}
                        >
                          <strong>{asset.name}</strong>
                          <small>
                            {asset.width} × {asset.height}
                          </small>
                        </button>
                        <button
                          type="button"
                          aria-label={`${copy.elements.removeStored}: ${asset.name}`}
                          onClick={() => void onRemoveUserAsset(asset.id)}
                        >
                          ×
                        </button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p>{copy.elements.userAssetsEmpty}</p>
                )}
              </section>
            </div>
          ) : null}

          {tab === 'text' ? (
            <div className="design-panel-stack">
              <section className="design-control-card">
                <h3>{copy.text.heading}</h3>
                <label>
                  {copy.text.content}
                  <textarea
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                  />
                </label>
                <div className="design-inline-fields">
                  <label>
                    {copy.text.font}
                    <select
                      value={fontId}
                      onChange={(event) => setFontId(event.target.value)}
                    >
                      {activeBrand ? (
                        <optgroup label={activeBrand.name}>
                          <option value={`brand:${activeBrand.id}:heading`}>
                            {copy.templates.headingFont}:{' '}
                            {activeBrand.fonts.heading.family}
                          </option>
                          <option value={`brand:${activeBrand.id}:body`}>
                            {copy.templates.bodyFont}:{' '}
                            {activeBrand.fonts.body.family}
                          </option>
                        </optgroup>
                      ) : null}
                      {fonts.map((font) => (
                        <option key={font.id} value={font.id}>
                          {locale === 'ja'
                            ? (font.localizedName ?? font.displayName)
                            : font.displayName}
                        </option>
                      ))}
                      {userFonts.map((font) => (
                        <option key={font.id} value={`user:${font.id}`}>
                          {font.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    px
                    <input
                      type="number"
                      min="6"
                      max="512"
                      value={fontSize}
                      onChange={(event) =>
                        setFontSize(Number(event.target.value))
                      }
                    />
                  </label>
                  <label>
                    {copy.text.layout}
                    <select
                      value={textLayout}
                      onChange={(event) =>
                        setTextLayout(event.target.value as TextLayoutMode)
                      }
                    >
                      <option value="auto">{copy.text.auto}</option>
                      <option value="wrap">{copy.text.wrap}</option>
                      <option value="fixed">{copy.text.fixed}</option>
                    </select>
                  </label>
                  <label>
                    {copy.text.listStyle}
                    <select
                      value={textListStyle}
                      onChange={(event) =>
                        setTextListStyle(event.target.value as TextListStyle)
                      }
                    >
                      <option value="none">{copy.text.listNone}</option>
                      <option value="bullet">{copy.text.listBullet}</option>
                      <option value="number">{copy.text.listNumber}</option>
                    </select>
                  </label>
                  <label className="design-check">
                    <input
                      type="checkbox"
                      checked={vertical}
                      onChange={(event) => setVertical(event.target.checked)}
                    />
                    {vertical ? copy.text.vertical : copy.text.horizontal}
                  </label>
                </div>
                <button type="button" onClick={() => void addText()}>
                  <Type aria-hidden="true" /> {copy.add}
                </button>
              </section>
              <section className="design-control-card">
                <h3>{copy.text.effect}</h3>
                <div className="design-effect-grid">
                  {(
                    ['none', 'neon', 'splice', 'background', 'echo'] as const
                  ).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      aria-pressed={effect === preset}
                      onClick={() => {
                        setEffect(preset)
                        onTextEffect(preset)
                      }}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const brandFont =
                      activeBrand &&
                      fontId === `brand:${activeBrand.id}:heading`
                        ? activeBrand.fonts.heading
                        : activeBrand &&
                            fontId === `brand:${activeBrand.id}:body`
                          ? activeBrand.fonts.body
                          : undefined
                    if (brandFont) {
                      onSetFont(await resolveBrandFontFamily(brandFont, text))
                      return
                    }
                    const userFont = userFonts.find(
                      ({ id }) => `user:${id}` === fontId,
                    )
                    if (userFont) {
                      onSetFont(`${userFont.family}, ${userFont.fallback}`)
                      return
                    }
                    const result = await fontRegistry.ensureLoaded(fontId)
                    const definition = fontRegistry.get(fontId)!
                    onSetFont(
                      result.available
                        ? fontRegistry.resolveStack(fontId)
                        : definition.fallbackStack,
                    )
                  }}
                >
                  {copy.apply} {copy.text.font}
                </button>
                <input
                  ref={fontInputRef}
                  type="file"
                  accept=".woff2,.ttf,.otf,font/woff2,font/ttf,font/otf"
                  hidden
                  onChange={importFont}
                />
                <button
                  type="button"
                  disabled={!fontLicenseAcknowledged}
                  onClick={() => fontInputRef.current?.click()}
                >
                  <Plus aria-hidden="true" /> {copy.text.importFont}
                </button>
                <label className="design-check">
                  <input
                    type="checkbox"
                    checked={fontLicenseAcknowledged}
                    onChange={(event) =>
                      setFontLicenseAcknowledged(event.target.checked)
                    }
                  />
                  {copy.text.fontLicense}
                </label>
                {'queryLocalFonts' in window ? (
                  <div className="design-inline-fields">
                    <button
                      type="button"
                      disabled={!fontLicenseAcknowledged}
                      onClick={() => void discoverLocalFonts()}
                    >
                      {copy.text.discoverLocalFonts}
                    </button>
                    {localFonts.length > 0 ? (
                      <>
                        <label>
                          {copy.text.localFonts}
                          <select
                            value={localFontIndex}
                            onChange={(event) =>
                              setLocalFontIndex(Number(event.target.value))
                            }
                          >
                            {localFonts.map((font, index) => (
                              <option
                                key={`${font.postscriptName}-${index}`}
                                value={index}
                              >
                                {font.fullName || font.family}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          disabled={!fontLicenseAcknowledged}
                          onClick={() => void importDiscoveredFont()}
                        >
                          {copy.text.importLocalFont}
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
                {userFonts.length > 0 ? (
                  <div className="design-user-library" role="list">
                    {userFonts.map((font) => (
                      <article key={font.id} role="listitem">
                        <button
                          type="button"
                          onClick={() => {
                            setFontId(`user:${font.id}`)
                            onSetFont(`${font.family}, ${font.fallback}`)
                          }}
                        >
                          <strong>{font.displayName}</strong>
                          <small>{font.fileName}</small>
                        </button>
                        <button
                          type="button"
                          aria-label={`${copy.text.removeFont}: ${font.displayName}`}
                          onClick={() => void onRemoveUserFont(font.id)}
                        >
                          ×
                        </button>
                      </article>
                    ))}
                  </div>
                ) : null}
              </section>
            </div>
          ) : null}

          {tab === 'templates' ? (
            <div className="design-panel-stack">
              <section>
                <div className="design-section-title">
                  <h3>{copy.templates.heading}</h3>
                  <label className="design-search">
                    <Search aria-hidden="true" />
                    <span className="sr-only">{copy.search}</span>
                    <input
                      type="search"
                      value={templateQuery}
                      placeholder={copy.search}
                      onChange={(event) => setTemplateQuery(event.target.value)}
                    />
                  </label>
                </div>
                <div className="design-template-grid">
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => void onApplyTemplate(template.id)}
                    >
                      <span
                        style={{
                          background:
                            TEMPLATE_CATEGORY_COLORS[template.category] ??
                            '#6757e8',
                        }}
                      >
                        <i />
                        <b />
                      </span>
                      <strong>
                        {locale === 'ja'
                          ? (template.localizedName ?? template.name)
                          : template.name}
                      </strong>
                      <small>
                        {template.width} × {template.height} ·{' '}
                        {template.pageCount}
                      </small>
                    </button>
                  ))}
                </div>
                {templates.length === 0 ? <p>{copy.status.empty}</p> : null}
              </section>
              <form className="design-control-card" onSubmit={submitBrand}>
                <h3>{copy.templates.brand}</h3>
                {savedBrands.length > 0 ? (
                  <div className="design-inline-fields">
                    <label>
                      {copy.templates.savedBrands}
                      <select
                        value={activeBrandId ?? ''}
                        onChange={(event) => onSelectBrand(event.target.value)}
                      >
                        <option value="">{copy.templates.noBrand}</option>
                        {savedBrands.map((kit) => (
                          <option key={kit.id} value={kit.id}>
                            {kit.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {activeBrandId ? (
                      <button
                        type="button"
                        onClick={() => void onRemoveBrand(activeBrandId)}
                      >
                        {copy.templates.removeBrand}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <label>
                  {copy.templates.name}
                  <input
                    value={brand.name}
                    onChange={(event) =>
                      setBrand((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>
                <div className="design-brand-colors">
                  {(['primary', 'secondary', 'accent'] as const).map((role) => (
                    <label key={role}>
                      {copy.templates[role]}
                      <input
                        type="color"
                        value={brand[role]}
                        onChange={(event) =>
                          setBrand((current) => ({
                            ...current,
                            [role]: event.target.value,
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
                <div className="design-inline-fields">
                  <label>
                    {copy.templates.headingFont}
                    <select
                      value={brand.headingFont}
                      onChange={(event) =>
                        setBrand((current) => ({
                          ...current,
                          headingFont: event.target.value,
                        }))
                      }
                    >
                      {fonts.map((font) => (
                        <option key={font.id} value={font.id}>
                          {font.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {copy.templates.bodyFont}
                    <select
                      value={brand.bodyFont}
                      onChange={(event) =>
                        setBrand((current) => ({
                          ...current,
                          bodyFont: event.target.value,
                        }))
                      }
                    >
                      {fonts.map((font) => (
                        <option key={font.id} value={font.id}>
                          {font.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <button type="submit">{copy.templates.saveBrand}</button>
              </form>
              <section className="design-control-card">
                <h3>{copy.templates.userTemplate}</h3>
                <input
                  ref={templateInputRef}
                  type="file"
                  accept=".pwxtemplate.json,application/json"
                  hidden
                  onChange={importTemplate}
                />
                <div className="design-action-grid">
                  <button
                    type="button"
                    onClick={() => templateInputRef.current?.click()}
                  >
                    {copy.templates.importTemplate}
                  </button>
                  <button type="button" onClick={() => void onExportTemplate()}>
                    {copy.templates.exportTemplate}
                  </button>
                </div>
              </section>
            </div>
          ) : null}

          {tab === 'data' ? (
            <div className="design-panel-stack">
              <section className="design-control-card">
                <h3>{copy.data.heading}</h3>
                <label>
                  {copy.data.csv}
                  <textarea
                    value={csv}
                    onChange={(event) => setCsv(event.target.value)}
                  />
                </label>
                {csvRows.length > 0 ? (
                  <div className="design-data-editor">
                    <div className="design-action-grid">
                      <button
                        type="button"
                        onClick={() => resizeCsvGrid('row', 1)}
                      >
                        {copy.data.addRow}
                      </button>
                      <button
                        type="button"
                        onClick={() => resizeCsvGrid('row', -1)}
                      >
                        {copy.data.removeRow}
                      </button>
                      <button
                        type="button"
                        onClick={() => resizeCsvGrid('column', 1)}
                      >
                        {copy.data.addColumn}
                      </button>
                      <button
                        type="button"
                        onClick={() => resizeCsvGrid('column', -1)}
                      >
                        {copy.data.removeColumn}
                      </button>
                    </div>
                    <div className="design-data-grid-scroll">
                      <table className="design-data-grid">
                        <tbody>
                          {csvRows.slice(0, 50).map((row, rowIndex) => (
                            <tr key={rowIndex}>
                              {row.slice(0, 20).map((cell, columnIndex) => (
                                <td key={columnIndex}>
                                  <input
                                    aria-label={`${copy.data.csv} ${rowIndex + 1}:${columnIndex + 1}`}
                                    value={cell}
                                    onFocus={() =>
                                      setDataCell({
                                        row: rowIndex,
                                        column: columnIndex,
                                      })
                                    }
                                    onChange={(event) =>
                                      updateCsvCell(
                                        rowIndex,
                                        columnIndex,
                                        event.target.value,
                                      )
                                    }
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
                <div className="design-inline-fields">
                  <label>
                    {copy.data.chart}
                    <select
                      value={chartType}
                      onChange={(event) =>
                        setChartType(event.target.value as ChartType)
                      }
                    >
                      {(
                        [
                          'bar',
                          'horizontal-bar',
                          'line',
                          'pie',
                          'doughnut',
                        ] as const
                      ).map((type) => (
                        <option key={type}>{type}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      void onInsertChart({
                        type: chartType,
                        csv,
                        palette: activeBrand
                          ? Object.values(activeBrand.colors)
                          : [brand.primary, brand.secondary, brand.accent],
                      })
                    }
                  >
                    {copy.data.insertChart}
                  </button>
                  <button type="button" onClick={() => void onInsertTable(csv)}>
                    {copy.data.insertTable}
                  </button>
                  {selectedData?.kind === 'chart' ? (
                    <button
                      type="button"
                      onClick={() =>
                        void onUpdateData({
                          kind: 'chart',
                          layerId: selectedData.layerId,
                          type: chartType,
                          csv,
                          palette: activeBrand
                            ? Object.values(activeBrand.colors)
                            : selectedData.palette,
                        })
                      }
                    >
                      {copy.data.updateChart}
                    </button>
                  ) : null}
                </div>
                {selectedData?.kind === 'table' ? (
                  <div className="design-inline-fields">
                    <label>
                      {copy.data.cellBackground}
                      <input
                        type="color"
                        value={tableCellBackground}
                        onChange={(event) =>
                          setTableCellBackground(event.target.value)
                        }
                      />
                    </label>
                    <label>
                      {copy.data.borderColor}
                      <input
                        type="color"
                        value={tableBorderColor}
                        onChange={(event) =>
                          setTableBorderColor(event.target.value)
                        }
                      />
                    </label>
                    <label>
                      {copy.data.borderStyle}
                      <select
                        value={tableBorderStyle}
                        onChange={(event) =>
                          setTableBorderStyle(
                            event.target.value as TableModel['border']['style'],
                          )
                        }
                      >
                        {(['solid', 'dashed', 'dotted', 'none'] as const).map(
                          (style) => (
                            <option key={style}>{style}</option>
                          ),
                        )}
                      </select>
                    </label>
                    <label>
                      {copy.data.rowHeight}
                      <input
                        type="number"
                        min="12"
                        max="4096"
                        value={tableRowHeight}
                        onChange={(event) =>
                          setTableRowHeight(Number(event.target.value))
                        }
                      />
                    </label>
                    <label>
                      {copy.data.columnWidth}
                      <input
                        type="number"
                        min="16"
                        max="4096"
                        value={tableColumnWidth}
                        onChange={(event) =>
                          setTableColumnWidth(Number(event.target.value))
                        }
                      />
                    </label>
                    <button type="button" onClick={updateSelectedTable}>
                      {copy.data.updateTable}
                    </button>
                  </div>
                ) : null}
                {dataError ? <p role="alert">{dataError}</p> : null}
              </section>
            </div>
          ) : null}

          {tab === 'motion' ? (
            <div className="design-panel-stack">
              <section className="design-control-card">
                <h3>{copy.motion.heading}</h3>
                <div className="design-inline-fields">
                  <label>
                    {copy.motion.duration}
                    <input
                      type="number"
                      min="250"
                      max="60000"
                      step="250"
                      value={durationMs}
                      onChange={(event) =>
                        setDurationMs(Number(event.target.value))
                      }
                    />
                  </label>
                  <label>
                    {copy.motion.transition}
                    <select
                      value={transition}
                      onChange={(event) =>
                        setTransition(
                          event.target.value as ProjectPageTransition['type'],
                        )
                      }
                    >
                      <option value="none">none</option>
                      <option value="fade">fade</option>
                      <option value="slide-left">slide-left</option>
                      <option value="slide-right">slide-right</option>
                    </select>
                  </label>
                  <label>
                    {copy.motion.preset}
                    <select
                      value={animation}
                      onChange={(event) =>
                        setAnimation(
                          event.target.value as ProjectAnimationPreset,
                        )
                      }
                    >
                      {(
                        [
                          'fade',
                          'slide-left',
                          'slide-right',
                          'slide-up',
                          'slide-down',
                          'zoom',
                          'wipe-left',
                          'wipe-right',
                          'pulse',
                        ] as const
                      ).map((preset) => (
                        <option key={preset}>{preset}</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" onClick={updateMotion}>
                    {copy.apply}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !playing
                    setPlaying(next)
                    onPreviewMotion(next)
                  }}
                >
                  {playing ? copy.motion.stop : copy.motion.preview}
                </button>
                <p>
                  {activePage?.durationMs ?? durationMs} ms ·{' '}
                  {selectedLayerIds.length}
                </p>
              </section>
            </div>
          ) : null}

          {tab === 'export' ? (
            <div className="design-panel-stack">
              <section className="design-control-card">
                <h3>{copy.export.heading}</h3>
                <div className="design-export-formats">
                  {(['pdf', 'gif', 'video', 'png-zip'] as const).map(
                    (format) => (
                      <button
                        key={format}
                        type="button"
                        aria-pressed={exportFormat === format}
                        onClick={() => setExportFormat(format)}
                      >
                        {format === 'pdf'
                          ? copy.export.pdf
                          : format === 'gif'
                            ? copy.export.gif
                            : format === 'video'
                              ? copy.export.video
                              : copy.export.png}
                      </button>
                    ),
                  )}
                </div>
                <div className="design-inline-fields">
                  <label>
                    {copy.export.range}
                    <select
                      value={exportScope}
                      onChange={(event) =>
                        setExportScope(
                          event.target.value as DesignExportRequest['scope'],
                        )
                      }
                    >
                      <option value="active">{copy.export.active}</option>
                      <option value="all">{copy.export.all}</option>
                      <option value="selected">{copy.export.selected}</option>
                    </select>
                  </label>
                  <label>
                    {copy.export.dpi}
                    <input
                      type="number"
                      min="72"
                      max="600"
                      value={dpi}
                      onChange={(event) => setDpi(Number(event.target.value))}
                    />
                  </label>
                  <label>
                    {copy.export.bleed} mm
                    <input
                      type="number"
                      min="0"
                      max="20"
                      step="0.5"
                      value={bleedMm}
                      onChange={(event) =>
                        setBleedMm(Number(event.target.value))
                      }
                    />
                  </label>
                  <label className="design-check">
                    <input
                      type="checkbox"
                      checked={cropMarks}
                      disabled={bleedMm <= 0}
                      onChange={(event) => setCropMarks(event.target.checked)}
                    />
                    {copy.export.cropMarks}
                  </label>
                </div>
                {exportScope === 'selected' ? (
                  <fieldset className="design-page-selection">
                    <legend>{copy.export.selectedPages}</legend>
                    {pages.map((page, index) => (
                      <label key={page.id} className="design-check">
                        <input
                          type="checkbox"
                          checked={selectedExportPageIds.includes(page.id)}
                          onChange={(event) =>
                            setSelectedExportPageIds((current) =>
                              event.target.checked
                                ? [...new Set([...current, page.id])]
                                : current.filter((id) => id !== page.id),
                            )
                          }
                        />
                        {index + 1}. {page.name}
                      </label>
                    ))}
                  </fieldset>
                ) : null}
                <button
                  type="button"
                  disabled={
                    Boolean(exportProgress) ||
                    (exportScope === 'selected' &&
                      selectedExportPageIds.length === 0)
                  }
                  onClick={() =>
                    void onExport({
                      format: exportFormat,
                      scope: exportScope,
                      selectedPageIds: selectedExportPageIds,
                      dpi,
                      bleedMm,
                      cropMarks,
                    })
                  }
                >
                  <Download aria-hidden="true" /> {copy.export.export}
                </button>
                <p>
                  {copy.export.estimatedSize}:{' '}
                  {estimatedExportMegabytes.toFixed(1)} MB
                </p>
                {exportProgress ? (
                  <div className="design-export-progress" role="status">
                    <div>
                      <span>{copy.export.progress}</span>
                      <strong>{exportProgress.label}</strong>
                    </div>
                    <progress max="1" value={exportProgress.value} />
                    <button type="button" onClick={onCancelExport}>
                      {copy.export.cancel}
                    </button>
                  </div>
                ) : null}
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
