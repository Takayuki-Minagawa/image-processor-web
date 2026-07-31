import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  ArrowDown,
  ArrowUp,
  Brush,
  Copy,
  Download,
  Eraser,
  Eye,
  EyeOff,
  Hand,
  History as HistoryIcon,
  Layers3,
  Maximize2,
  MousePointer2,
  Plus,
  Redo2,
  Save,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  DEFAULT_IMAGE_FILTER_SETTINGS,
  FabricEditorEngine,
  type EditorChangeReason,
  type EditorSnapshot,
  type EditorStatus,
  type EditorTool,
  type ExportImageFormat,
  type ImageFilterSettings,
  type LayerInfo,
  type SelectionTransform,
} from './editor/fabricEngine'
import { AsyncOperationGate } from './editor/asyncOperationGate'
import type { AutosaveRepository } from './editor/autosave'
import { History } from './editor/history'
import type {
  AutomationFilter,
  AutomationCommand,
  CommandDispatcher,
  LocalMacroRepository,
  MacroRecorder,
  MacroRepositoryEntry,
} from './automation'
import type {
  BatchController,
  BatchFailure,
  BatchOutputDestination,
  BatchProgress,
  FileSystemDirectoryHandleLike,
  IconExportPreset,
  ImagePipelineClient,
  LocalIconPresetRepository,
  StoredZipEntry,
} from './batch'
import { assertRestorableEditorSnapshot } from './editor/snapshotValidation'
import type { JsonObject, ProjectDocument } from './editor/types'
import {
  FileValidationError,
  MAX_PROJECT_BYTES,
  sanitizeFileStem,
} from './lib/fileCore'
import { MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS } from './lib/imageSafety'
import type {
  BatchTransformRequest,
  IconExportRequest,
  MacroExportRequest,
  MacroImportRequest,
  MacroReplayRequest,
} from './components/AutomationBatchPanel'
import type { SelectionMask } from './selection/mask'
import type { SelectionFilterClient } from './editor/filters/selectionFilterClient'
import type { SelectionFilterProgress } from './editor/filters/selectionFilter'
import type { FilterOperation } from './editor/filters/types'
import type { EditorScriptCommand } from './scripting/types'

const LogoGeneratorPanel = lazy(async () => ({
  default: (await import('./components/LogoGeneratorPanel')).LogoGeneratorPanel,
}))
const AutomationBatchPanel = lazy(
  () => import('./components/AutomationBatchPanel'),
)
const AdvancedStudioPanel = lazy(async () => ({
  default: (await import('./components/AdvancedStudioPanel'))
    .AdvancedStudioPanel,
}))

type InspectorTab = 'layers' | 'adjustments' | 'history'
type DialogName = 'menu' | 'new' | 'export' | 'studio' | 'shortcuts' | null
type StudioTab = 'logo' | 'automation' | 'advanced'

interface HistoryLabel {
  id: number
  label: string
  time: string
}

interface SaveFileHandleLike {
  createWritable(): Promise<{
    write(data: Blob): Promise<void>
    close(): Promise<void>
  }>
}

type WindowWithSavePicker = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string
    types: Array<{
      description: string
      accept: Record<string, string[]>
    }>
  }) => Promise<SaveFileHandleLike>
}

type WindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike>
}

const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 720
const AUTOSAVE_DELAY = 1200
const HISTORY_DELAY = 280
const SERVICE_WORKER_UPDATE_TIMEOUT = 10_000
const APP_VERSION = '0.1.0'
const DEBOUNCED_CHANGE_REASONS = new Set<EditorChangeReason>([
  'object-modified',
  'text-changed',
  'layer-opacity',
  'filter',
])

const DEFAULT_FILTERS = DEFAULT_IMAGE_FILTER_SETTINGS

function Glyph({ children }: { children: ReactNode }) {
  return (
    <span className="ui-glyph" aria-hidden="true">
      {children}
    </span>
  )
}

const CHANGE_LABELS: Record<EditorChangeReason, string> = {
  'object-added': 'レイヤーを追加',
  'object-removed': 'レイヤーを削除',
  'object-modified': 'オブジェクトを変形',
  'text-changed': 'テキストを編集',
  layer: 'レイヤー設定を変更',
  'layer-opacity': 'レイヤー透明度を変更',
  'canvas-size': 'キャンバスサイズを変更',
  clear: '新規ドキュメント',
  crop: 'キャンバスを切り抜き',
  filter: '画像を調整',
  duplicate: 'レイヤーを複製',
  cut: '選択範囲を切り取り',
  paste: '選択範囲を貼り付け',
  guide: 'ガイドを変更',
  'selection-mask': '選択範囲を変更',
  'pixel-delete': '選択範囲のピクセルを削除',
  alignment: 'オブジェクトを整列',
  'text-style': 'テキスト装飾を変更',
  'svg-import': 'SVGを追加',
  'adjustment-layer': '調整レイヤーを変更',
  logo: 'ロゴを追加',
  macro: 'マクロを実行',
  script: 'スクリプトを実行',
  'background-removal': '背景を除去',
}

const TOOL_ITEMS: Array<{
  id: EditorTool
  label: string
  shortcut: string
  icon: typeof MousePointer2
}> = [
  { id: 'select', label: '選択・変形', shortcut: 'V', icon: MousePointer2 },
  { id: 'brush', label: 'ブラシ', shortcut: 'B', icon: Brush },
  { id: 'eraser', label: '消しゴム', shortcut: 'E', icon: Eraser },
  { id: 'pan', label: '手のひら', shortcut: 'H', icon: Hand },
]

const BLEND_MODES: Array<{
  value: GlobalCompositeOperation
  label: string
}> = [
  { value: 'source-over', label: '通常' },
  { value: 'multiply', label: '乗算' },
  { value: 'screen', label: 'スクリーン' },
  { value: 'overlay', label: 'オーバーレイ' },
  { value: 'darken', label: '比較（暗）' },
  { value: 'lighten', label: '比較（明）' },
  { value: 'color-dodge', label: '覆い焼き' },
  { value: 'color-burn', label: '焼き込み' },
  { value: 'difference', label: '差の絶対値' },
]

function nowLabel(): string {
  return new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date())
}

function asJsonObject(value: Record<string, unknown>): JsonObject {
  return value as unknown as JsonObject
}

function projectToSnapshot(project: ProjectDocument): EditorSnapshot {
  return {
    json: project.fabricCanvas as unknown as Record<string, unknown>,
    width: project.canvasSize.width,
    height: project.canvasSize.height,
    editorState: project.editorState,
  }
}

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const separator = dataUrl.indexOf(',')
  if (separator < 0 || !dataUrl.slice(0, separator).includes(';base64')) {
    throw new TypeError('書き出し画像のData URLが不正です。')
  }
  const binary = atob(dataUrl.slice(separator + 1))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

async function downloadArrayBuffer(
  data: ArrayBuffer,
  fileName: string,
  type: string,
): Promise<void> {
  const { downloadUrl } = await import('./lib/files')
  const url = URL.createObjectURL(new Blob([data], { type }))
  try {
    downloadUrl(url, fileName)
  } finally {
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

const ERROR_CODE_MESSAGES: Record<string, string> = {
  'invalid-json': 'プロジェクトファイルのJSON形式が正しくありません。',
  'invalid-schema': 'プロジェクトファイルの内容が現在の形式に一致しません。',
  'unsupported-version': 'このプロジェクトのバージョンには対応していません。',
  'invalid-app': 'このファイルはPixelweaveのプロジェクトではありません。',
  'save-failed':
    '編集内容を端末に自動保存できませんでした。プロジェクトを手動保存してください。',
  'load-failed': '前回の自動保存データを読み込めませんでした。',
  'clear-failed': '不要な自動保存データを削除できませんでした。',
  'invalid-editor-snapshot':
    '編集データの形式が不正なため保存または復元できません。',
  'unsafe-project-data':
    'プロジェクトに安全でないデータが含まれているため開けません。',
  'project-structure-too-large':
    'プロジェクトの構造が大きすぎるため安全に開けません。',
  'project-object-limit':
    'プロジェクトのレイヤー数が上限（500件）を超えています。',
  'image-byte-limit': 'プロジェクト内の画像は1枚50 MB以下にしてください。',
  'image-dimension-limit':
    '画像寸法が上限（各辺8,192 px、合計64 MP）を超えています。',
  'project-decode-limit':
    'プロジェクト内の画像合計が復元上限（128 MP）を超えています。',
  'invalid-image-data':
    'プロジェクト内の画像データまたは形式が不正なため開けません。',
  'image-dimension-mismatch':
    '画像ヘッダーとデコード結果の寸法が一致しません。',
}

const VALIDATION_ERROR_MESSAGES: Array<{
  pattern: RegExp
  message: string
}> = [
  {
    pattern: /only embedded PNG, JPEG, or WebP images/i,
    message:
      'プロジェクト内の画像形式が不正です。PNG、JPEG、WebPの埋め込み画像のみ開けます。',
  },
  {
    pattern: /invalid Base64 data|could not be decoded/i,
    message: 'プロジェクト内の画像データが破損しているため開けません。',
  },
  {
    pattern:
      /embedded image header is incomplete|dimensions could not be verified/i,
    message: 'プロジェクト内の画像サイズを安全に確認できませんでした。',
  },
  {
    pattern: /no larger than 50 MB/i,
    message: 'プロジェクト内の画像は1枚50 MB以下にしてください。',
  },
  {
    pattern: /8,192 px \/ 64 MP safety limit|8,192 px \/ 64 MP/i,
    message: '画像寸法が上限（各辺8,192 px、合計64 MP）を超えています。',
  },
  {
    pattern: /128 MP embedded-image decode limit/i,
    message: 'プロジェクト内の画像合計が復元上限（128 MP）を超えています。',
  },
  {
    pattern: /at most 500 top-level objects/i,
    message: 'プロジェクトのレイヤー数が上限（500件）を超えています。',
  },
  {
    pattern: /project structure is too large/i,
    message: 'プロジェクトの構造が大きすぎるため安全に開けません。',
  },
  {
    pattern: /unsafe project key|embedded image sources must be strings/i,
    message: 'プロジェクトに安全でないデータが含まれているため開けません。',
  },
  {
    pattern: /invalid editor snapshot/i,
    message: '編集データの形式が不正なため保存または復元できません。',
  },
  {
    pattern: /header does not match its decoded dimensions/i,
    message: '画像ヘッダーとデコード結果の寸法が一致しません。',
  },
]

function userFacingErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String(error.code)
    if (ERROR_CODE_MESSAGES[code]) return ERROR_CODE_MESSAGES[code]
  }

  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') {
      return '端末の保存領域が不足しています。不要なデータを削除してから再試行してください。'
    }
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'ブラウザーの権限またはセキュリティ設定により操作できませんでした。'
    }
  }

  const message = error instanceof Error ? error.message.trim() : ''
  const validationMessage = VALIDATION_ERROR_MESSAGES.find(({ pattern }) =>
    pattern.test(message),
  )
  if (validationMessage) return validationMessage.message
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(message) ? message : fallback
}

function layerIcon(type: string): ReactNode {
  if (type === 'adjustment') return <SlidersHorizontal aria-hidden="true" />
  if (type === 'svg' || type === 'logo') return <Sparkles aria-hidden="true" />
  if (type === 'image') return <Glyph>▧</Glyph>
  if (type === 'i-text' || type === 'text' || type === 'textbox') {
    return <Type aria-hidden="true" />
  }
  if (type === 'ellipse' || type === 'circle') {
    return <Glyph>●</Glyph>
  }
  if (type === 'path') return <Brush aria-hidden="true" />
  return <Glyph>■</Glyph>
}

function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string
  description?: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  const titleId = useId()
  const descriptionId = `${titleId}-description`
  const dialogRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current
      const firstFocusable = dialog?.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )
      ;(firstFocusable ?? dialog)?.focus()
    })

    return () => {
      window.cancelAnimationFrame(frame)
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus()
      }
    }
  }, [])

  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current()
      return
    }
    if (event.key !== 'Tab') return

    const dialog = dialogRef.current
    if (!dialog) return
    const focusable = [
      ...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ].filter(
      (element) =>
        element.getClientRects().length > 0 &&
        element.getAttribute('aria-hidden') !== 'true',
    )
    if (focusable.length === 0) {
      event.preventDefault()
      dialog.focus()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className={`modal${wide ? ' modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onDialogKeyDown}
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Pixelweave Studio</p>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="閉じる"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        {children}
      </section>
    </div>
  )
}

function AdjustmentSlider({
  label,
  value,
  min = -1,
  max = 1,
  step = 0.01,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
}) {
  const displayed = Math.round(value * 100)
  return (
    <label className="adjustment-control">
      <span>
        {label}
        <output>{displayed}</output>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

export default function App() {
  const canvasElementRef = useRef<HTMLCanvasElement>(null)
  const canvasViewportRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const projectInputRef = useRef<HTMLInputElement>(null)
  const engineRef = useRef<FabricEditorEngine | null>(null)
  const automationDispatcherRef = useRef<CommandDispatcher | null>(null)
  const macroRecorderRef = useRef<MacroRecorder | null>(null)
  const macroRepositoryRef = useRef<LocalMacroRepository | null>(null)
  const automationInitializationRef = useRef<Promise<void> | null>(null)
  const automationDisposersRef = useRef<VoidFunction[]>([])
  const iconPresetRepositoryRef = useRef<LocalIconPresetRepository | null>(null)
  const batchModuleRef = useRef<Promise<typeof import('./batch')> | null>(null)
  const imagePipelineClientRef = useRef<ImagePipelineClient | null>(null)
  const selectionFilterClientRef = useRef<SelectionFilterClient | null>(null)
  const selectionFilterAbortRef = useRef<AbortController | null>(null)
  const batchControllerRef = useRef<BatchController | null>(null)
  const batchOutputAbortRef = useRef<AbortController | null>(null)
  const historyRef = useRef(new History<EditorSnapshot>({ limit: 100 }))
  const autosaveRef = useRef<Promise<AutosaveRepository> | null>(null)
  const historyTimerRef = useRef<number | null>(null)
  const autosaveTimerRef = useRef<number | null>(null)
  const pendingAutosaveRef = useRef<{
    snapshot: EditorSnapshot
    generation: number
    revision: number
  } | null>(null)
  const autosaveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const autosaveGenerationRef = useRef(0)
  const latestAutosaveRequestRef = useRef({
    generation: 0,
    revision: -1,
  })
  const revisionRef = useRef(0)
  const latestSnapshotRef = useRef<EditorSnapshot | null>(null)
  const pendingHistoryRef = useRef<{
    reason: EditorChangeReason
    snapshot: EditorSnapshot
  } | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const recoveryRef = useRef<ProjectDocument | null>(null)
  const saveHandleRef = useRef<SaveFileHandleLike | null>(null)
  const createdAtRef = useRef(new Date().toISOString())
  const projectNameRef = useRef('無題のデザイン')
  const sourceNameRef = useRef<string | undefined>(undefined)
  const historyIdRef = useRef(1)
  const dragDepthRef = useRef(0)
  const dirtyRef = useRef(false)
  const busyRef = useRef(false)
  const busyDepthRef = useRef(0)
  const updateTimeoutRef = useRef<number | null>(null)
  const updateInProgressRef = useRef(false)
  const editorOperationGateRef = useRef(new AsyncOperationGate())

  const [tool, setTool] = useState<EditorTool>('select')
  const [layers, setLayers] = useState<LayerInfo[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectionTransform, setSelectionTransform] =
    useState<SelectionTransform | null>(null)
  const [selectionMask, setSelectionMask] = useState<SelectionMask>()
  const [zoom, setZoom] = useState(1)
  const [documentSize, setDocumentSize] = useState({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  })
  const [brushColor, setBrushColor] = useState('#f5b841')
  const [brushSize, setBrushSize] = useState(18)
  const [brushOpacity, setBrushOpacity] = useState(1)
  const [shapeColor, setShapeColor] = useState('#7c6cff')
  const [filters, setFilters] =
    useState<Required<ImageFilterSettings>>(DEFAULT_FILTERS)
  const [filterSelectionOnly, setFilterSelectionOnly] = useState(false)
  const [selectionFilterRunning, setSelectionFilterRunning] = useState(false)
  const [selectionFilterProgress, setSelectionFilterProgress] =
    useState<SelectionFilterProgress>()
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('layers')
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [activeDialog, setActiveDialog] = useState<DialogName>(null)
  const [studioTab, setStudioTab] = useState<StudioTab>('logo')
  const [projectName, setProjectName] = useState('無題のデザイン')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [status, setStatus] = useState<EditorStatus>({
    message: '準備ができました',
    kind: 'info',
  })
  const [autosaveState, setAutosaveState] = useState<
    'idle' | 'saving' | 'saved' | 'failed'
  >('idle')
  const [recoveryAvailable, setRecoveryAvailable] = useState(false)
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [historyState, setHistoryState] = useState({
    canUndo: false,
    canRedo: false,
    size: 0,
    index: -1,
  })
  const [historyLabels, setHistoryLabels] = useState<HistoryLabel[]>([
    { id: 0, label: '新規ドキュメント', time: nowLabel() },
  ])
  const [savedMacros, setSavedMacros] = useState<MacroRepositoryEntry[]>([])
  const [macroRecording, setMacroRecording] = useState(false)
  const [recordedCommandCount, setRecordedCommandCount] = useState(0)
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchProgress, setBatchProgress] = useState<BatchProgress>()
  const [batchFailures, setBatchFailures] = useState<BatchFailure[]>([])
  const [userIconPresets, setUserIconPresets] = useState<IconExportPreset[]>([])
  const [quickAutomation, setQuickAutomation] = useState<{
    width: number
    height: number
    filter: AutomationFilter
    filterValue: number
    watermark: string
  }>({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    filter: 'contrast',
    filterValue: 0.15,
    watermark: 'Pixelweave',
  })
  const [renamingLayerId, setRenamingLayerId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [newDocument, setNewDocument] = useState({
    name: '無題のデザイン',
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  })
  const [exportSettings, setExportSettings] = useState<{
    format: ExportImageFormat | 'svg'
    quality: number
    multiplier: number
    svgScope: 'document' | 'selection'
  }>({
    format: 'png',
    quality: 0.92,
    multiplier: 1,
    svgScope: 'document',
  })

  const [pwaState, setPwaState] = useState({
    offlineReady: false,
    updateAvailable: false,
  })
  const updateAvailable = pwaState.updateAvailable && !updateDismissed

  useEffect(() => {
    let active = true
    let unsubscribe: VoidFunction | undefined
    void import('./pwa').then(({ getPwaState, subscribePwaState }) => {
      if (!active) return
      const refresh = (): void => setPwaState(getPwaState())
      refresh()
      unsubscribe = subscribePwaState(refresh)
    })
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    projectNameRef.current = projectName
  }, [projectName])

  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current || updateInProgressRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  useEffect(
    () => () => {
      if (updateTimeoutRef.current !== null) {
        window.clearTimeout(updateTimeoutRef.current)
      }
    },
    [],
  )

  const beginBusy = useCallback(() => {
    busyDepthRef.current += 1
    busyRef.current = true
    setBusy(true)
  }, [])

  const endBusy = useCallback(() => {
    busyDepthRef.current = Math.max(0, busyDepthRef.current - 1)
    if (busyDepthRef.current === 0) {
      busyRef.current = false
      setBusy(false)
    }
  }, [])

  const waitForEditorOperations = useCallback(
    () => editorOperationGateRef.current.waitForIdle(),
    [],
  )

  const runEditorOperation = useCallback(
    (operation: (engine: FabricEditorEngine) => Promise<unknown>) => {
      const engine = engineRef.current
      if (!engine || busyRef.current) return
      beginBusy()
      let tracked: Promise<unknown>
      try {
        tracked = editorOperationGateRef.current.track(operation(engine))
      } catch (error) {
        endBusy()
        setStatus({
          kind: 'error',
          message: userFacingErrorMessage(
            error,
            '編集操作を完了できませんでした。',
          ),
        })
        return
      }
      void tracked
        .catch((error: unknown) => {
          setStatus({
            kind: 'error',
            message: userFacingErrorMessage(
              error,
              '編集操作を完了できませんでした。',
            ),
          })
        })
        .finally(endBusy)
    },
    [beginBusy, endBusy],
  )

  const ensureAutomationRuntime = useCallback(async (): Promise<void> => {
    if (automationDispatcherRef.current && macroRecorderRef.current) return
    automationInitializationRef.current ??= Promise.all([
      import('./automation'),
      import('./editor/automationAdapter'),
    ])
      .then(([automation, { executeEditorAutomationCommand }]) => {
        const engine = engineRef.current
        if (!engine) {
          throw new Error('自動化コマンドの準備ができていません。')
        }
        const dispatcher = new automation.CommandDispatcher(
          (command, context) =>
            executeEditorAutomationCommand(engine, command, context),
        )
        const recorder = new automation.MacroRecorder()
        automationDispatcherRef.current = dispatcher
        macroRecorderRef.current = recorder
        automationDisposersRef.current = [
          recorder.attach(dispatcher),
          dispatcher.subscribe(() => {
            setRecordedCommandCount(recorder.commandCount)
          }),
        ]
        try {
          macroRepositoryRef.current = new automation.LocalMacroRepository(
            window.localStorage,
          )
          setSavedMacros(macroRepositoryRef.current.list())
        } catch {
          setStatus({
            kind: 'warning',
            message:
              'ブラウザーの保存領域を利用できないため、マクロはこのセッションだけ有効です。',
          })
        }
      })
      .catch((error: unknown) => {
        automationInitializationRef.current = null
        throw error
      })
    await automationInitializationRef.current
  }, [])

  const dispatchAutomationCommand = useCallback(
    async (command: AutomationCommand): Promise<void> => {
      await ensureAutomationRuntime()
      const dispatcher = automationDispatcherRef.current
      if (!dispatcher) {
        throw new Error('自動化コマンドの準備ができていません。')
      }
      await dispatcher.dispatch(command, { origin: 'user' })
    },
    [ensureAutomationRuntime],
  )

  const runQuickCommand = useCallback(
    (command: AutomationCommand): void => {
      void dispatchAutomationCommand(command).catch((error: unknown) => {
        setStatus({
          kind: 'error',
          message: userFacingErrorMessage(
            error,
            'クイック操作を完了できませんでした。',
          ),
        })
      })
    },
    [dispatchAutomationCommand],
  )

  const startMacroRecording = useCallback(
    async (name: string): Promise<void> => {
      await ensureAutomationRuntime()
      const recorder = macroRecorderRef.current
      if (!recorder) {
        throw new Error('マクロ記録の準備ができていません。')
      }
      const id = `macro-${crypto.randomUUID()}`
      recorder.start({
        id,
        name,
        appVersion: APP_VERSION,
      })
      setRecordedCommandCount(0)
      setMacroRecording(true)
    },
    [ensureAutomationRuntime],
  )

  const stopMacroRecording = useCallback(async (): Promise<void> => {
    await ensureAutomationRuntime()
    const recorder = macroRecorderRef.current
    if (!recorder) {
      throw new Error('マクロ記録の準備ができていません。')
    }
    const macro = recorder.stop()
    macroRepositoryRef.current?.save(macro)
    setSavedMacros((current) => {
      const retained = current.filter(
        ({ macro: entry }) => entry.id !== macro.id,
      )
      return [{ macro, diagnostics: [] }, ...retained]
    })
    setRecordedCommandCount(0)
    setMacroRecording(false)
  }, [ensureAutomationRuntime])

  const replayMacro = useCallback(
    async ({ macro, parameters }: MacroReplayRequest): Promise<void> => {
      const engine = engineRef.current
      await ensureAutomationRuntime()
      const dispatcher = automationDispatcherRef.current
      if (!engine || !dispatcher) {
        throw new Error('マクロを再生する準備ができていません。')
      }
      const { resolveMacroParameters } = await import('./automation')
      const commands = resolveMacroParameters(macro, parameters)
      const aliases = new Map<string, unknown>()
      beginBusy()
      try {
        await editorOperationGateRef.current.track(
          engine.runAtomic('macro', async () => {
            for (const command of commands) {
              await dispatcher.dispatch(command, {
                origin: 'replay',
                resultAliases: aliases,
              })
            }
          }),
        )
      } finally {
        endBusy()
      }
    },
    [beginBusy, endBusy, ensureAutomationRuntime],
  )

  const importMacro = useCallback(
    async ({ parsed }: MacroImportRequest): Promise<void> => {
      await ensureAutomationRuntime()
      macroRepositoryRef.current?.save(parsed.macro)
      setSavedMacros((current) => {
        const retained = current.filter(
          ({ macro }) => macro.id !== parsed.macro.id,
        )
        return [parsed, ...retained]
      })
      if (parsed.diagnostics.length > 0) {
        setStatus({
          kind: 'warning',
          message: `${parsed.diagnostics.length}件の未知または不正なコマンドを安全にスキップしました。`,
        })
      }
    },
    [ensureAutomationRuntime],
  )

  const exportMacro = useCallback(
    async ({ fileName, source }: MacroExportRequest): Promise<void> => {
      const { downloadText } = await import('./lib/files')
      downloadText(source, fileName, 'application/json')
    },
    [],
  )

  const getBatchModule = useCallback((): Promise<typeof import('./batch')> => {
    batchModuleRef.current ??= import('./batch')
    return batchModuleRef.current
  }, [])

  const ensureIconPresetRepository = useCallback(async (): Promise<void> => {
    if (iconPresetRepositoryRef.current) return
    const { LocalIconPresetRepository } = await getBatchModule()
    try {
      iconPresetRepositoryRef.current = new LocalIconPresetRepository(
        window.localStorage,
      )
      setUserIconPresets(iconPresetRepositoryRef.current.listUser())
    } catch {
      setStatus({
        kind: 'warning',
        message:
          'ブラウザーの保存領域を利用できないため、アイコンプリセットはこのセッションだけ有効です。',
      })
    }
  }, [getBatchModule])

  const getImagePipeline =
    useCallback(async (): Promise<ImagePipelineClient> => {
      if (!imagePipelineClientRef.current) {
        const { ImagePipelineClient } = await getBatchModule()
        imagePipelineClientRef.current = new ImagePipelineClient()
      }
      return imagePipelineClientRef.current
    }, [getBatchModule])

  const chooseOutputDestination = useCallback(
    async (
      mode: 'auto' | 'directory' | 'zip',
    ): Promise<BatchOutputDestination> => {
      const { chooseBatchOutputDestination } = await getBatchModule()
      const picker = (window as WindowWithDirectoryPicker).showDirectoryPicker
      return chooseBatchOutputDestination({
        mode,
        ...(picker ? { showDirectoryPicker: () => picker.call(window) } : {}),
      })
    },
    [getBatchModule],
  )

  const writeGeneratedEntries = useCallback(
    async (
      entries: StoredZipEntry[],
      destination: BatchOutputDestination,
      zipName: string,
      signal?: AbortSignal,
    ): Promise<void> => {
      if (entries.length === 0) return
      if (destination.kind === 'directory') {
        const { writeEntriesToDirectory } = await getBatchModule()
        await writeEntriesToDirectory(destination.handle, entries, { signal })
        return
      }
      const client = await getImagePipeline()
      const archive = await client.createZip({
        jobId: `zip-${crypto.randomUUID()}`,
        entries,
        signal,
      })
      await downloadArrayBuffer(archive, zipName, 'application/zip')
    },
    [getBatchModule, getImagePipeline],
  )

  const startBatch = useCallback(
    async (request: BatchTransformRequest): Promise<void> => {
      const destination = await chooseOutputDestination(request.outputMode)
      const [{ BatchController }, client] = await Promise.all([
        getBatchModule(),
        getImagePipeline(),
      ])
      const controller = new BatchController(client)
      const outputController = new AbortController()
      batchControllerRef.current = controller
      batchOutputAbortRef.current = outputController
      setBatchRunning(true)
      setBatchFailures([])
      setBatchProgress({
        completed: 0,
        failed: 0,
        total: request.items.length,
        active: 0,
      })
      try {
        const result = await controller.run(request.items, {
          commands: [...request.commands],
          output: request.output,
          concurrency: 2,
          signal: outputController.signal,
          onProgress: setBatchProgress,
        })
        setBatchFailures(result.failed)
        await writeGeneratedEntries(
          result.completed.map(({ outputName, data }) => ({
            name: outputName,
            data,
          })),
          destination,
          `${sanitizeFileStem(projectNameRef.current)}-batch.zip`,
          outputController.signal,
        )
      } finally {
        if (batchControllerRef.current === controller) {
          batchControllerRef.current = null
        }
        if (batchOutputAbortRef.current === outputController) {
          batchOutputAbortRef.current = null
        }
        setBatchRunning(false)
      }
    },
    [
      chooseOutputDestination,
      getBatchModule,
      getImagePipeline,
      writeGeneratedEntries,
    ],
  )

  const cancelBatch = useCallback((): void => {
    const cancelledProcessing = batchControllerRef.current?.cancel() ?? false
    if (!cancelledProcessing) {
      batchOutputAbortRef.current?.abort()
    }
  }, [])

  const changeUserIconPresets = useCallback(
    async (presets: readonly IconExportPreset[]): Promise<void> => {
      await ensureIconPresetRepository()
      iconPresetRepositoryRef.current?.saveUser(presets)
      setUserIconPresets([...presets])
    },
    [ensureIconPresetRepository],
  )

  const exportIcons = useCallback(
    async ({ presets, outputMode }: IconExportRequest): Promise<void> => {
      const engine = engineRef.current
      if (!engine) {
        throw new Error('アイコンを書き出す準備ができていません。')
      }
      const destination = await chooseOutputDestination(outputMode)
      const controller = new AbortController()
      batchOutputAbortRef.current = controller
      try {
        const entries: StoredZipEntry[] = []
        for (const preset of presets) {
          if (controller.signal.aborted) {
            throw new DOMException('Aborted', 'AbortError')
          }
          entries.push({
            name: preset.fileName,
            data: dataUrlToArrayBuffer(
              await engine.exportSizedPng(
                preset.width,
                preset.height,
                preset.fit,
                preset.background,
              ),
            ),
          })
          await new Promise<void>((resolve) =>
            globalThis.setTimeout(resolve, 0),
          )
        }
        await writeGeneratedEntries(
          entries,
          destination,
          `${sanitizeFileStem(projectNameRef.current)}-icons.zip`,
          controller.signal,
        )
      } finally {
        if (batchOutputAbortRef.current === controller) {
          batchOutputAbortRef.current = null
        }
      }
    },
    [chooseOutputDestination, writeGeneratedEntries],
  )

  const selectedLayer = useMemo(
    () => layers.find((layer) => layer.id === selectedIds[0]) ?? null,
    [layers, selectedIds],
  )
  const selectedAdvancedAdjustment = useMemo(() => {
    if (selectedLayer?.type !== 'adjustment') {
      return undefined
    }
    const operations = engineRef.current?.getAdvancedAdjustmentLayerOperations(
      selectedLayer.id,
    )
    return operations ? { id: selectedLayer.id, operations } : undefined
  }, [selectedLayer])
  const selectedTextStyle = useMemo(
    () =>
      selectedLayer &&
      ['i-text', 'text', 'textbox'].includes(selectedLayer.type)
        ? (engineRef.current?.getSelectedTextStyle() ?? null)
        : null,
    [selectedLayer],
  )

  const refreshHistoryState = useCallback(() => {
    const history = historyRef.current
    setHistoryState({
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      size: history.size,
      index: history.index,
    })
  }, [])

  const refreshEditorState = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return
    setLayers(engine.getLayers())
    setSelectedIds(engine.getSelectedLayerIds())
    setSelectionTransform(engine.getSelectionTransform())
    setSelectionMask(engine.getPixelSelectionMask())
    setFilters(engine.getSelectedImageFilters() ?? DEFAULT_FILTERS)
    setDocumentSize(engine.getDocumentSize())
    setZoom(engine.getZoom())
  }, [])

  const getAutosaveRepository = useCallback((): Promise<AutosaveRepository> => {
    autosaveRef.current ??= import('./editor/autosave').then(
      ({ createAutosaveRepository }) => createAutosaveRepository(),
    )
    return autosaveRef.current
  }, [])

  const makeProject = useCallback(
    async (snapshot?: EditorSnapshot): Promise<ProjectDocument> => {
      const engine = engineRef.current
      if (!engine && !snapshot) {
        throw new Error('エディターがまだ準備できていません。')
      }
      const current = snapshot ?? engine!.snapshot()
      assertRestorableEditorSnapshot(current)
      const metadata: JsonObject = {
        name: projectNameRef.current.trim() || '無題のデザイン',
        createdAt: createdAtRef.current,
      }
      if (sourceNameRef.current) {
        metadata.sourceFileName = sourceNameRef.current
      }
      const { createProjectDocument } = await import('./editor/project')
      return createProjectDocument({
        fabricCanvas: asJsonObject(current.json),
        canvasSize: { width: current.width, height: current.height },
        editorState: current.editorState,
        metadata,
      })
    },
    [],
  )

  const enqueueAutosave = useCallback(
    (
      snapshot: EditorSnapshot,
      generation = autosaveGenerationRef.current,
      revision = revisionRef.current,
    ): Promise<void> => {
      if (generation !== autosaveGenerationRef.current) {
        return Promise.resolve()
      }
      const latest = latestAutosaveRequestRef.current
      if (latest.generation === generation && latest.revision > revision) {
        return Promise.resolve()
      }
      latestAutosaveRequestRef.current = { generation, revision }

      const operation = autosaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (generation !== autosaveGenerationRef.current) return
          const newest = latestAutosaveRequestRef.current
          if (newest.generation === generation && newest.revision > revision) {
            return
          }
          const project = await makeProject(snapshot)
          const autosave = await getAutosaveRepository()
          await autosave.save(project)
          const latestAfterSave = latestAutosaveRequestRef.current
          if (
            generation === autosaveGenerationRef.current &&
            latestAfterSave.generation === generation &&
            latestAfterSave.revision <= revision
          ) {
            setAutosaveState('saved')
          }
        })
      const reported = operation.catch((error: unknown) => {
        if (generation === autosaveGenerationRef.current) {
          setAutosaveState('failed')
          setStatus({
            kind: 'warning',
            message: userFacingErrorMessage(
              error,
              '編集内容を自動保存できませんでした。プロジェクトを手動保存してください。',
            ),
          })
        }
        throw error
      })
      autosaveQueueRef.current = reported.catch(() => undefined)
      return reported
    },
    [getAutosaveRepository, makeProject],
  )

  const scheduleAutosave = useCallback(
    (snapshot: EditorSnapshot) => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current)
      }
      const pending = {
        snapshot,
        generation: autosaveGenerationRef.current,
        revision: revisionRef.current,
      }
      pendingAutosaveRef.current = pending
      setAutosaveState('saving')
      autosaveTimerRef.current = window.setTimeout(() => {
        autosaveTimerRef.current = null
        if (pendingAutosaveRef.current !== pending) return
        pendingAutosaveRef.current = null
        void enqueueAutosave(
          pending.snapshot,
          pending.generation,
          pending.revision,
        ).catch(() => undefined)
      }, AUTOSAVE_DELAY)
    },
    [enqueueAutosave],
  )

  const cancelPendingAutosave = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
    pendingAutosaveRef.current = null
  }, [])

  const flushAutosave = useCallback(
    (
      snapshot?: EditorSnapshot,
      revision = revisionRef.current,
    ): Promise<void> => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }
      const pending = pendingAutosaveRef.current
      pendingAutosaveRef.current = null
      if (snapshot) {
        setAutosaveState('saving')
        const requested = enqueueAutosave(
          snapshot,
          autosaveGenerationRef.current,
          revision,
        )
        if (
          pending &&
          pending.generation === autosaveGenerationRef.current &&
          pending.revision > revision
        ) {
          return enqueueAutosave(
            pending.snapshot,
            pending.generation,
            pending.revision,
          )
        }
        return requested
      }
      if (pending) {
        return enqueueAutosave(
          pending.snapshot,
          pending.generation,
          pending.revision,
        )
      }
      return autosaveQueueRef.current
    },
    [enqueueAutosave],
  )

  const clearAutosaveForGeneration = useCallback(
    (generation: number): Promise<void> => {
      const operation = autosaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (generation !== autosaveGenerationRef.current) return
          const autosave = await getAutosaveRepository()
          await autosave.clear()
          if (generation === autosaveGenerationRef.current) {
            setAutosaveState('idle')
          }
        })
      autosaveQueueRef.current = operation.catch(() => undefined)
      return operation
    },
    [getAutosaveRepository],
  )

  const commitSnapshot = useCallback(
    (reason: EditorChangeReason, capturedSnapshot?: EditorSnapshot) => {
      const engine = engineRef.current
      if (!engine && !capturedSnapshot) return
      const snapshot = capturedSnapshot ?? engine!.snapshot()
      if (!historyRef.current.push(snapshot)) return
      dirtyRef.current = true
      setDirty(true)
      refreshHistoryState()
      setHistoryLabels((entries) =>
        [
          ...entries,
          {
            id: historyIdRef.current++,
            label: CHANGE_LABELS[reason],
            time: nowLabel(),
          },
        ].slice(-20),
      )
      scheduleAutosave(snapshot)
      setDocumentSize({ width: snapshot.width, height: snapshot.height })
      setSelectionTransform(engine?.getSelectionTransform() ?? null)
    },
    [refreshHistoryState, scheduleAutosave],
  )

  const scheduleSnapshot = useCallback(
    (reason: EditorChangeReason) => {
      const engine = engineRef.current
      if (!engine) return
      revisionRef.current += 1
      const snapshot = engine.snapshot()
      latestSnapshotRef.current = snapshot
      setSelectionMask(engine.getPixelSelectionMask())

      if (!DEBOUNCED_CHANGE_REASONS.has(reason)) {
        if (historyTimerRef.current !== null) {
          window.clearTimeout(historyTimerRef.current)
          historyTimerRef.current = null
        }
        const pending = pendingHistoryRef.current
        pendingHistoryRef.current = null
        if (pending) {
          commitSnapshot(pending.reason, pending.snapshot)
        }
        commitSnapshot(reason, snapshot)
        return
      }

      const prior = pendingHistoryRef.current
      if (prior && prior.reason !== reason) {
        commitSnapshot(prior.reason, prior.snapshot)
      }
      if (historyTimerRef.current !== null) {
        window.clearTimeout(historyTimerRef.current)
      }
      pendingHistoryRef.current = { reason, snapshot }
      historyTimerRef.current = window.setTimeout(() => {
        historyTimerRef.current = null
        const pending = pendingHistoryRef.current
        pendingHistoryRef.current = null
        if (pending) commitSnapshot(pending.reason, pending.snapshot)
      }, HISTORY_DELAY)
    },
    [commitSnapshot],
  )

  const flushPendingHistory = useCallback(() => {
    if (historyTimerRef.current !== null) {
      window.clearTimeout(historyTimerRef.current)
      historyTimerRef.current = null
    }
    const pending = pendingHistoryRef.current
    pendingHistoryRef.current = null
    if (pending) commitSnapshot(pending.reason, pending.snapshot)
  }, [commitSnapshot])

  const cancelPendingHistory = useCallback(() => {
    if (historyTimerRef.current !== null) {
      window.clearTimeout(historyTimerRef.current)
      historyTimerRef.current = null
    }
    pendingHistoryRef.current = null
  }, [])

  const fitCanvas = useCallback(() => {
    const engine = engineRef.current
    const host = canvasViewportRef.current
    if (!engine || !host) return
    const { width, height } = host.getBoundingClientRect()
    if (width > 0 && height > 0) {
      engine.fitToViewport(width, height, 42)
    }
  }, [])

  useEffect(() => {
    const element = canvasElementRef.current
    if (!element) return

    const engine = new FabricEditorEngine(element, {
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      brushColor,
      brushWidth: brushSize,
      brushOpacity,
      callbacks: {
        onChanged: scheduleSnapshot,
        onLayersChanged: setLayers,
        onSelectionChanged: (ids) => {
          setSelectedIds(ids)
          setSelectionTransform(
            engineRef.current?.getSelectionTransform() ?? null,
          )
          setFilters(
            engineRef.current?.getSelectedImageFilters() ?? DEFAULT_FILTERS,
          )
        },
        onStatus: setStatus,
        onZoomChanged: setZoom,
      },
    })
    engineRef.current = engine
    const initialSnapshot = engine.snapshot()
    latestSnapshotRef.current = initialSnapshot
    historyRef.current.reset(initialSnapshot)
    refreshHistoryState()
    refreshEditorState()

    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current)
      }
      resizeFrameRef.current = requestAnimationFrame(fitCanvas)
    })
    if (canvasViewportRef.current) {
      resizeObserver.observe(canvasViewportRef.current)
    }
    requestAnimationFrame(fitCanvas)

    void getAutosaveRepository()
      .then((autosave) => autosave.load())
      .then((project) => {
        if (project) {
          recoveryRef.current = project
          setRecoveryAvailable(true)
        }
      })
      .catch((error: unknown) => {
        setStatus({
          kind: 'warning',
          message: userFacingErrorMessage(
            error,
            '前回の自動保存データを確認できませんでした。',
          ),
        })
      })

    return () => {
      resizeObserver.disconnect()
      if (historyTimerRef.current !== null) {
        window.clearTimeout(historyTimerRef.current)
      }
      pendingHistoryRef.current = null
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current)
      }
      pendingAutosaveRef.current = null
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current)
      }
      automationDisposersRef.current.splice(0).forEach((dispose) => dispose())
      macroRecorderRef.current?.cancel()
      batchControllerRef.current?.cancel()
      batchOutputAbortRef.current?.abort()
      selectionFilterAbortRef.current?.abort()
      selectionFilterClientRef.current?.dispose()
      selectionFilterClientRef.current = null
      imagePipelineClientRef.current?.dispose()
      imagePipelineClientRef.current = null
      batchControllerRef.current = null
      automationDispatcherRef.current = null
      engineRef.current = null
      void engine.dispose().catch((error: unknown) => {
        console.error('Pixelweave editor disposal failed', error)
      })
    }
    // Engine lifetime is intentionally tied to the canvas element.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (pwaState.offlineReady) {
      setStatus((current) =>
        current.message === '準備ができました'
          ? {
              kind: 'success',
              message: 'オフラインで使う準備ができました。',
            }
          : current,
      )
    }
  }, [pwaState.offlineReady])

  useEffect(() => {
    engineRef.current?.setBrushOptions({
      color: brushColor,
      size: brushSize,
      opacity: brushOpacity,
    })
  }, [brushColor, brushOpacity, brushSize])

  useEffect(() => {
    if (!selectionMask) {
      setFilterSelectionOnly(false)
    }
  }, [selectionMask])

  useEffect(() => {
    if (activeDialog !== 'studio' || studioTab !== 'automation') return
    void Promise.all([
      ensureAutomationRuntime(),
      ensureIconPresetRepository(),
    ]).catch((error: unknown) => {
      setStatus({
        kind: 'error',
        message: userFacingErrorMessage(
          error,
          '自動化ツールを読み込めませんでした。',
        ),
      })
    })
  }, [
    activeDialog,
    ensureAutomationRuntime,
    ensureIconPresetRepository,
    studioTab,
  ])

  const activateTool = useCallback(
    (nextTool: EditorTool) => {
      engineRef.current?.setTool(nextTool, {
        color: brushColor,
        size: brushSize,
        opacity: brushOpacity,
      })
      setTool(nextTool)
      setStatus({
        kind: 'info',
        message: `${TOOL_ITEMS.find((item) => item.id === nextTool)?.label ?? nextTool}ツール`,
      })
    },
    [brushColor, brushOpacity, brushSize],
  )

  const restoreSnapshot = useCallback(
    async (snapshot: EditorSnapshot) => {
      const engine = engineRef.current
      if (!engine) return
      beginBusy()
      try {
        await waitForEditorOperations()
        await engine.restore(snapshot)
        latestSnapshotRef.current = snapshot
        refreshEditorState()
        fitCanvas()
      } finally {
        endBusy()
      }
    },
    [
      beginBusy,
      endBusy,
      fitCanvas,
      refreshEditorState,
      waitForEditorOperations,
    ],
  )

  const undo = useCallback(async () => {
    beginBusy()
    try {
      await waitForEditorOperations()
      flushPendingHistory()
      const snapshot = historyRef.current.undo()
      if (!snapshot) return
      await restoreSnapshot(snapshot)
      revisionRef.current += 1
      refreshHistoryState()
      scheduleAutosave(snapshot)
      dirtyRef.current = true
      setDirty(true)
      setStatus({ kind: 'info', message: '1つ前の状態に戻しました。' })
    } catch (error) {
      setStatus({
        kind: 'error',
        message: userFacingErrorMessage(error, '操作を元に戻せませんでした。'),
      })
    } finally {
      endBusy()
    }
  }, [
    beginBusy,
    endBusy,
    flushPendingHistory,
    refreshHistoryState,
    restoreSnapshot,
    scheduleAutosave,
    waitForEditorOperations,
  ])

  const redo = useCallback(async () => {
    beginBusy()
    try {
      await waitForEditorOperations()
      flushPendingHistory()
      const snapshot = historyRef.current.redo()
      if (!snapshot) return
      await restoreSnapshot(snapshot)
      revisionRef.current += 1
      refreshHistoryState()
      scheduleAutosave(snapshot)
      dirtyRef.current = true
      setDirty(true)
      setStatus({ kind: 'info', message: '操作をやり直しました。' })
    } catch (error) {
      setStatus({
        kind: 'error',
        message: userFacingErrorMessage(error, '操作をやり直せませんでした。'),
      })
    } finally {
      endBusy()
    }
  }, [
    beginBusy,
    endBusy,
    flushPendingHistory,
    refreshHistoryState,
    restoreSnapshot,
    scheduleAutosave,
    waitForEditorOperations,
  ])

  const importImage = useCallback(
    async (file: File) => {
      const engine = engineRef.current
      if (!engine) return
      beginBusy()
      try {
        await waitForEditorOperations()
        const { readFileAsDataUrl, validateImageHeader } =
          await import('./lib/files')
        await validateImageHeader(file)
        activateTool('select')
        const dataUrl = await readFileAsDataUrl(file)
        await engine.importImage(dataUrl, sanitizeFileStem(file.name), {
          resizeCanvasIfEmpty: true,
        })
        sourceNameRef.current = file.name
        if (projectNameRef.current === '無題のデザイン') {
          const nextName = sanitizeFileStem(file.name)
          setProjectName(nextName)
          projectNameRef.current = nextName
        }
        refreshEditorState()
        fitCanvas()
      } catch (error) {
        setStatus({
          kind: 'error',
          message: userFacingErrorMessage(
            error,
            '画像を読み込めませんでした。',
          ),
        })
      } finally {
        endBusy()
      }
    },
    [
      activateTool,
      beginBusy,
      endBusy,
      fitCanvas,
      refreshEditorState,
      waitForEditorOperations,
    ],
  )

  const importSvg = useCallback(
    async (file: File) => {
      const engine = engineRef.current
      if (!engine) return
      beginBusy()
      try {
        await waitForEditorOperations()
        const { sanitizeSvg } = await import('./lib/svgSafety')
        const sanitized = sanitizeSvg(await file.text())
        activateTool('select')
        await engine.importSvg(sanitized.source, sanitizeFileStem(file.name))
        sourceNameRef.current = file.name
        if (projectNameRef.current === '無題のデザイン') {
          const nextName = sanitizeFileStem(file.name)
          setProjectName(nextName)
          projectNameRef.current = nextName
        }
        refreshEditorState()
        setStatus({
          kind:
            sanitized.removedElements + sanitized.removedAttributes > 0
              ? 'warning'
              : 'success',
          message:
            sanitized.removedElements + sanitized.removedAttributes > 0
              ? '安全でないSVG要素・属性を除去して読み込みました。'
              : 'SVGをベクターレイヤーとして読み込みました。',
        })
      } catch (error) {
        setStatus({
          kind: 'error',
          message: userFacingErrorMessage(
            error,
            'SVGを安全に読み込めませんでした。',
          ),
        })
      } finally {
        endBusy()
      }
    },
    [
      activateTool,
      beginBusy,
      endBusy,
      refreshEditorState,
      waitForEditorOperations,
    ],
  )

  const onImageInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (
      file.type === 'image/svg+xml' ||
      file.name.toLowerCase().endsWith('.svg')
    ) {
      await importSvg(file)
    } else {
      await importImage(file)
    }
  }

  const openProject = useCallback(
    async (file: File) => {
      if (
        dirtyRef.current &&
        !window.confirm(
          '現在の未保存の編集を閉じて、別のプロジェクトを開きますか？',
        )
      ) {
        return
      }
      if (file.size <= 0 || file.size > MAX_PROJECT_BYTES) {
        setStatus({
          kind: 'error',
          message: 'プロジェクトファイルは100 MB以下にしてください。',
        })
        return
      }
      beginBusy()
      try {
        await waitForEditorOperations()
        const { parseProject } = await import('./editor/project')
        const project = parseProject(await file.text())
        await restoreSnapshot(projectToSnapshot(project))
        cancelPendingHistory()
        cancelPendingAutosave()
        autosaveGenerationRef.current += 1
        const generation = autosaveGenerationRef.current
        const snapshot = engineRef.current!.snapshot()
        latestSnapshotRef.current = snapshot
        revisionRef.current += 1
        historyRef.current.reset(snapshot)
        refreshHistoryState()
        const name = project.metadata.name
        setProjectName(name)
        projectNameRef.current = name
        createdAtRef.current = project.metadata.createdAt
        sourceNameRef.current = project.metadata.sourceFileName
        saveHandleRef.current = null
        setHistoryLabels([
          {
            id: historyIdRef.current++,
            label: 'プロジェクトを開く',
            time: nowLabel(),
          },
        ])
        dirtyRef.current = false
        setDirty(false)
        setStatus({ kind: 'success', message: 'プロジェクトを開きました。' })
        void enqueueAutosave(snapshot, generation).catch(() => undefined)
      } catch (error) {
        setStatus({
          kind: 'error',
          message: userFacingErrorMessage(
            error,
            'プロジェクトを開けませんでした。ファイル形式を確認してください。',
          ),
        })
      } finally {
        endBusy()
      }
    },
    [
      cancelPendingAutosave,
      cancelPendingHistory,
      enqueueAutosave,
      beginBusy,
      endBusy,
      refreshHistoryState,
      restoreSnapshot,
      waitForEditorOperations,
    ],
  )

  const onProjectInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) await openProject(file)
  }

  const saveProject = useCallback(async () => {
    beginBusy()
    try {
      await waitForEditorOperations()
      flushPendingHistory()
      const snapshot = engineRef.current?.snapshot()
      if (snapshot) latestSnapshotRef.current = snapshot
      const savedRevision = revisionRef.current
      const project = await makeProject(snapshot)
      const { serializeProject } = await import('./editor/project')
      const source = serializeProject(project)
      if (new Blob([source]).size > MAX_PROJECT_BYTES) {
        throw new FileValidationError(
          'プロジェクトが100 MBを超えています。レイヤーを減らすか、完成画像を書き出してください。',
        )
      }
      const fileName = `${sanitizeFileStem(projectNameRef.current)}.pwx.json`
      const picker = (window as WindowWithSavePicker).showSaveFilePicker
      if (picker) {
        const handle =
          saveHandleRef.current ??
          (await picker.call(window, {
            suggestedName: fileName,
            types: [
              {
                description: 'Pixelweave project',
                accept: { 'application/json': ['.pwx.json', '.json'] },
              },
            ],
          }))
        const writable = await handle.createWritable()
        await writable.write(new Blob([source], { type: 'application/json' }))
        await writable.close()
        saveHandleRef.current = handle
      } else {
        const { downloadText } = await import('./lib/files')
        downloadText(source, fileName)
      }
      const latestSnapshot = engineRef.current?.snapshot()
      if (latestSnapshot) {
        latestSnapshotRef.current = latestSnapshot
        await flushAutosave(latestSnapshot, revisionRef.current)
      }
      if (savedRevision === revisionRef.current) {
        dirtyRef.current = false
        setDirty(false)
        setStatus({ kind: 'success', message: 'プロジェクトを保存しました。' })
      } else {
        dirtyRef.current = true
        setDirty(true)
        setStatus({
          kind: 'warning',
          message: '保存中に追加の変更がありました。もう一度保存してください。',
        })
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setStatus({
        kind: 'error',
        message: userFacingErrorMessage(
          error,
          'プロジェクトを保存できませんでした。',
        ),
      })
    } finally {
      endBusy()
    }
  }, [
    beginBusy,
    endBusy,
    flushAutosave,
    flushPendingHistory,
    makeProject,
    waitForEditorOperations,
  ])

  const createNewDocument = async (event: FormEvent) => {
    event.preventDefault()
    const engine = engineRef.current
    if (!engine) return
    if (
      dirtyRef.current &&
      !window.confirm(
        '現在の未保存の編集を破棄して、新しいキャンバスを作成しますか？',
      )
    ) {
      return
    }
    const warnings: string[] = []
    beginBusy()
    try {
      await waitForEditorOperations()
      flushPendingHistory()
      try {
        await flushAutosave(engine.snapshot(), revisionRef.current)
      } catch (error) {
        warnings.push(
          userFacingErrorMessage(
            error,
            '現在の編集内容を切り替え前に自動保存できませんでした。',
          ),
        )
      }
      cancelPendingHistory()
      cancelPendingAutosave()
      autosaveGenerationRef.current += 1
      const generation = autosaveGenerationRef.current
      const width = Math.min(
        MAX_IMAGE_DIMENSION,
        Math.max(1, Math.round(newDocument.width)),
      )
      const height = Math.min(
        MAX_IMAGE_DIMENSION,
        Math.max(1, Math.round(newDocument.height)),
      )
      engine.clear(width, height)
      cancelPendingHistory()
      cancelPendingAutosave()
      const nextName = newDocument.name.trim() || '無題のデザイン'
      setProjectName(nextName)
      projectNameRef.current = nextName
      createdAtRef.current = new Date().toISOString()
      sourceNameRef.current = undefined
      saveHandleRef.current = null
      const snapshot = engine.snapshot()
      latestSnapshotRef.current = snapshot
      historyRef.current.reset(snapshot)
      refreshHistoryState()
      setHistoryLabels([
        {
          id: historyIdRef.current++,
          label: '新規ドキュメント',
          time: nowLabel(),
        },
      ])
      dirtyRef.current = false
      setDirty(false)
      setLayers([])
      setSelectedIds([])
      setDocumentSize({ width, height })
      setActiveDialog(null)
      setFilters(DEFAULT_FILTERS)
      try {
        await clearAutosaveForGeneration(generation)
      } catch (error) {
        warnings.push(
          userFacingErrorMessage(
            error,
            '以前の自動保存データを削除できませんでした。',
          ),
        )
      }
      fitCanvas()
      setStatus(
        warnings.length > 0
          ? {
              kind: 'warning',
              message: `新しいキャンバスを作成しました。${warnings.join(' ')}`,
            }
          : {
              kind: 'success',
              message: '新しいキャンバスを作成しました。',
            },
      )
    } catch (error) {
      setStatus({
        kind: 'error',
        message: userFacingErrorMessage(
          error,
          '新しいキャンバスを作成できませんでした。',
        ),
      })
    } finally {
      endBusy()
    }
  }

  const restoreRecovery = useCallback(async () => {
    const project = recoveryRef.current
    if (!project) return
    if (
      dirtyRef.current &&
      !window.confirm(
        '現在の未保存の編集を閉じて、前回の自動保存データを復元しますか？',
      )
    ) {
      return
    }
    try {
      await restoreSnapshot(projectToSnapshot(project))
      cancelPendingHistory()
      cancelPendingAutosave()
      autosaveGenerationRef.current += 1
      const generation = autosaveGenerationRef.current
      const snapshot = engineRef.current!.snapshot()
      latestSnapshotRef.current = snapshot
      revisionRef.current += 1
      historyRef.current.reset(snapshot)
      refreshHistoryState()
      setProjectName(project.metadata.name)
      projectNameRef.current = project.metadata.name
      createdAtRef.current = project.metadata.createdAt
      sourceNameRef.current = project.metadata.sourceFileName
      setRecoveryAvailable(false)
      dirtyRef.current = true
      setDirty(true)
      setHistoryLabels([
        {
          id: historyIdRef.current++,
          label: '自動保存を復元',
          time: nowLabel(),
        },
      ])
      setStatus({ kind: 'success', message: '前回の編集を復元しました。' })
      void enqueueAutosave(snapshot, generation).catch(() => undefined)
    } catch (error) {
      setStatus({
        kind: 'error',
        message: userFacingErrorMessage(
          error,
          '自動保存を復元できませんでした。',
        ),
      })
    }
  }, [
    cancelPendingAutosave,
    cancelPendingHistory,
    enqueueAutosave,
    refreshHistoryState,
    restoreSnapshot,
  ])

  const dismissRecovery = useCallback(() => {
    recoveryRef.current = null
    setRecoveryAvailable(false)
    cancelPendingAutosave()
    autosaveGenerationRef.current += 1
    const generation = autosaveGenerationRef.current
    const engine = engineRef.current
    if (dirtyRef.current && engine) {
      setAutosaveState('saving')
      void enqueueAutosave(engine.snapshot(), generation).catch(() => undefined)
    } else {
      void clearAutosaveForGeneration(generation).catch((error: unknown) => {
        setStatus({
          kind: 'warning',
          message: userFacingErrorMessage(
            error,
            '不要な自動保存データを削除できませんでした。',
          ),
        })
      })
    }
  }, [cancelPendingAutosave, clearAutosaveForGeneration, enqueueAutosave])

  const applyFilters = useCallback(
    (next: Required<ImageFilterSettings>) => {
      const current = filters
      setFilters(next)
      if (filterSelectionOnly && selectionMask) {
        return
      }
      const basicFilter = (
        [
          'brightness',
          'contrast',
          'saturation',
          'hue',
          'blur',
          'grayscale',
        ] as const
      ).find((filter) => current[filter] !== next[filter])
      if (!basicFilter || !automationDispatcherRef.current) {
        engineRef.current?.applyImageFilters(next)
        return
      }
      void dispatchAutomationCommand({
        type: 'applyFilter',
        filter: basicFilter,
        value: next[basicFilter],
        target: { kind: 'activeImage' },
      }).catch((error: unknown) => {
        setStatus({
          kind: 'error',
          message: userFacingErrorMessage(
            error,
            'フィルターを適用できませんでした。',
          ),
        })
      })
    },
    [dispatchAutomationCommand, filterSelectionOnly, filters, selectionMask],
  )

  const applyFiltersToSelection = useCallback((): void => {
    const mask = selectionMask
    if (!mask) {
      setStatus({
        kind: 'warning',
        message: '先に選択範囲を作成してください。',
      })
      return
    }
    runEditorOperation(async (engine) => {
      const controller = new AbortController()
      selectionFilterAbortRef.current = controller
      setSelectionFilterRunning(true)
      setSelectionFilterProgress({ progress: 0, stage: 'prepare' })
      try {
        const source = await engine.getDocumentImageData()
        if (source.width !== mask.width || source.height !== mask.height) {
          throw new RangeError(
            '選択範囲の寸法が現在のドキュメントと一致しません。',
          )
        }
        if (!selectionFilterClientRef.current) {
          const { SelectionFilterClient: SelectionFilterWorkerClient } =
            await import('./editor/filters/selectionFilterClient')
          selectionFilterClientRef.current = new SelectionFilterWorkerClient()
        }
        const result = await selectionFilterClientRef.current.run(
          {
            image: {
              width: source.width,
              height: source.height,
              data: source.data,
            },
            mask,
            settings: filters,
            outputMode: 'selection-overlay',
          },
          {
            signal: controller.signal,
            onProgress: setSelectionFilterProgress,
            transferOwnership: true,
          },
        )
        await engine.addImageDataLayer(
          {
            ...result,
            data: result.data as Uint8ClampedArray<ArrayBuffer>,
          },
          'Selection filter',
          'filter',
        )
        setStatus({
          kind: 'success',
          message: '選択範囲へフィルターを適用しました。',
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          setStatus({
            kind: 'info',
            message: '選択範囲フィルターをキャンセルしました。',
          })
          return
        }
        throw error
      } finally {
        if (selectionFilterAbortRef.current === controller) {
          selectionFilterAbortRef.current = null
        }
        setSelectionFilterRunning(false)
        setSelectionFilterProgress(undefined)
      }
    })
  }, [filters, runEditorOperation, selectionMask])

  const deleteActiveSelection = useCallback((): void => {
    const engine = engineRef.current
    if (!engine) return
    if (engine.getPixelSelectionMask()) {
      const layerId = engine.deleteSelectedPixels()
      setStatus(
        layerId
          ? {
              kind: 'success',
              message: '選択範囲のピクセルを削除しました。',
            }
          : {
              kind: 'warning',
              message: '削除できる選択ピクセルがありません。',
            },
      )
      return
    }
    engine.deleteSelection()
  }, [])

  const addShape = (kind: 'rect' | 'ellipse') => {
    const engine = engineRef.current
    if (!engine) return
    activateTool('select')
    if (kind === 'rect') engine.addRect({ fill: shapeColor })
    else engine.addEllipse({ fill: shapeColor })
  }

  const addText = () => {
    activateTool('select')
    void dispatchAutomationCommand({
      type: 'addText',
      text: 'テキスト',
      fill: shapeColor,
    }).catch((error: unknown) => {
      setStatus({
        kind: 'error',
        message: userFacingErrorMessage(
          error,
          'テキストを追加できませんでした。',
        ),
      })
    })
  }

  const exportImage = async (event: FormEvent) => {
    event.preventDefault()
    const engine = engineRef.current
    if (!engine) return
    beginBusy()
    try {
      await waitForEditorOperations()
      if (exportSettings.format === 'svg') {
        const source = await engine.exportSvg(exportSettings.svgScope)
        const { downloadText } = await import('./lib/files')
        downloadText(
          source,
          `${sanitizeFileStem(projectNameRef.current)}.svg`,
          'image/svg+xml',
        )
        setActiveDialog(null)
        setStatus({
          kind: 'success',
          message:
            'SVGを書き出しました。ラスターレイヤーは埋め込み画像として含まれます。',
        })
        return
      }
      const outputWidth = Math.round(
        documentSize.width * exportSettings.multiplier,
      )
      const outputHeight = Math.round(
        documentSize.height * exportSettings.multiplier,
      )
      if (
        outputWidth > MAX_IMAGE_DIMENSION ||
        outputHeight > MAX_IMAGE_DIMENSION ||
        outputWidth * outputHeight > MAX_IMAGE_PIXELS
      ) {
        throw new FileValidationError(
          '出力寸法が上限（各辺8,192 px、合計64 MP）を超えています。',
        )
      }
      const url = await engine.exportDataUrl(
        exportSettings.format,
        exportSettings.quality,
        exportSettings.multiplier,
      )
      const { downloadUrl } = await import('./lib/files')
      downloadUrl(
        url,
        `${sanitizeFileStem(projectNameRef.current)}.${exportSettings.format === 'jpeg' ? 'jpg' : exportSettings.format}`,
      )
      setActiveDialog(null)
    } catch (error) {
      setStatus({
        kind: 'error',
        message: userFacingErrorMessage(error, '画像を書き出せませんでした。'),
      })
    } finally {
      endBusy()
    }
  }

  const commitLayerRename = () => {
    if (renamingLayerId && renameValue.trim()) {
      engineRef.current?.renameLayer(renamingLayerId, renameValue)
    }
    setRenamingLayerId(null)
  }

  const onDrop = async (event: DragEvent) => {
    event.preventDefault()
    if (busyRef.current) return
    dragDepthRef.current = 0
    setDragActive(false)
    const file = event.dataTransfer.files[0]
    if (!file) return
    if (
      file.type === 'image/svg+xml' ||
      file.name.toLowerCase().endsWith('.svg')
    ) {
      await importSvg(file)
    } else if (file.type.startsWith('image/')) await importImage(file)
    else if (file.type === 'application/json' || file.name.endsWith('.json')) {
      await openProject(file)
    } else {
      setStatus({
        kind: 'error',
        message:
          'PNG、JPEG、WebP、SVGまたはPixelweaveプロジェクトを選択してください。',
      })
    }
  }

  useEffect(() => {
    const onPasteImage = (event: ClipboardEvent) => {
      if (busyRef.current) {
        event.preventDefault()
        return
      }
      if (isEditableTarget(event.target)) return
      const image = [...(event.clipboardData?.files ?? [])].find((file) =>
        file.type.startsWith('image/'),
      )
      const svgText =
        event.clipboardData?.getData('image/svg+xml') ||
        event.clipboardData?.getData('text/plain')
      event.preventDefault()
      if (image) {
        void (image.type === 'image/svg+xml'
          ? importSvg(image)
          : importImage(image))
      } else if (svgText?.trimStart().startsWith('<svg')) {
        void importSvg(
          new File([svgText], 'clipboard.svg', { type: 'image/svg+xml' }),
        )
      } else {
        runEditorOperation((engine) => engine.pasteSelection())
      }
    }
    window.addEventListener('paste', onPasteImage)
    return () => window.removeEventListener('paste', onPasteImage)
  }, [importImage, importSvg, runEditorOperation])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (activeDialog && event.key === 'Escape') {
        event.preventDefault()
        setActiveDialog(null)
        return
      }
      if (busyRef.current) return
      if (isEditableTarget(event.target) || activeDialog) return

      const modifier = (event.metaKey || event.ctrlKey) && !event.altKey
      const key = event.key.toLowerCase()
      if (modifier && key === 'z') {
        event.preventDefault()
        void (event.shiftKey ? redo() : undo())
      } else if (modifier && key === 'y') {
        event.preventDefault()
        void redo()
      } else if (modifier && key === 's') {
        event.preventDefault()
        void saveProject()
      } else if (modifier && key === 'o') {
        event.preventDefault()
        projectInputRef.current?.click()
      } else if (modifier && key === 'c') {
        event.preventDefault()
        runEditorOperation((engine) => engine.copySelection())
      } else if (modifier && key === 'x') {
        event.preventDefault()
        runEditorOperation((engine) => engine.cutSelection())
      } else if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      } else if (key === 'delete' || key === 'backspace') {
        event.preventDefault()
        deleteActiveSelection()
      } else if (!event.shiftKey && key === 'v') {
        activateTool('select')
      } else if (!event.shiftKey && key === 'b') {
        activateTool('brush')
      } else if (!event.shiftKey && key === 'e') {
        activateTool('eraser')
      } else if (!event.shiftKey && key === 'h') {
        activateTool('pan')
      } else if (key === '+' || key === '=') {
        engineRef.current?.zoomIn()
      } else if (key === '-') {
        engineRef.current?.zoomOut()
      } else if (key === '0') {
        engineRef.current?.zoom100()
      } else if (
        key === '?' ||
        (event.shiftKey && (event.code === 'Slash' || key === '/'))
      ) {
        setActiveDialog('shortcuts')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    activateTool,
    activeDialog,
    deleteActiveSelection,
    redo,
    runEditorOperation,
    saveProject,
    undo,
  ])

  const updateTransform = (
    field: keyof Omit<SelectionTransform, 'id'>,
    value: number | boolean,
  ) => {
    if (!selectionTransform) return
    engineRef.current?.updateSelectionTransform({ [field]: value })
    setSelectionTransform(engineRef.current?.getSelectionTransform() ?? null)
  }

  const applyUpdate = useCallback(async () => {
    const engine = engineRef.current
    if (!engine) return
    beginBusy()
    try {
      await waitForEditorOperations()
      let stableRevision = false
      for (let attempt = 0; attempt < 3; attempt += 1) {
        flushPendingHistory()
        const revision = revisionRef.current
        await flushAutosave(engine.snapshot(), revision)
        if (revision === revisionRef.current) {
          stableRevision = true
          break
        }
      }
      if (!stableRevision) {
        throw new Error(
          '更新処理中も編集内容が変化しました。操作を止めてから再試行してください。',
        )
      }
      updateInProgressRef.current = true
      const { applyServiceWorkerUpdate } = await import('./pwa')
      if (!applyServiceWorkerUpdate()) {
        updateInProgressRef.current = false
        endBusy()
        setStatus({
          kind: 'warning',
          message: '更新用Service Workerが見つかりませんでした。',
        })
        return
      }
      updateTimeoutRef.current = window.setTimeout(() => {
        updateTimeoutRef.current = null
        updateInProgressRef.current = false
        endBusy()
        setStatus({
          kind: 'warning',
          message:
            'アプリの更新を完了できませんでした。編集内容は保持されています。しばらくしてから再試行してください。',
        })
      }, SERVICE_WORKER_UPDATE_TIMEOUT)
    } catch (error) {
      updateInProgressRef.current = false
      if (updateTimeoutRef.current !== null) {
        window.clearTimeout(updateTimeoutRef.current)
        updateTimeoutRef.current = null
      }
      endBusy()
      setStatus({
        kind: 'error',
        message: userFacingErrorMessage(
          error,
          '更新前に編集内容を自動保存できませんでした。プロジェクトを手動保存してください。',
        ),
      })
    }
  }, [
    beginBusy,
    endBusy,
    flushAutosave,
    flushPendingHistory,
    waitForEditorOperations,
  ])

  const autosaveLabel =
    autosaveState === 'saving'
      ? '保存中…'
      : autosaveState === 'saved'
        ? '自動保存済み'
        : autosaveState === 'failed'
          ? '自動保存失敗'
          : 'ローカル編集'

  return (
    <div
      className="app-shell"
      inert={busy ? true : undefined}
      aria-busy={busy}
      onDragEnter={(event) => {
        event.preventDefault()
        dragDepthRef.current += 1
        setDragActive(true)
      }}
      onDragLeave={(event) => {
        event.preventDefault()
        dragDepthRef.current -= 1
        if (dragDepthRef.current <= 0) setDragActive(false)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            P
          </span>
          <div>
            <strong>Pixelweave</strong>
            <span>STUDIO</span>
          </div>
        </div>

        <div className="file-actions">
          <button
            className="topbar-button mobile-menu"
            type="button"
            aria-label="メニュー"
            aria-haspopup="dialog"
            onClick={() => setActiveDialog('menu')}
          >
            <Glyph>≡</Glyph>
          </button>
          <button
            className="topbar-button"
            type="button"
            onClick={() => setActiveDialog('new')}
          >
            <Plus aria-hidden="true" />
            新規
          </button>
          <button
            className="topbar-button"
            type="button"
            onClick={() => projectInputRef.current?.click()}
          >
            <Glyph>↑</Glyph>
            開く
          </button>
          <button
            className="topbar-button"
            type="button"
            onClick={() => void saveProject()}
          >
            <Save aria-hidden="true" />
            保存
          </button>
          <button
            className="topbar-button"
            type="button"
            onClick={() => setActiveDialog('studio')}
          >
            <Sparkles aria-hidden="true" />
            Studio
          </button>
          <button
            className="topbar-button accent"
            type="button"
            onClick={() => setActiveDialog('export')}
          >
            <Download aria-hidden="true" />
            書き出す
          </button>
        </div>

        <div className="document-title">
          <input
            aria-label="プロジェクト名"
            value={projectName}
            onChange={(event) => {
              const nextName = event.target.value
              setProjectName(nextName)
              projectNameRef.current = nextName
              revisionRef.current += 1
              dirtyRef.current = true
              setDirty(true)
              const snapshot = latestSnapshotRef.current
              if (snapshot) scheduleAutosave(snapshot)
            }}
          />
          <span>{dirty ? '未保存の変更' : '保存済み'}</span>
        </div>

        <div className="topbar-meta">
          <span
            className={`save-state ${autosaveState}`}
            title="編集内容は端末内にのみ自動保存されます"
          >
            {autosaveState === 'failed' ? <Glyph>☁×</Glyph> : <Glyph>☁</Glyph>}
            <span>{autosaveLabel}</span>
          </span>
          <button
            className="icon-button"
            type="button"
            aria-label="ショートカット一覧"
            onClick={() => setActiveDialog('shortcuts')}
          >
            <Glyph>?</Glyph>
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="tool-rail" aria-label="編集ツール">
          <div className="tool-group" role="toolbar" aria-label="基本ツール">
            {TOOL_ITEMS.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  className={`tool-button ${tool === item.id ? 'active' : ''}`}
                  type="button"
                  aria-label={`${item.label} (${item.shortcut})`}
                  aria-pressed={tool === item.id}
                  title={`${item.label} · ${item.shortcut}`}
                  onClick={() => activateTool(item.id)}
                >
                  <Icon aria-hidden="true" />
                  <span>{item.shortcut}</span>
                </button>
              )
            })}
          </div>
          <div className="tool-divider" />
          <div className="tool-group" role="toolbar" aria-label="追加ツール">
            <button
              className="tool-button"
              type="button"
              aria-label="画像を追加"
              title="画像を追加"
              onClick={() => imageInputRef.current?.click()}
            >
              <Glyph>＋</Glyph>
            </button>
            <button
              className="tool-button"
              type="button"
              aria-label="矩形を追加"
              title="矩形"
              onClick={() => addShape('rect')}
            >
              <Glyph>■</Glyph>
            </button>
            <button
              className="tool-button"
              type="button"
              aria-label="楕円を追加"
              title="楕円"
              onClick={() => addShape('ellipse')}
            >
              <Glyph>●</Glyph>
            </button>
            <button
              className="tool-button"
              type="button"
              aria-label="テキストを追加"
              title="テキスト"
              onClick={addText}
            >
              <Type aria-hidden="true" />
            </button>
            <button
              className="tool-button"
              type="button"
              aria-label="選択範囲へ切り抜く"
              title="選択オブジェクトの範囲へ切り抜く"
              onClick={() => {
                if (engineRef.current?.cropToSelection()) {
                  refreshEditorState()
                  fitCanvas()
                }
              }}
            >
              <Glyph>⌗</Glyph>
            </button>
          </div>
          <div className="rail-spacer" />
          <label className="color-well" title="描画色">
            <span className="sr-only">描画色</span>
            <input
              type="color"
              value={
                tool === 'brush' || tool === 'eraser' ? brushColor : shapeColor
              }
              onChange={(event) => {
                if (tool === 'brush' || tool === 'eraser') {
                  setBrushColor(event.target.value)
                } else {
                  setShapeColor(event.target.value)
                }
              }}
            />
          </label>
        </aside>

        <main className="editor-main">
          <section className="context-bar" aria-label="ツールオプション">
            <div className="history-controls">
              <button
                className="icon-button"
                type="button"
                disabled={!historyState.canUndo}
                onClick={() => void undo()}
                aria-label="元に戻す"
                title="元に戻す"
              >
                <Undo2 aria-hidden="true" />
              </button>
              <button
                className="icon-button"
                type="button"
                disabled={!historyState.canRedo}
                onClick={() => void redo()}
                aria-label="やり直す"
                title="やり直す"
              >
                <Redo2 aria-hidden="true" />
              </button>
            </div>

            {(tool === 'brush' || tool === 'eraser') && (
              <div className="brush-options">
                <label className="inline-field">
                  <span>サイズ</span>
                  <input
                    type="range"
                    min="1"
                    max="160"
                    value={brushSize}
                    onChange={(event) =>
                      setBrushSize(Number(event.target.value))
                    }
                  />
                  <output>{brushSize}px</output>
                </label>
                <label className="inline-field opacity-option">
                  <span>不透明度</span>
                  <input
                    type="range"
                    min="0.05"
                    max="1"
                    step="0.05"
                    value={brushOpacity}
                    onChange={(event) =>
                      setBrushOpacity(Number(event.target.value))
                    }
                  />
                  <output>{Math.round(brushOpacity * 100)}%</output>
                </label>
              </div>
            )}

            {tool === 'select' && selectionTransform ? (
              <div className="transform-options">
                {(
                  [
                    ['X', 'left'],
                    ['Y', 'top'],
                    ['W', 'width'],
                    ['H', 'height'],
                    ['角度', 'angle'],
                  ] as const
                ).map(([label, field]) => (
                  <label className="compact-number" key={field}>
                    <span>{label}</span>
                    <input
                      type="number"
                      min={
                        field === 'width' || field === 'height' ? 1 : undefined
                      }
                      value={Math.round(selectionTransform[field] * 10) / 10}
                      onChange={(event) =>
                        updateTransform(field, Number(event.target.value))
                      }
                    />
                  </label>
                ))}
                <button
                  className={`icon-button ${selectionTransform.flipX ? 'active' : ''}`}
                  type="button"
                  aria-label="左右反転"
                  aria-pressed={selectionTransform.flipX}
                  onClick={() =>
                    updateTransform('flipX', !selectionTransform.flipX)
                  }
                >
                  <Glyph>↔</Glyph>
                </button>
                <button
                  className={`icon-button ${selectionTransform.flipY ? 'active' : ''}`}
                  type="button"
                  aria-label="上下反転"
                  aria-pressed={selectionTransform.flipY}
                  onClick={() =>
                    updateTransform('flipY', !selectionTransform.flipY)
                  }
                >
                  <Glyph>↕</Glyph>
                </button>
              </div>
            ) : null}

            {tool === 'select' && selectedIds.length > 0 ? (
              <div
                className="alignment-options"
                role="toolbar"
                aria-label="整列と分布"
              >
                {(
                  [
                    ['left', '左揃え'],
                    ['center-x', '左右中央'],
                    ['right', '右揃え'],
                    ['top', '上揃え'],
                    ['center-y', '上下中央'],
                    ['bottom', '下揃え'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    title={label}
                    aria-label={label}
                    onClick={() =>
                      engineRef.current?.alignSelection(
                        mode,
                        selectedIds.length === 1 ? 'canvas' : 'selection',
                      )
                    }
                  >
                    {label.slice(0, 1)}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={selectedIds.length < 3}
                  onClick={() =>
                    engineRef.current?.alignSelection('distribute-x')
                  }
                >
                  横分布
                </button>
                <button
                  type="button"
                  disabled={selectedIds.length < 3}
                  onClick={() =>
                    engineRef.current?.alignSelection('distribute-y')
                  }
                >
                  縦分布
                </button>
              </div>
            ) : null}

            <div className="zoom-controls">
              <button
                className="icon-button"
                type="button"
                onClick={() => engineRef.current?.zoomOut()}
                aria-label="縮小"
              >
                <ZoomOut aria-hidden="true" />
              </button>
              <button
                className="zoom-value"
                type="button"
                onClick={() => engineRef.current?.zoom100()}
                title="100%表示"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={() => engineRef.current?.zoomIn()}
                aria-label="拡大"
              >
                <ZoomIn aria-hidden="true" />
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={fitCanvas}
                aria-label="画面に合わせる"
              >
                <Maximize2 aria-hidden="true" />
              </button>
            </div>
          </section>

          {recoveryAvailable ? (
            <section className="recovery-banner" aria-label="復元候補">
              <HistoryIcon aria-hidden="true" />
              <div>
                <strong>前回の編集が見つかりました</strong>
                <span>端末内の自動保存から復元できます。</span>
              </div>
              <button type="button" onClick={() => void restoreRecovery()}>
                復元する
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={dismissRecovery}
                aria-label="復元候補を破棄"
              >
                <X aria-hidden="true" />
              </button>
            </section>
          ) : null}

          <section className="canvas-area" aria-label="画像編集キャンバス">
            <div className="canvas-rulers">
              <span>{documentSize.width} px</span>
              <span>{documentSize.height} px</span>
              <button
                type="button"
                draggable
                title="キャンバスへドラッグして配置"
                onClick={() =>
                  engineRef.current?.addGuide('x', documentSize.width / 2)
                }
                onDragEnd={(event) =>
                  engineRef.current?.addGuideFromPointer('x', event.nativeEvent)
                }
              >
                縦ガイド
              </button>
              <button
                type="button"
                draggable
                title="キャンバスへドラッグして配置"
                onClick={() =>
                  engineRef.current?.addGuide('y', documentSize.height / 2)
                }
                onDragEnd={(event) =>
                  engineRef.current?.addGuideFromPointer('y', event.nativeEvent)
                }
              >
                横ガイド
              </button>
              <button
                type="button"
                onClick={() => engineRef.current?.clearGuides()}
              >
                ガイド消去
              </button>
              <label>
                スナップ
                <input
                  type="number"
                  min="1"
                  max="100"
                  defaultValue="8"
                  aria-label="スナップ許容距離"
                  onChange={(event) =>
                    engineRef.current?.setSnapTolerance(
                      Number(event.target.value),
                    )
                  }
                />
                px
              </label>
            </div>
            <div className="canvas-viewport" ref={canvasViewportRef}>
              <canvas
                ref={canvasElementRef}
                aria-label={`${projectName}の編集キャンバス。レイヤーパネルと数値入力で代替操作できます。`}
              />
              {layers.length === 0 && !busy ? (
                <div className="empty-state">
                  <span className="empty-icon">
                    <Sparkles aria-hidden="true" />
                  </span>
                  <p className="eyebrow">YOUR CANVAS IS READY</p>
                  <h1>画像を開いて、つくり始める</h1>
                  <p>
                    ファイルは端末内で処理されます。
                    <br />
                    ここへドロップするか、画像を選択してください。
                  </p>
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                  >
                    <Glyph>＋</Glyph>
                    画像を選択
                  </button>
                  <div className="format-chips" aria-label="対応形式">
                    <span>PNG</span>
                    <span>JPEG</span>
                    <span>WEBP</span>
                    <span>SVG</span>
                    <span>最大 64 MP</span>
                  </div>
                </div>
              ) : null}
              {busy ? (
                <div className="busy-overlay" role="status">
                  <span className="spinner" />
                  処理しています…
                </div>
              ) : null}
            </div>
          </section>

          <footer className="statusbar">
            <span className={`status-dot ${status.kind}`} aria-hidden="true" />
            <span role="status" aria-live="polite">
              {status.message}
            </span>
            <span className="status-spacer" />
            <span>sRGB · 8 bit</span>
            <span>
              {documentSize.width} × {documentSize.height}px
            </span>
            <span>{layers.length} レイヤー</span>
          </footer>
        </main>

        <aside
          className={`inspector ${inspectorOpen ? 'open' : 'closed'}`}
          aria-label="インスペクター"
        >
          <div className="inspector-tabs">
            <div className="inspector-tab-list" role="tablist">
              {(
                [
                  ['layers', 'レイヤー', Layers3],
                  ['adjustments', '調整', SlidersHorizontal],
                  ['history', '履歴', HistoryIcon],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={inspectorTab === id}
                  className={inspectorTab === id ? 'active' : ''}
                  onClick={() => {
                    setInspectorTab(id)
                    setInspectorOpen(true)
                  }}
                >
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <button
              className="panel-toggle"
              type="button"
              onClick={() => setInspectorOpen((value) => !value)}
              aria-label={inspectorOpen ? 'インスペクターを閉じる' : '開く'}
            >
              {inspectorOpen ? <Glyph>▶</Glyph> : <Glyph>◀</Glyph>}
            </button>
          </div>

          {inspectorOpen && inspectorTab === 'layers' ? (
            <div className="inspector-content">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">COMPOSITION</p>
                  <h2>レイヤー</h2>
                </div>
                <span>{layers.length}</span>
              </div>

              {selectedLayer ? (
                <div className="layer-properties">
                  <label>
                    <span>
                      <Glyph>◐</Glyph>
                      ブレンド
                    </span>
                    <select
                      value={selectedLayer.blend}
                      onChange={(event) =>
                        engineRef.current?.setLayerBlend(
                          selectedLayer.id,
                          event.target.value as GlobalCompositeOperation,
                        )
                      }
                    >
                      {BLEND_MODES.map((mode) => (
                        <option key={mode.value} value={mode.value}>
                          {mode.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="opacity-control">
                    <span>
                      不透明度
                      <output>
                        {Math.round(selectedLayer.opacity * 100)}%
                      </output>
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={selectedLayer.opacity}
                      onChange={(event) =>
                        engineRef.current?.setLayerOpacity(
                          selectedLayer.id,
                          Number(event.target.value),
                        )
                      }
                    />
                  </label>
                  {selectedTextStyle ? (
                    <fieldset className="text-decoration-controls">
                      <legend>テキスト装飾</legend>
                      <label>
                        <span>縁取り色</span>
                        <input
                          type="color"
                          value={
                            selectedTextStyle.stroke === 'transparent'
                              ? '#ffffff'
                              : selectedTextStyle.stroke
                          }
                          onChange={(event) =>
                            engineRef.current?.setSelectedTextStyle({
                              stroke: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        <span>縁取り幅</span>
                        <input
                          type="number"
                          min="0"
                          max="64"
                          value={selectedTextStyle.strokeWidth}
                          onChange={(event) =>
                            engineRef.current?.setSelectedTextStyle({
                              strokeWidth: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        <span>字間</span>
                        <input
                          type="number"
                          min="-500"
                          max="2000"
                          value={selectedTextStyle.charSpacing}
                          onChange={(event) =>
                            engineRef.current?.setSelectedTextStyle({
                              charSpacing: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        <span>行間</span>
                        <input
                          type="number"
                          min="0.5"
                          max="5"
                          step="0.05"
                          value={selectedTextStyle.lineHeight}
                          onChange={(event) =>
                            engineRef.current?.setSelectedTextStyle({
                              lineHeight: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label className="toggle-row compact">
                        <span>グラデーション</span>
                        <input
                          type="checkbox"
                          checked={selectedTextStyle.gradient !== null}
                          onChange={(event) =>
                            engineRef.current?.setSelectedTextStyle({
                              gradient: event.target.checked
                                ? {
                                    start: '#7c3aed',
                                    end: '#22d3ee',
                                    angle: 0,
                                  }
                                : null,
                              fill: selectedTextStyle.fill,
                            })
                          }
                        />
                      </label>
                      {selectedTextStyle.gradient ? (
                        <div className="color-pair">
                          <input
                            type="color"
                            aria-label="グラデーション開始色"
                            value={selectedTextStyle.gradient.start}
                            onChange={(event) =>
                              engineRef.current?.setSelectedTextStyle({
                                gradient: {
                                  ...selectedTextStyle.gradient!,
                                  start: event.target.value,
                                },
                              })
                            }
                          />
                          <input
                            type="color"
                            aria-label="グラデーション終了色"
                            value={selectedTextStyle.gradient.end}
                            onChange={(event) =>
                              engineRef.current?.setSelectedTextStyle({
                                gradient: {
                                  ...selectedTextStyle.gradient!,
                                  end: event.target.value,
                                },
                              })
                            }
                          />
                        </div>
                      ) : null}
                      <label className="toggle-row compact">
                        <span>シャドウ</span>
                        <input
                          type="checkbox"
                          checked={selectedTextStyle.shadow !== null}
                          onChange={(event) =>
                            engineRef.current?.setSelectedTextStyle({
                              shadow: event.target.checked
                                ? {
                                    color: 'rgba(0,0,0,0.45)',
                                    blur: 12,
                                    offsetX: 4,
                                    offsetY: 6,
                                  }
                                : null,
                            })
                          }
                        />
                      </label>
                      <div className="arc-control">
                        <label>
                          <span>円弧半径</span>
                          <input
                            key={selectedLayer.id}
                            type="number"
                            min="24"
                            max="4096"
                            defaultValue="120"
                            id={`arc-radius-${selectedLayer.id}`}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            const input = document.getElementById(
                              `arc-radius-${selectedLayer.id}`,
                            ) as HTMLInputElement | null
                            engineRef.current?.setSelectedTextArc(
                              Number(input?.value ?? 120),
                            )
                          }}
                        >
                          円弧へ配置
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            engineRef.current?.setSelectedTextArc(null)
                          }
                        >
                          解除
                        </button>
                      </div>
                    </fieldset>
                  ) : null}
                  {selectedLayer.type === 'adjustment' ? (
                    <button
                      className="secondary-button full-width"
                      type="button"
                      onClick={() =>
                        runEditorOperation(async (engine) =>
                          engine.getAdvancedAdjustmentLayerOperations(
                            selectedLayer.id,
                          )
                            ? engine.rasterizeAdvancedAdjustmentLayer(
                                selectedLayer.id,
                              )
                            : engine.rasterizeAdjustmentLayer(selectedLayer.id),
                        )
                      }
                    >
                      調整レイヤーをラスタライズ
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="muted-callout">
                  レイヤーを選択すると設定を変更できます。
                </p>
              )}

              <div className="layer-list" role="list" aria-label="レイヤー">
                {layers.map((layer) => (
                  <div
                    className={`layer-row ${layer.selected ? 'selected' : ''} ${!layer.visible ? 'hidden' : ''}`}
                    key={layer.id}
                    role="listitem"
                  >
                    <button
                      className="layer-icon-button"
                      type="button"
                      aria-label={layer.visible ? 'レイヤーを隠す' : '表示する'}
                      onClick={(event) => {
                        event.stopPropagation()
                        engineRef.current?.setLayerVisible(
                          layer.id,
                          !layer.visible,
                        )
                      }}
                    >
                      {layer.visible ? (
                        <Eye aria-hidden="true" />
                      ) : (
                        <EyeOff aria-hidden="true" />
                      )}
                    </button>
                    {renamingLayerId === layer.id ? (
                      <div className="layer-select-area">
                        <span className="layer-thumbnail">
                          {layerIcon(layer.type)}
                        </span>
                        <input
                          className="layer-rename-input"
                          autoFocus
                          value={renameValue}
                          aria-label="レイヤー名"
                          onChange={(event) =>
                            setRenameValue(event.target.value)
                          }
                          onBlur={commitLayerRename}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') commitLayerRename()
                            if (event.key === 'Escape') setRenamingLayerId(null)
                          }}
                          onClick={(event) => event.stopPropagation()}
                        />
                      </div>
                    ) : (
                      <button
                        className="layer-select-area"
                        type="button"
                        aria-label={`レイヤー「${layer.name}」を選択`}
                        aria-pressed={layer.selected}
                        onClick={(event) =>
                          engineRef.current?.selectLayer(
                            layer.id,
                            event.metaKey || event.ctrlKey || event.shiftKey,
                          )
                        }
                        onDoubleClick={(event) => {
                          event.stopPropagation()
                          setRenamingLayerId(layer.id)
                          setRenameValue(layer.name)
                        }}
                      >
                        <span className="layer-thumbnail">
                          {layerIcon(layer.type)}
                        </span>
                        <span className="layer-name">
                          <>
                            <strong>{layer.name}</strong>
                            <span>{layer.type}</span>
                          </>
                        </span>
                      </button>
                    )}
                    <button
                      className="layer-icon-button"
                      type="button"
                      aria-label={layer.locked ? 'ロックを解除' : 'ロック'}
                      onClick={(event) => {
                        event.stopPropagation()
                        engineRef.current?.setLayerLocked(
                          layer.id,
                          !layer.locked,
                        )
                      }}
                    >
                      {layer.locked ? <Glyph>⌑</Glyph> : <Glyph>⌐</Glyph>}
                    </button>
                  </div>
                ))}
              </div>
              {layers.length === 0 ? (
                <div className="panel-empty">
                  <Layers3 aria-hidden="true" />
                  <p>レイヤーはまだありません</p>
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                  >
                    画像を追加
                  </button>
                </div>
              ) : null}

              <div
                className="layer-actions"
                role="toolbar"
                aria-label="レイヤー操作"
              >
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  aria-label="画像レイヤーを追加"
                  title="画像レイヤーを追加"
                >
                  <Plus aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled={!selectedLayer}
                  onClick={() =>
                    runEditorOperation((engine) => engine.duplicateSelection())
                  }
                  aria-label="複製"
                  title="複製"
                >
                  <Copy aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled={!selectedLayer}
                  onClick={() =>
                    selectedLayer &&
                    engineRef.current?.moveLayerForward(selectedLayer.id)
                  }
                  aria-label="前面へ"
                  title="前面へ"
                >
                  <ArrowUp aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled={!selectedLayer}
                  onClick={() =>
                    selectedLayer &&
                    engineRef.current?.moveLayerBackward(selectedLayer.id)
                  }
                  aria-label="背面へ"
                  title="背面へ"
                >
                  <ArrowDown aria-hidden="true" />
                </button>
                <span />
                <button
                  className="danger"
                  type="button"
                  disabled={!selectedLayer && !selectionMask}
                  onClick={deleteActiveSelection}
                  aria-label={
                    selectionMask ? '選択ピクセルを削除' : 'レイヤーを削除'
                  }
                  title={
                    selectionMask ? '選択ピクセルを削除' : 'レイヤーを削除'
                  }
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : null}

          {inspectorOpen && inspectorTab === 'adjustments' ? (
            <div className="inspector-content">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">NON-DESTRUCTIVE PREVIEW</p>
                  <h2>画像調整</h2>
                </div>
                <Sparkles aria-hidden="true" />
              </div>
              <p className="panel-intro">
                画像レイヤーを1つ選択して、見た目を調整します。値はプロジェクトへ保存されます。
              </p>
              {selectionMask ? (
                <label className="toggle-row selection-filter-toggle">
                  <span>
                    <span className="toggle-icon">
                      <MousePointer2 aria-hidden="true" />
                    </span>
                    <span>
                      <strong>選択範囲だけに適用</strong>
                      <small>Studio で作成した8bitマスクとフェザーを反映</small>
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={filterSelectionOnly}
                    onChange={(event) =>
                      setFilterSelectionOnly(event.target.checked)
                    }
                  />
                </label>
              ) : (
                <p className="selection-filter-hint">
                  部分適用するには、Studio
                  の「選択・背景・スクリプト」で選択範囲を作成します。
                </p>
              )}
              <div className="adjustments">
                <AdjustmentSlider
                  label="明るさ"
                  value={filters.brightness}
                  onChange={(value) =>
                    applyFilters({ ...filters, brightness: value })
                  }
                />
                <AdjustmentSlider
                  label="コントラスト"
                  value={filters.contrast}
                  onChange={(value) =>
                    applyFilters({ ...filters, contrast: value })
                  }
                />
                <AdjustmentSlider
                  label="彩度"
                  value={filters.saturation}
                  onChange={(value) =>
                    applyFilters({ ...filters, saturation: value })
                  }
                />
                <AdjustmentSlider
                  label="色相"
                  value={filters.hue}
                  onChange={(value) => applyFilters({ ...filters, hue: value })}
                />
                <AdjustmentSlider
                  label="ぼかし"
                  value={filters.blur}
                  min={0}
                  onChange={(value) =>
                    applyFilters({ ...filters, blur: value })
                  }
                />
                <label className="toggle-row">
                  <span>
                    <span className="toggle-icon">
                      <Glyph>▣</Glyph>
                    </span>
                    <span>
                      <strong>グレースケール</strong>
                      <small>輝度を保って白黒へ変換</small>
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={filters.grayscale}
                    onChange={(event) =>
                      applyFilters({
                        ...filters,
                        grayscale: event.target.checked,
                      })
                    }
                  />
                </label>
                <AdjustmentSlider
                  label="シャープ"
                  value={filters.sharpen}
                  min={0}
                  max={2}
                  onChange={(value) =>
                    applyFilters({ ...filters, sharpen: value })
                  }
                />
                <AdjustmentSlider
                  label="エンボス"
                  value={filters.emboss}
                  min={0}
                  max={2}
                  onChange={(value) =>
                    applyFilters({ ...filters, emboss: value })
                  }
                />
                <AdjustmentSlider
                  label="ノイズ"
                  value={filters.noise}
                  min={0}
                  onChange={(value) =>
                    applyFilters({ ...filters, noise: value })
                  }
                />
                <label className="adjustment-control">
                  <span>
                    ピクセレート
                    <output>{filters.pixelate}px</output>
                  </span>
                  <input
                    type="range"
                    min="1"
                    max="64"
                    step="1"
                    value={filters.pixelate}
                    onChange={(event) =>
                      applyFilters({
                        ...filters,
                        pixelate: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <div className="filter-toggle-grid">
                  <label className="toggle-row compact">
                    <span>セピア</span>
                    <input
                      type="checkbox"
                      checked={filters.sepia > 0}
                      onChange={(event) =>
                        applyFilters({
                          ...filters,
                          sepia: event.target.checked ? 1 : 0,
                        })
                      }
                    />
                  </label>
                  <label className="toggle-row compact">
                    <span>色反転</span>
                    <input
                      type="checkbox"
                      checked={filters.invert > 0}
                      onChange={(event) =>
                        applyFilters({
                          ...filters,
                          invert: event.target.checked ? 1 : 0,
                        })
                      }
                    />
                  </label>
                </div>
                <AdjustmentSlider
                  label="ガンマ"
                  value={filters.gamma}
                  min={0.1}
                  max={2.2}
                  onChange={(value) =>
                    applyFilters({ ...filters, gamma: value })
                  }
                />
                <AdjustmentSlider
                  label="色温度"
                  value={filters.temperature}
                  onChange={(value) =>
                    applyFilters({ ...filters, temperature: value })
                  }
                />
                <AdjustmentSlider
                  label="色かぶり補正"
                  value={filters.tint}
                  onChange={(value) =>
                    applyFilters({ ...filters, tint: value })
                  }
                />
                <AdjustmentSlider
                  label="ビネット"
                  value={filters.vignette}
                  min={0}
                  onChange={(value) =>
                    applyFilters({ ...filters, vignette: value })
                  }
                />
                <AdjustmentSlider
                  label="デュオトーン"
                  value={filters.duotone}
                  min={0}
                  onChange={(value) =>
                    applyFilters({ ...filters, duotone: value })
                  }
                />
                <AdjustmentSlider
                  label="ハーフトーン"
                  value={filters.halftone}
                  min={0}
                  onChange={(value) =>
                    applyFilters({ ...filters, halftone: value })
                  }
                />
                <AdjustmentSlider
                  label="グリッチ"
                  value={filters.glitch}
                  min={0}
                  onChange={(value) =>
                    applyFilters({ ...filters, glitch: value })
                  }
                />
                <button
                  className="secondary-button full-width"
                  type="button"
                  disabled={filterSelectionOnly}
                  onClick={() =>
                    runEditorOperation((engine) =>
                      engine.addAdjustmentLayer(filters),
                    )
                  }
                >
                  <Layers3 aria-hidden="true" />
                  現在の設定で調整レイヤーを追加
                </button>
                {filterSelectionOnly && selectionMask ? (
                  <div className="selection-filter-actions">
                    <button
                      className="primary-button full-width"
                      type="button"
                      disabled={selectionFilterRunning}
                      onClick={applyFiltersToSelection}
                    >
                      <Sparkles aria-hidden="true" />
                      選択範囲へフィルターを適用
                    </button>
                    {selectionFilterRunning ? (
                      <>
                        <progress
                          max="1"
                          value={selectionFilterProgress?.progress ?? 0}
                          aria-label="選択範囲フィルターの進捗"
                        />
                        <button
                          className="secondary-button full-width"
                          type="button"
                          onClick={() =>
                            selectionFilterAbortRef.current?.abort()
                          }
                        >
                          キャンセル
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
                <button
                  className="secondary-button full-width"
                  type="button"
                  onClick={() => applyFilters(DEFAULT_FILTERS)}
                >
                  <Glyph>↻</Glyph>
                  調整をリセット
                </button>
              </div>
            </div>
          ) : null}

          {inspectorOpen && inspectorTab === 'history' ? (
            <div className="inspector-content">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">SESSION</p>
                  <h2>履歴</h2>
                </div>
                <span>{historyState.size}/100</span>
              </div>
              <p className="panel-intro">
                直近100件まで端末内に保持します。ズームとパンは履歴へ含めません。
              </p>
              <ol className="history-list">
                {[...historyLabels].reverse().map((entry, index) => (
                  <li key={entry.id} className={index === 0 ? 'current' : ''}>
                    <span className="history-marker">
                      {index === 0 ? <Glyph>✓</Glyph> : null}
                    </span>
                    <span>
                      <strong>{entry.label}</strong>
                      <small>{entry.time}</small>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="history-footer">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!historyState.canUndo}
                  onClick={() => void undo()}
                >
                  <Undo2 aria-hidden="true" />
                  戻す
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!historyState.canRedo}
                  onClick={() => void redo()}
                >
                  <Redo2 aria-hidden="true" />
                  やり直す
                </button>
              </div>
            </div>
          ) : null}
        </aside>
      </div>

      <input
        ref={imageInputRef}
        className="visually-hidden-input"
        aria-label="画像ファイルを選択"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
        onChange={(event) => void onImageInput(event)}
      />
      <input
        ref={projectInputRef}
        className="visually-hidden-input"
        aria-label="プロジェクトファイルを選択"
        type="file"
        accept=".pwx.json,.json,application/json"
        onChange={(event) => void onProjectInput(event)}
      />

      {dragActive ? (
        <div className="drop-overlay" role="status">
          <span>
            <Glyph>＋</Glyph>
          </span>
          <strong>ここにドロップして開く</strong>
          <p>PNG・JPEG・WebP・SVG・Pixelweave project</p>
        </div>
      ) : null}

      {updateAvailable ? (
        <div className="toast update-toast" role="status">
          <div>
            <strong>新しいバージョンがあります</strong>
            <span>保存してから更新してください。</span>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void applyUpdate()}
          >
            更新
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="後で更新"
            onClick={() => setUpdateDismissed(true)}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {activeDialog === 'menu' ? (
        <Modal
          title="ファイルメニュー"
          description="プロジェクトの作成、読み込み、保存、画像の書き出しを行います。"
          onClose={() => setActiveDialog(null)}
        >
          <div className="modal-form">
            <button
              className="secondary-button full-width"
              type="button"
              onClick={() => setActiveDialog('new')}
            >
              <Plus aria-hidden="true" />
              新しいキャンバス
            </button>
            <button
              className="secondary-button full-width"
              type="button"
              onClick={() => {
                setActiveDialog(null)
                projectInputRef.current?.click()
              }}
            >
              <Glyph>↑</Glyph>
              プロジェクトを開く
            </button>
            <button
              className="secondary-button full-width"
              type="button"
              onClick={() => {
                setActiveDialog(null)
                void saveProject()
              }}
            >
              <Save aria-hidden="true" />
              プロジェクトを保存
            </button>
            <button
              className="primary-button full-width"
              type="button"
              onClick={() => setActiveDialog('export')}
            >
              <Download aria-hidden="true" />
              画像を書き出す
            </button>
            <button
              className="secondary-button full-width"
              type="button"
              onClick={() => setActiveDialog('studio')}
            >
              <Sparkles aria-hidden="true" />
              拡張ツールを開く
            </button>
          </div>
        </Modal>
      ) : null}

      {activeDialog === 'new' ? (
        <Modal
          title="新しいキャンバス"
          description="未保存の編集がある場合は確認してから切り替えます。新しいキャンバスのサイズを指定してください。"
          onClose={() => setActiveDialog(null)}
        >
          <form
            className="modal-form"
            onSubmit={(event) => void createNewDocument(event)}
          >
            <label>
              <span>プロジェクト名</span>
              <input
                autoFocus
                value={newDocument.name}
                onChange={(event) =>
                  setNewDocument((value) => ({
                    ...value,
                    name: event.target.value,
                  }))
                }
              />
            </label>
            <div className="form-grid">
              <label>
                <span>幅 (px)</span>
                <input
                  type="number"
                  required
                  min="1"
                  max={MAX_IMAGE_DIMENSION}
                  value={newDocument.width}
                  onChange={(event) =>
                    setNewDocument((value) => ({
                      ...value,
                      width: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label>
                <span>高さ (px)</span>
                <input
                  type="number"
                  required
                  min="1"
                  max={MAX_IMAGE_DIMENSION}
                  value={newDocument.height}
                  onChange={(event) =>
                    setNewDocument((value) => ({
                      ...value,
                      height: Number(event.target.value),
                    }))
                  }
                />
              </label>
            </div>
            <div className="preset-row">
              <span>プリセット</span>
              {[
                ['HD', 1280, 720],
                ['Full HD', 1920, 1080],
                ['Square', 1080, 1080],
                ['A4', 2480, 3508],
              ].map(([label, width, height]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() =>
                    setNewDocument((value) => ({
                      ...value,
                      width: Number(width),
                      height: Number(height),
                    }))
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setActiveDialog(null)}
              >
                キャンセル
              </button>
              <button className="primary-button" type="submit">
                <Plus aria-hidden="true" />
                作成
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {activeDialog === 'export' ? (
        <Modal
          title="画像を書き出す"
          description="すべての表示レイヤーを合成して、端末へ保存します。"
          onClose={() => setActiveDialog(null)}
        >
          <form className="modal-form" onSubmit={exportImage}>
            <fieldset className="format-options">
              <legend>ファイル形式</legend>
              {(['png', 'jpeg', 'webp', 'svg'] as const).map((format) => (
                <label
                  key={format}
                  className={exportSettings.format === format ? 'selected' : ''}
                >
                  <input
                    type="radio"
                    name="format"
                    value={format}
                    checked={exportSettings.format === format}
                    onChange={() =>
                      setExportSettings((value) => ({ ...value, format }))
                    }
                  />
                  <span>
                    {format === 'jpeg' ? 'JPG' : format.toUpperCase()}
                  </span>
                  <small>
                    {format === 'png'
                      ? '透明度・高品質'
                      : format === 'jpeg'
                        ? '写真・小容量'
                        : format === 'webp'
                          ? '高圧縮・透明度'
                          : '編集可能なベクター'}
                  </small>
                </label>
              ))}
            </fieldset>
            <label className="adjustment-control">
              <span>
                品質
                <output>{Math.round(exportSettings.quality * 100)}%</output>
              </span>
              <input
                type="range"
                aria-label="品質"
                min="0.1"
                max="1"
                step="0.01"
                disabled={
                  exportSettings.format === 'png' ||
                  exportSettings.format === 'svg'
                }
                value={exportSettings.quality}
                onChange={(event) =>
                  setExportSettings((value) => ({
                    ...value,
                    quality: Number(event.target.value),
                  }))
                }
              />
            </label>
            {exportSettings.format === 'svg' ? (
              <>
                <label>
                  <span>SVGの範囲</span>
                  <select
                    value={exportSettings.svgScope}
                    onChange={(event) =>
                      setExportSettings((value) => ({
                        ...value,
                        svgScope: event.target.value as
                          'document' | 'selection',
                      }))
                    }
                  >
                    <option value="document">キャンバス全体</option>
                    <option value="selection">選択オブジェクト</option>
                  </select>
                </label>
                <p className="panel-intro">
                  画像レイヤーはData URLとしてSVG内へ埋め込まれます。
                </p>
              </>
            ) : null}
            <label>
              <span>出力倍率</span>
              <select
                disabled={exportSettings.format === 'svg'}
                value={exportSettings.multiplier}
                onChange={(event) =>
                  setExportSettings((value) => ({
                    ...value,
                    multiplier: Number(event.target.value),
                  }))
                }
              >
                <option value="0.5">0.5×</option>
                <option value="1">1×（原寸）</option>
                <option
                  value="2"
                  disabled={
                    documentSize.width * 2 > MAX_IMAGE_DIMENSION ||
                    documentSize.height * 2 > MAX_IMAGE_DIMENSION ||
                    documentSize.width * 2 * (documentSize.height * 2) >
                      MAX_IMAGE_PIXELS
                  }
                >
                  2×
                </option>
              </select>
            </label>
            <div className="export-summary">
              <Glyph>▧</Glyph>
              <span>
                <strong>
                  {exportSettings.format === 'svg'
                    ? exportSettings.svgScope === 'document'
                      ? `${documentSize.width} × ${documentSize.height} viewBox`
                      : '選択範囲のviewBox'
                    : `${Math.round(documentSize.width * exportSettings.multiplier)} × ${Math.round(documentSize.height * exportSettings.multiplier)} px`}
                </strong>
                <small>
                  {sanitizeFileStem(projectName)}.
                  {exportSettings.format === 'jpeg'
                    ? 'jpg'
                    : exportSettings.format}
                </small>
              </span>
            </div>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setActiveDialog(null)}
              >
                キャンセル
              </button>
              <button className="primary-button" type="submit">
                <Download aria-hidden="true" />
                ダウンロード
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {activeDialog === 'studio' ? (
        <Modal
          title="拡張ツール"
          description="ロゴ生成、自動化、選択・背景除去・スクリプトを端末内で実行します。"
          wide
          onClose={() => setActiveDialog(null)}
        >
          <div className="studio-tabs" role="tablist" aria-label="拡張ツール">
            {(
              [
                ['logo', 'ロゴ生成'],
                ['automation', '自動化・バッチ'],
                ['advanced', '選択・背景・スクリプト'],
              ] as const
            ).map(([tab, label]) => (
              <button
                key={tab}
                id={`studio-tab-${tab}`}
                type="button"
                role="tab"
                aria-selected={studioTab === tab}
                aria-controls={`studio-panel-${tab}`}
                onClick={() => setStudioTab(tab)}
              >
                {label}
              </button>
            ))}
          </div>
          <section
            id={`studio-panel-${studioTab}`}
            role="tabpanel"
            aria-labelledby={`studio-tab-${studioTab}`}
            className="studio-panel"
          >
            <Suspense
              fallback={
                <div className="studio-loading" role="status">
                  拡張ツールを読み込んでいます…
                </div>
              }
            >
              {studioTab === 'logo' ? (
                <LogoGeneratorPanel
                  initialName={projectName}
                  getImageData={async () => {
                    const engine = engineRef.current
                    if (!engine) {
                      throw new Error(
                        'ドキュメント画像を取得する準備ができていません。',
                      )
                    }
                    return engine.getDocumentImageData()
                  }}
                  onApplyColor={(color, target) => {
                    runEditorOperation(async (engine) => {
                      engine.setSelectionColor(color, target)
                    })
                  }}
                  onInsert={(variation) => {
                    runEditorOperation((engine) =>
                      engine.addLogoVariation(variation),
                    )
                  }}
                />
              ) : studioTab === 'automation' ? (
                <>
                  <section
                    className="automation-quick-actions"
                    aria-labelledby="automation-quick-title"
                  >
                    <div>
                      <h2 id="automation-quick-title">
                        記録できるクイック操作
                      </h2>
                      <p>
                        マクロ記録中に実行すると、直列化可能なコマンドとして保存されます。
                      </p>
                    </div>
                    <fieldset>
                      <legend>キャンバスサイズ</legend>
                      <label>
                        幅
                        <input
                          type="number"
                          min="1"
                          max={MAX_IMAGE_DIMENSION}
                          value={quickAutomation.width}
                          onChange={(event) =>
                            setQuickAutomation((current) => ({
                              ...current,
                              width: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                      <label>
                        高さ
                        <input
                          type="number"
                          min="1"
                          max={MAX_IMAGE_DIMENSION}
                          value={quickAutomation.height}
                          onChange={(event) =>
                            setQuickAutomation((current) => ({
                              ...current,
                              height: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          runQuickCommand({
                            type: 'resizeCanvas',
                            width: quickAutomation.width,
                            height: quickAutomation.height,
                          })
                        }}
                      >
                        キャンバスをリサイズ
                      </button>
                    </fieldset>
                    <fieldset>
                      <legend>画像フィルター</legend>
                      <label>
                        種類
                        <select
                          value={quickAutomation.filter}
                          onChange={(event) =>
                            setQuickAutomation((current) => ({
                              ...current,
                              filter: event.target.value as AutomationFilter,
                            }))
                          }
                        >
                          <option value="brightness">明るさ</option>
                          <option value="contrast">コントラスト</option>
                          <option value="saturation">彩度</option>
                          <option value="hue">色相</option>
                          <option value="blur">ぼかし</option>
                        </select>
                      </label>
                      <label>
                        値
                        <input
                          type="number"
                          min={quickAutomation.filter === 'blur' ? 0 : -1}
                          max="1"
                          step="0.05"
                          value={quickAutomation.filterValue}
                          onChange={(event) =>
                            setQuickAutomation((current) => ({
                              ...current,
                              filterValue: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          runQuickCommand({
                            type: 'applyFilter',
                            filter: quickAutomation.filter,
                            value: quickAutomation.filterValue,
                            target: { kind: 'activeImage' },
                          })
                        }}
                      >
                        フィルターを適用
                      </button>
                    </fieldset>
                    <fieldset>
                      <legend>透かし</legend>
                      <label>
                        テキスト
                        <input
                          value={quickAutomation.watermark}
                          onChange={(event) =>
                            setQuickAutomation((current) => ({
                              ...current,
                              watermark: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          runQuickCommand({
                            type: 'addWatermark',
                            text: quickAutomation.watermark,
                            position: 'bottomRight',
                            color: '#ffffff',
                            opacity: 0.72,
                          })
                        }}
                      >
                        透かしを追加
                      </button>
                    </fieldset>
                  </section>
                  <AutomationBatchPanel
                    savedMacros={savedMacros}
                    isRecording={macroRecording}
                    recordedCommandCount={recordedCommandCount}
                    batchRunning={batchRunning}
                    batchProgress={batchProgress}
                    batchFailures={batchFailures}
                    userIconPresets={userIconPresets}
                    documentLabel={projectName}
                    onStartMacroRecording={startMacroRecording}
                    onStopMacroRecording={stopMacroRecording}
                    onReplayMacro={replayMacro}
                    onImportMacro={importMacro}
                    onExportMacro={exportMacro}
                    onStartBatch={startBatch}
                    onCancelBatch={cancelBatch}
                    onChangeUserIconPresets={changeUserIconPresets}
                    onExportIcons={exportIcons}
                    onStatus={setStatus}
                  />
                </>
              ) : (
                <AdvancedStudioPanel
                  documentWidth={documentSize.width}
                  documentHeight={documentSize.height}
                  getDocumentImageData={async () => {
                    const engine = engineRef.current
                    if (!engine) {
                      throw new Error(
                        'ドキュメント画像を取得する準備ができていません。',
                      )
                    }
                    return engine.getDocumentImageData()
                  }}
                  selectionMask={selectionMask}
                  onApplyFilters={(operations) => {
                    runEditorOperation((engine) =>
                      engine.applyAdvancedFilterOperations(
                        operations,
                        'Advanced filters',
                      ),
                    )
                  }}
                  advancedAdjustment={selectedAdvancedAdjustment}
                  onAddAdvancedAdjustment={(operations: FilterOperation[]) => {
                    runEditorOperation((engine) =>
                      engine.addAdvancedAdjustmentLayer(
                        operations,
                        'Advanced adjustment',
                      ),
                    )
                  }}
                  onUpdateAdvancedAdjustment={(
                    id: string,
                    operations: FilterOperation[],
                  ) => {
                    runEditorOperation((engine) =>
                      engine.setAdvancedAdjustmentLayerOperations(
                        id,
                        operations,
                      ),
                    )
                  }}
                  onSelectionMask={(mask) => {
                    const engine = engineRef.current
                    if (!engine?.setPixelSelectionMask(mask)) {
                      setStatus({
                        kind: 'error',
                        message: '選択範囲を更新できませんでした。',
                      })
                      return
                    }
                    setSelectionMask(mask)
                  }}
                  onBackgroundResult={(result, mask) => {
                    runEditorOperation((engine) =>
                      engine.runAtomic('background-removal', async () => {
                        if (!engine.setPixelSelectionMask(mask)) {
                          throw new Error(
                            '背景除去マスクを選択範囲へ反映できませんでした。',
                          )
                        }
                        await engine.addImageDataLayer(
                          result,
                          'Background removed',
                          'background-removal',
                        )
                      }),
                    )
                  }}
                  onScriptCommands={(commands: EditorScriptCommand[]) => {
                    runEditorOperation(async (engine) => {
                      const { executeEditorScript } =
                        await import('./editor/scriptAdapter')
                      return executeEditorScript(engine, {
                        schemaVersion: 1,
                        commands,
                      })
                    })
                  }}
                  onMacroRegistered={(entry: MacroRepositoryEntry) => {
                    setSavedMacros((current) => [
                      entry,
                      ...current.filter(
                        ({ macro }) => macro.id !== entry.macro.id,
                      ),
                    ])
                  }}
                  onStatus={setStatus}
                />
              )}
            </Suspense>
          </section>
        </Modal>
      ) : null}

      {activeDialog === 'shortcuts' ? (
        <Modal
          title="キーボードショートカット"
          description="入力欄へフォーカスしている間は、1文字のツール切替を実行しません。"
          onClose={() => setActiveDialog(null)}
        >
          <div className="shortcut-grid">
            {[
              ['選択ツール', 'V'],
              ['ブラシ', 'B'],
              ['消しゴム', 'E'],
              ['手のひら', 'H'],
              ['元に戻す', '⌘ / Ctrl + Z'],
              ['やり直す', '⇧⌘ + Z / Ctrl + Y'],
              ['コピー / 切取 / 貼付', '⌘ / Ctrl + C / X / V'],
              ['保存', '⌘ / Ctrl + S'],
              ['開く', '⌘ / Ctrl + O'],
              ['拡大 / 縮小 / 100%', '+ / − / 0'],
              ['削除', 'Delete'],
              ['この一覧', '?'],
            ].map(([label, keys]) => (
              <div key={label}>
                <span>{label}</span>
                <kbd>{keys}</kbd>
              </div>
            ))}
          </div>
          <div className="privacy-note">
            <Glyph>⌑</Glyph>
            <span>
              <strong>Local-first</strong>
              画像と編集内容はサーバーへ送信されません。
            </span>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
