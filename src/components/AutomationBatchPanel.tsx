import {
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import {
  assertBatchSafeCommands,
  parseMacro,
  resolveMacroParameters,
  serializeMacro,
  type AutomationScalar,
  type MacroDocument,
  type MacroParameterDefinition,
  type MacroParseResult,
  type MacroRepositoryEntry,
  type ResolvedAutomationCommand,
} from '../automation'
import {
  DEFAULT_ICON_PRESETS,
  MAX_BATCH_ITEMS,
  validateIconPreset,
  type BatchFailure,
  type BatchItem,
  type BatchProgress,
  type IconExportPreset,
  type PipelineImageMimeType,
  type PipelineOutputOptions,
} from '../batch'

type Awaitable<T> = T | Promise<T>

export type AutomationBatchTab = 'macros' | 'batch' | 'icons'
export type AutomationBatchOutputMode = 'auto' | 'directory' | 'zip'

export interface MacroReplayRequest {
  macro: MacroDocument
  parameters: Readonly<Record<string, AutomationScalar>>
}

export interface MacroImportRequest {
  fileName: string
  source: string
  parsed: MacroParseResult
}

export interface MacroExportRequest {
  macro: MacroDocument
  fileName: string
  source: string
}

export interface BatchTransformRequest {
  items: readonly BatchItem[]
  commands: readonly ResolvedAutomationCommand[]
  output: PipelineOutputOptions
  outputMode: AutomationBatchOutputMode
}

export interface IconExportRequest {
  presets: readonly IconExportPreset[]
  outputMode: AutomationBatchOutputMode
}

export interface AutomationBatchPanelStatus {
  kind: 'info' | 'success' | 'warning' | 'error'
  message: string
}

export interface AutomationBatchPanelProps {
  savedMacros?: readonly MacroRepositoryEntry[]
  isRecording?: boolean
  recordedCommandCount?: number
  batchRunning?: boolean
  batchProgress?: BatchProgress
  batchFailures?: readonly BatchFailure[]
  userIconPresets?: readonly IconExportPreset[]
  documentLabel?: string
  initialTab?: AutomationBatchTab
  className?: string
  onStartMacroRecording(name: string): Awaitable<void>
  onStopMacroRecording(): Awaitable<void>
  onReplayMacro(request: MacroReplayRequest): Awaitable<void>
  onImportMacro(request: MacroImportRequest): Awaitable<void>
  onExportMacro(request: MacroExportRequest): Awaitable<void>
  onStartBatch(request: BatchTransformRequest): Awaitable<void>
  onCancelBatch(): Awaitable<void>
  onChangeUserIconPresets(presets: readonly IconExportPreset[]): Awaitable<void>
  onExportIcons(request: IconExportRequest): Awaitable<void>
  onStatus?(status: AutomationBatchPanelStatus): void
}

interface InputFileHandle {
  readonly kind: 'file'
  readonly name: string
  getFile(): Promise<File>
}

interface InputDirectoryHandle {
  readonly kind: 'directory'
  readonly name: string
  values(): AsyncIterable<InputFileHandle | InputDirectoryHandle>
}

type WindowWithInputDirectoryPicker = Window & {
  showDirectoryPicker?: (options?: {
    mode?: 'read'
  }) => Promise<InputDirectoryHandle>
}

const TAB_ORDER: readonly AutomationBatchTab[] = ['macros', 'batch', 'icons']

const TAB_LABELS: Record<AutomationBatchTab, string> = {
  macros: 'マクロ',
  batch: 'バッチ変換',
  icons: 'アイコン書き出し',
}

const FIT_LABELS = {
  contain: '全体を収める',
  cover: '領域を覆う',
  stretch: '引き伸ばす',
} as const

const OUTPUT_MODE_LABELS: ReadonlyArray<{
  value: AutomationBatchOutputMode
  label: string
}> = [
  { value: 'auto', label: '自動（非対応時はZIP）' },
  { value: 'directory', label: 'フォルダーへ直接保存' },
  { value: 'zip', label: 'ZIPでダウンロード' },
]

const WATERMARK_POSITIONS = [
  ['topLeft', '左上'],
  ['topRight', '右上'],
  ['bottomLeft', '左下'],
  ['bottomRight', '右下'],
  ['center', '中央'],
] as const

type ParameterInputValue = string | boolean

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback

const parsePositiveInteger = (source: string, label: string): number => {
  const value = Number(source)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label}は1以上の整数で指定してください。`)
  }
  return value
}

const pipelineMimeType = (file: File): PipelineImageMimeType | null => {
  if (
    file.type === 'image/png' ||
    file.type === 'image/jpeg' ||
    file.type === 'image/webp'
  ) {
    return file.type
  }
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'webp') return 'image/webp'
  return null
}

const safeBatchItemId = (fileName: string, index: number): string => {
  const stem = fileName
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 90)
  return `ui-${index + 1}-${stem || 'image'}`
}

const collectDirectoryImages = async (
  directory: InputDirectoryHandle,
): Promise<{ files: File[]; skipped: number; truncated: boolean }> => {
  const files: File[] = []
  let skipped = 0
  let visited = 0
  const visit = async (
    current: InputDirectoryHandle,
    prefix: string,
    depth: number,
  ): Promise<void> => {
    if (depth > 16) {
      throw new RangeError('入力フォルダーは16階層以内にしてください。')
    }
    for await (const entry of current.values()) {
      visited += 1
      if (visited > 10_000 || files.length > MAX_BATCH_ITEMS) return
      if (entry.kind === 'directory') {
        await visit(entry, `${prefix}${entry.name}/`, depth + 1)
        continue
      }
      const source = await entry.getFile()
      if (pipelineMimeType(source) === null) {
        skipped += 1
        continue
      }
      files.push(
        new File([source], `${prefix}${entry.name}`, {
          type: source.type,
          lastModified: source.lastModified,
        }),
      )
    }
  }
  await visit(directory, '', 0)
  return {
    files,
    skipped,
    truncated: files.length > MAX_BATCH_ITEMS || visited > 10_000,
  }
}

const macroFileName = (macro: MacroDocument): string => {
  const stem =
    macro.name
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'macro'
  return `${stem}.pwxmacro.json`
}

const defaultParameterValue = (
  definition: MacroParameterDefinition,
): ParameterInputValue => {
  if (definition.default === undefined) {
    return definition.type === 'boolean' ? false : ''
  }
  if (definition.type === 'boolean') {
    return definition.default === true
  }
  return String(definition.default)
}

const parameterValue = (
  definition: MacroParameterDefinition,
  values: Readonly<Record<string, ParameterInputValue>>,
): ParameterInputValue =>
  values[definition.name] ?? defaultParameterValue(definition)

const scalarFromParameterInput = (
  definition: MacroParameterDefinition,
  input: ParameterInputValue,
): AutomationScalar | undefined => {
  if (definition.type === 'boolean') {
    return Boolean(input)
  }
  const source = String(input)
  if (
    source === '' &&
    !definition.required &&
    definition.default === undefined
  ) {
    return undefined
  }
  if (definition.type === 'number') {
    const value = Number(source)
    if (!Number.isFinite(value)) {
      throw new TypeError(`「${definition.label}」には数値を入力してください。`)
    }
    return value
  }
  if (definition.required && source === '') {
    throw new TypeError(`「${definition.label}」は必須です。`)
  }
  return source
}

const parameterOverrides = (
  macro: MacroDocument,
  values: Readonly<Record<string, ParameterInputValue>>,
): Readonly<Record<string, AutomationScalar>> =>
  Object.fromEntries(
    macro.parameters.flatMap((definition) => {
      const value = scalarFromParameterInput(
        definition,
        parameterValue(definition, values),
      )
      return value === undefined ? [] : [[definition.name, value]]
    }),
  )

const uniquePresetId = (
  label: string,
  presets: readonly IconExportPreset[],
): string => {
  const normalized = label
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  const stem = /^[a-z]/.test(normalized) ? `user-${normalized}` : 'user-icon'
  const ids = new Set(presets.map(({ id }) => id))
  let candidate = stem
  let suffix = 2
  while (ids.has(candidate)) {
    candidate = `${stem}-${suffix}`
    suffix += 1
  }
  return candidate
}

const formatFailure = (failure: BatchFailure): string =>
  `${failure.sourceName}: ${errorMessage(
    failure.error,
    '処理に失敗しました。',
  )}`

const progressValue = (progress: BatchProgress): number =>
  Math.min(progress.total, progress.completed + progress.failed)

function ParameterControl({
  definition,
  value,
  onChange,
}: {
  definition: MacroParameterDefinition
  value: ParameterInputValue
  onChange(value: ParameterInputValue): void
}) {
  if (definition.type === 'boolean') {
    return (
      <label>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        {definition.label}
      </label>
    )
  }

  if (definition.choices && definition.choices.length > 0) {
    return (
      <label>
        <span>
          {definition.label}
          {definition.required ? '（必須）' : ''}
        </span>
        <select
          value={String(value)}
          required={definition.required}
          onChange={(event) => onChange(event.target.value)}
        >
          {!definition.required && definition.default === undefined ? (
            <option value="">既定値を使用</option>
          ) : null}
          {definition.choices.map((choice) => (
            <option
              key={`${typeof choice}:${String(choice)}`}
              value={String(choice)}
            >
              {String(choice)}
            </option>
          ))}
        </select>
      </label>
    )
  }

  return (
    <label>
      <span>
        {definition.label}
        {definition.required ? '（必須）' : ''}
      </span>
      <input
        type={definition.type === 'number' ? 'number' : 'text'}
        value={String(value)}
        required={definition.required}
        min={definition.type === 'number' ? definition.minimum : undefined}
        max={definition.type === 'number' ? definition.maximum : undefined}
        step={definition.type === 'number' ? 'any' : undefined}
        placeholder={definition.type === 'color' ? '#6757e8' : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

export function AutomationBatchPanel({
  savedMacros = [],
  isRecording = false,
  recordedCommandCount = 0,
  batchRunning = false,
  batchProgress,
  batchFailures = [],
  userIconPresets = [],
  documentLabel = '現在のドキュメント',
  initialTab = 'macros',
  className,
  onStartMacroRecording,
  onStopMacroRecording,
  onReplayMacro,
  onImportMacro,
  onExportMacro,
  onStartBatch,
  onCancelBatch,
  onChangeUserIconPresets,
  onExportIcons,
  onStatus,
}: AutomationBatchPanelProps) {
  const id = useId()
  const tabRefs = useRef<
    Partial<Record<AutomationBatchTab, HTMLButtonElement>>
  >({})
  const [activeTab, setActiveTab] = useState<AutomationBatchTab>(initialTab)
  const [status, setStatus] = useState<AutomationBatchPanelStatus>({
    kind: 'info',
    message: '自動化と一括書き出しの準備ができました。',
  })
  const [error, setError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [cancellingBatch, setCancellingBatch] = useState(false)

  const [recordingName, setRecordingName] = useState('新しいマクロ')
  const [selectedMacroId, setSelectedMacroId] = useState(
    savedMacros[0]?.macro.id ?? '',
  )
  const [parameterValues, setParameterValues] = useState<
    Record<string, ParameterInputValue>
  >({})

  const [batchFiles, setBatchFiles] = useState<readonly File[]>([])
  const [batchRecipe, setBatchRecipe] = useState<'fixed' | 'macro'>('fixed')
  const [batchMacroId, setBatchMacroId] = useState(
    savedMacros[0]?.macro.id ?? '',
  )
  const [batchParameterValues, setBatchParameterValues] = useState<
    Record<string, ParameterInputValue>
  >({})
  const [batchWidth, setBatchWidth] = useState('1200')
  const [batchHeight, setBatchHeight] = useState('1200')
  const [batchFit, setBatchFit] =
    useState<
      Extract<ResolvedAutomationCommand, { type: 'resizeImage' }>['fit']
    >('contain')
  const [batchFormat, setBatchFormat] =
    useState<PipelineImageMimeType>('image/png')
  const [batchQuality, setBatchQuality] = useState('90')
  const [watermarkText, setWatermarkText] = useState('')
  const [watermarkPosition, setWatermarkPosition] =
    useState<
      Extract<ResolvedAutomationCommand, { type: 'addWatermark' }>['position']
    >('bottomRight')
  const [watermarkColor, setWatermarkColor] = useState('#ffffff')
  const [watermarkOpacity, setWatermarkOpacity] = useState('70')
  const [batchOutputMode, setBatchOutputMode] =
    useState<AutomationBatchOutputMode>('auto')

  const initialPresetIds = [...DEFAULT_ICON_PRESETS, ...userIconPresets].map(
    ({ id: presetId }) => presetId,
  )
  const [selectedPresetIds, setSelectedPresetIds] =
    useState<readonly string[]>(initialPresetIds)
  const [iconOutputMode, setIconOutputMode] =
    useState<AutomationBatchOutputMode>('auto')
  const [presetLabel, setPresetLabel] = useState('')
  const [presetWidth, setPresetWidth] = useState('256')
  const [presetHeight, setPresetHeight] = useState('256')
  const [presetFileName, setPresetFileName] = useState('icon.png')
  const [presetFit, setPresetFit] = useState<IconExportPreset['fit']>('contain')
  const [presetBackground, setPresetBackground] = useState('transparent')

  const allPresets = [...DEFAULT_ICON_PRESETS, ...userIconPresets]
  const selectedEntry =
    savedMacros.find(({ macro }) => macro.id === selectedMacroId) ??
    savedMacros[0] ??
    null
  const selectedMacro = selectedEntry?.macro ?? null
  const selectedBatchMacro =
    savedMacros.find(({ macro }) => macro.id === batchMacroId)?.macro ??
    savedMacros[0]?.macro ??
    null

  const report = (next: AutomationBatchPanelStatus): void => {
    setStatus(next)
    onStatus?.(next)
  }

  const runAction = async (
    action: string,
    operation: () => Awaitable<void>,
    successMessage: string,
  ): Promise<void> => {
    setBusyAction(action)
    setError(null)
    try {
      await operation()
      report({ kind: 'success', message: successMessage })
    } catch (actionError) {
      const message = errorMessage(actionError, '操作を完了できませんでした。')
      setError(message)
      report({ kind: 'error', message })
    } finally {
      setBusyAction(null)
    }
  }

  const handleTabKey = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    tab: AutomationBatchTab,
  ): void => {
    if (
      event.key !== 'ArrowLeft' &&
      event.key !== 'ArrowRight' &&
      event.key !== 'Home' &&
      event.key !== 'End'
    ) {
      return
    }
    event.preventDefault()
    const currentIndex = TAB_ORDER.indexOf(tab)
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? TAB_ORDER.length - 1
          : event.key === 'ArrowRight'
            ? (currentIndex + 1) % TAB_ORDER.length
            : (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length
    const next = TAB_ORDER[nextIndex]
    setActiveTab(next)
    tabRefs.current[next]?.focus()
  }

  const startRecording = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void runAction(
      'start-recording',
      () => {
        const name = recordingName.trim()
        if (!name) {
          throw new TypeError('マクロ名を入力してください。')
        }
        return onStartMacroRecording(name)
      },
      'マクロ記録を開始しました。',
    )
  }

  const stopRecording = (): void => {
    void runAction(
      'stop-recording',
      onStopMacroRecording,
      `${recordedCommandCount}件のコマンドをマクロとして保存しました。`,
    )
  }

  const replaySelectedMacro = (): void => {
    void runAction(
      'replay-macro',
      () => {
        if (!selectedMacro) {
          throw new TypeError('再生するマクロを選択してください。')
        }
        return onReplayMacro({
          macro: selectedMacro,
          parameters: parameterOverrides(selectedMacro, parameterValues),
        })
      },
      `マクロ「${selectedMacro?.name ?? ''}」を再生しました。`,
    )
  }

  const importMacroFile = (file: File): void => {
    void runAction(
      'import-macro',
      async () => {
        const source = await file.text()
        const parsed = parseMacro(source)
        await onImportMacro({ fileName: file.name, source, parsed })
        if (parsed.diagnostics.length > 0) {
          report({
            kind: 'warning',
            message: `${parsed.diagnostics.length}件の警告を含むマクロを読み込みました。`,
          })
        }
      },
      'マクロJSONを読み込みました。',
    )
  }

  const exportSelectedMacro = (): void => {
    void runAction(
      'export-macro',
      () => {
        if (!selectedMacro) {
          throw new TypeError('書き出すマクロを選択してください。')
        }
        return onExportMacro({
          macro: selectedMacro,
          fileName: macroFileName(selectedMacro),
          source: serializeMacro(selectedMacro),
        })
      },
      'マクロJSONを書き出しました。',
    )
  }

  const startBatch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void runAction(
      'start-batch',
      () => {
        if (batchFiles.length === 0) {
          throw new TypeError('変換する画像を1件以上選択してください。')
        }
        if (batchFiles.length > MAX_BATCH_ITEMS) {
          throw new RangeError(
            `一度に選択できる画像は${MAX_BATCH_ITEMS}件までです。`,
          )
        }
        const items: BatchItem[] = batchFiles.map((file, index) => {
          const type = pipelineMimeType(file)
          if (!type) {
            throw new TypeError(
              `「${file.name}」はPNG、JPEG、WebPのいずれでもありません。`,
            )
          }
          return {
            id: safeBatchItemId(file.name, index),
            source: {
              name: file.name,
              type,
              size: file.size,
              arrayBuffer: () => file.arrayBuffer(),
            },
          }
        })
        let commands: ResolvedAutomationCommand[]
        if (batchRecipe === 'macro') {
          if (!selectedBatchMacro) {
            throw new TypeError('バッチへ適用するマクロを選択してください。')
          }
          commands = resolveMacroParameters(
            selectedBatchMacro,
            parameterOverrides(selectedBatchMacro, batchParameterValues),
          )
          assertBatchSafeCommands(commands)
        } else {
          const width = parsePositiveInteger(batchWidth, '幅')
          const height = parsePositiveInteger(batchHeight, '高さ')
          commands = [
            {
              type: 'resizeImage',
              width,
              height,
              fit: batchFit,
              background: 'transparent',
            },
          ]
          if (watermarkText.trim()) {
            const opacityPercent = Number(watermarkOpacity)
            if (
              !Number.isFinite(opacityPercent) ||
              opacityPercent < 0 ||
              opacityPercent > 100
            ) {
              throw new RangeError(
                '透かしの不透明度は0〜100で指定してください。',
              )
            }
            commands.push({
              type: 'addWatermark',
              text: watermarkText.trim(),
              position: watermarkPosition,
              color: watermarkColor,
              opacity: opacityPercent / 100,
            })
          }
        }
        const qualityPercent = Number(batchQuality)
        if (
          batchFormat !== 'image/png' &&
          (!Number.isFinite(qualityPercent) ||
            qualityPercent <= 0 ||
            qualityPercent > 100)
        ) {
          throw new RangeError('品質は1〜100で指定してください。')
        }
        const output: PipelineOutputOptions = {
          mimeType: batchFormat,
          ...(batchFormat === 'image/png'
            ? {}
            : { quality: qualityPercent / 100 }),
        }
        return onStartBatch({
          items,
          commands,
          output,
          outputMode: batchOutputMode,
        })
      },
      'バッチ変換を開始しました。',
    )
  }

  const selectBatchDirectory = (files: FileList | null): void => {
    const selected = Array.from(files ?? [])
    const images = selected.filter((file) => pipelineMimeType(file) !== null)
    setBatchFiles(images)
    const skipped = selected.length - images.length
    report({
      kind: images.length > MAX_BATCH_ITEMS || skipped > 0 ? 'warning' : 'info',
      message:
        images.length > MAX_BATCH_ITEMS
          ? `フォルダー内に${images.length}件の画像があります。一度に処理できる${MAX_BATCH_ITEMS}件以下へ絞ってください。`
          : skipped > 0
            ? `${images.length}件の画像を選択し、対象外の${skipped}件を除外しました。`
            : `${images.length}件の画像をフォルダーから選択しました。`,
    })
  }

  const pickBatchDirectory = async (): Promise<void> => {
    const picker = (window as WindowWithInputDirectoryPicker)
      .showDirectoryPicker
    if (!picker || busyAction) return
    setBusyAction('pick-input-directory')
    setError(null)
    try {
      const directory = await picker.call(window, { mode: 'read' })
      const selected = await collectDirectoryImages(directory)
      setBatchFiles(selected.files)
      report({
        kind:
          selected.truncated ||
          selected.skipped > 0 ||
          selected.files.length === 0
            ? 'warning'
            : 'success',
        message: selected.truncated
          ? `フォルダー内に${selected.files.length}件以上の画像があります。一度に処理できる${MAX_BATCH_ITEMS}件以下へ絞ってください。`
          : selected.files.length === 0
            ? 'フォルダーに対応画像がありません。'
            : selected.skipped > 0
              ? `${selected.files.length}件の画像を選択し、対象外の${selected.skipped}件を除外しました。`
              : `${selected.files.length}件の画像をフォルダーから選択しました。`,
      })
    } catch (directoryError) {
      if (
        directoryError instanceof DOMException &&
        directoryError.name === 'AbortError'
      ) {
        report({
          kind: 'info',
          message: '入力フォルダーの選択をキャンセルしました。',
        })
      } else {
        const message = errorMessage(
          directoryError,
          '入力フォルダーを読み込めませんでした。',
        )
        setError(message)
        report({ kind: 'error', message })
      }
    } finally {
      setBusyAction(null)
    }
  }

  const cancelBatch = (): void => {
    setCancellingBatch(true)
    setError(null)
    void Promise.resolve(onCancelBatch())
      .then(() => {
        report({
          kind: 'warning',
          message: 'バッチ変換のキャンセルを要求しました。',
        })
      })
      .catch((cancelError: unknown) => {
        const message = errorMessage(
          cancelError,
          'バッチ変換をキャンセルできませんでした。',
        )
        setError(message)
        report({ kind: 'error', message })
      })
      .finally(() => setCancellingBatch(false))
  }

  const togglePreset = (presetId: string, checked: boolean): void => {
    setSelectedPresetIds((current) =>
      checked
        ? current.includes(presetId)
          ? current
          : [...current, presetId]
        : current.filter((idToKeep) => idToKeep !== presetId),
    )
  }

  const addUserPreset = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void runAction(
      'add-icon-preset',
      async () => {
        const label = presetLabel.trim()
        if (!label) {
          throw new TypeError('プリセット名を入力してください。')
        }
        const preset = validateIconPreset({
          id: uniquePresetId(label, allPresets),
          label,
          width: parsePositiveInteger(presetWidth, '幅'),
          height: parsePositiveInteger(presetHeight, '高さ'),
          fileName: presetFileName.trim(),
          fit: presetFit,
          background: presetBackground.trim(),
        })
        if (
          allPresets.some(
            ({ fileName }) =>
              fileName.toLowerCase() === preset.fileName.toLowerCase(),
          )
        ) {
          throw new TypeError(
            `ファイル名「${preset.fileName}」は既に使用されています。`,
          )
        }
        await onChangeUserIconPresets([...userIconPresets, preset])
        setSelectedPresetIds((current) => [...current, preset.id])
        setPresetLabel('')
      },
      'ユーザー定義プリセットを追加しました。',
    )
  }

  const removeUserPreset = (preset: IconExportPreset): void => {
    void runAction(
      `remove-preset-${preset.id}`,
      async () => {
        await onChangeUserIconPresets(
          userIconPresets.filter(({ id: presetId }) => presetId !== preset.id),
        )
        setSelectedPresetIds((current) =>
          current.filter((presetId) => presetId !== preset.id),
        )
      },
      `プリセット「${preset.label}」を削除しました。`,
    )
  }

  const exportIcons = (): void => {
    void runAction(
      'export-icons',
      () => {
        const presets = allPresets.filter(({ id: presetId }) =>
          selectedPresetIds.includes(presetId),
        )
        if (presets.length === 0) {
          throw new TypeError(
            '書き出すアイコンプリセットを1件以上選択してください。',
          )
        }
        return onExportIcons({ presets, outputMode: iconOutputMode })
      },
      'アイコンの一括書き出しを開始しました。',
    )
  }

  const disableActions = busyAction !== null
  const batchIsActive = batchRunning || busyAction === 'start-batch'

  return (
    <section
      className={className ?? 'automation-batch-panel'}
      aria-labelledby={`${id}-title`}
    >
      <header>
        <p>LOCAL AUTOMATION</p>
        <h2 id={`${id}-title`}>自動化と一括書き出し</h2>
      </header>

      <div role="tablist" aria-label="自動化ツールのカテゴリ">
        {TAB_ORDER.map((tab) => (
          <button
            key={tab}
            ref={(element) => {
              tabRefs.current[tab] = element ?? undefined
            }}
            id={`${id}-${tab}-tab`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`${id}-${tab}-panel`}
            tabIndex={activeTab === tab ? 0 : -1}
            onClick={() => setActiveTab(tab)}
            onKeyDown={(event) => handleTabKey(event, tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {activeTab === 'macros' ? (
        <div
          id={`${id}-macros-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-macros-tab`}
        >
          <h3>マクロ記録と再生</h3>
          <p>
            編集操作をコマンド列として保存し、現在のドキュメントへ1つのUndo単位で再生します。
          </p>

          <form onSubmit={startRecording}>
            <fieldset disabled={disableActions || isRecording}>
              <legend>記録</legend>
              <label>
                <span>マクロ名</span>
                <input
                  type="text"
                  value={recordingName}
                  maxLength={128}
                  required
                  onChange={(event) => setRecordingName(event.target.value)}
                />
              </label>
              <button type="submit">記録を開始</button>
            </fieldset>
          </form>
          {isRecording ? (
            <div role="group" aria-label="記録中のマクロ">
              <p aria-live="polite">
                記録中: {recordedCommandCount}件のコマンド
              </p>
              <button
                type="button"
                disabled={disableActions}
                onClick={stopRecording}
              >
                記録を停止して保存
              </button>
            </div>
          ) : null}

          <fieldset disabled={disableActions || savedMacros.length === 0}>
            <legend>保存済みマクロ</legend>
            <label>
              <span>マクロを選択</span>
              <select
                value={selectedMacro?.id ?? ''}
                onChange={(event) => {
                  setSelectedMacroId(event.target.value)
                  setParameterValues({})
                }}
              >
                {savedMacros.length === 0 ? (
                  <option value="">保存済みマクロはありません</option>
                ) : null}
                {savedMacros.map(({ macro }) => (
                  <option key={macro.id} value={macro.id}>
                    {macro.name}
                  </option>
                ))}
              </select>
            </label>

            {selectedEntry && selectedEntry.diagnostics.length > 0 ? (
              <ul aria-label="選択中のマクロの警告">
                {selectedEntry.diagnostics.map((diagnostic, index) => (
                  <li key={`${diagnostic.code}-${index}`}>
                    {diagnostic.message}
                  </li>
                ))}
              </ul>
            ) : null}

            {selectedMacro && selectedMacro.parameters.length > 0 ? (
              <fieldset>
                <legend>再生時のパラメーター</legend>
                {selectedMacro.parameters.map((definition) => (
                  <ParameterControl
                    key={definition.name}
                    definition={definition}
                    value={parameterValue(definition, parameterValues)}
                    onChange={(value) =>
                      setParameterValues((current) => ({
                        ...current,
                        [definition.name]: value,
                      }))
                    }
                  />
                ))}
              </fieldset>
            ) : (
              <p>このマクロに上書き可能なパラメーターはありません。</p>
            )}

            <div role="group" aria-label="保存済みマクロの操作">
              <button type="button" onClick={replaySelectedMacro}>
                現在のドキュメントへ再生
              </button>
              <button type="button" onClick={exportSelectedMacro}>
                JSONを書き出し
              </button>
            </div>
          </fieldset>

          <label>
            <span>マクロJSONを読み込み</span>
            <input
              type="file"
              accept=".pwxmacro.json,.json,application/json"
              disabled={disableActions}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) importMacroFile(file)
                event.target.value = ''
              }}
            />
          </label>
        </div>
      ) : null}

      {activeTab === 'batch' ? (
        <div
          id={`${id}-batch-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-batch-tab`}
        >
          <h3>複数画像の定型変換</h3>
          <p>
            PNG・JPEG・WebPをWorker向けコマンドへ変換します。ポインター依存操作はバッチ対象外です。
          </p>

          <form onSubmit={startBatch}>
            <fieldset disabled={disableActions || batchRunning}>
              <legend>入力画像</legend>
              <label>
                <span>画像ファイル（最大{MAX_BATCH_ITEMS}件）</span>
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                  multiple
                  onChange={(event) =>
                    setBatchFiles(Array.from(event.target.files ?? []))
                  }
                />
              </label>
              <label>
                <span>入力フォルダー（対応ブラウザー）</span>
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                  multiple
                  {...({
                    webkitdirectory: '',
                    directory: '',
                  } as Record<string, string>)}
                  onChange={(event) => {
                    selectBatchDirectory(event.target.files)
                    event.target.value = ''
                  }}
                />
              </label>
              <button
                type="button"
                disabled={
                  disableActions ||
                  typeof (window as WindowWithInputDirectoryPicker)
                    .showDirectoryPicker !== 'function'
                }
                onClick={() => void pickBatchDirectory()}
              >
                File System Access APIでフォルダーを選択
              </button>
              <p>{batchFiles.length}件を選択中</p>
              {batchFiles.length > 0 ? (
                <ul aria-label="選択したバッチ画像">
                  {batchFiles.slice(0, 20).map((file, index) => (
                    <li key={`${file.name}-${file.size}-${index}`}>
                      {file.name}
                    </li>
                  ))}
                  {batchFiles.length > 20 ? (
                    <li>ほか{batchFiles.length - 20}件</li>
                  ) : null}
                </ul>
              ) : null}
            </fieldset>

            <fieldset disabled={disableActions || batchRunning}>
              <legend>処理レシピ</legend>
              <label>
                <span>適用する処理</span>
                <select
                  value={batchRecipe}
                  onChange={(event) =>
                    setBatchRecipe(event.target.value as 'fixed' | 'macro')
                  }
                >
                  <option value="fixed">定型（リサイズ・透かし）</option>
                  <option value="macro" disabled={savedMacros.length === 0}>
                    保存済みマクロ
                  </option>
                </select>
              </label>
              {batchRecipe === 'macro' ? (
                <>
                  <label>
                    <span>バッチ用マクロ</span>
                    <select
                      value={selectedBatchMacro?.id ?? ''}
                      onChange={(event) => {
                        setBatchMacroId(event.target.value)
                        setBatchParameterValues({})
                      }}
                    >
                      {savedMacros.map(({ macro }) => (
                        <option key={macro.id} value={macro.id}>
                          {macro.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedBatchMacro?.parameters.map((definition) => (
                    <ParameterControl
                      key={`batch-${definition.name}`}
                      definition={definition}
                      value={parameterValue(definition, batchParameterValues)}
                      onChange={(value) =>
                        setBatchParameterValues((current) => ({
                          ...current,
                          [definition.name]: value,
                        }))
                      }
                    />
                  ))}
                  <p>
                    リサイズ・フィルター・透かしなど、バッチ対応コマンドだけを実行します。
                  </p>
                </>
              ) : null}
            </fieldset>

            <fieldset disabled={disableActions || batchRunning}>
              <legend>
                {batchRecipe === 'fixed' ? 'リサイズと形式' : '出力形式'}
              </legend>
              {batchRecipe === 'fixed' ? (
                <>
                  <label>
                    <span>幅（px）</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      required
                      value={batchWidth}
                      onChange={(event) => setBatchWidth(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>高さ（px）</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      required
                      value={batchHeight}
                      onChange={(event) => setBatchHeight(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>フィット方法</span>
                    <select
                      value={batchFit}
                      onChange={(event) =>
                        setBatchFit(
                          event.target.value as NonNullable<typeof batchFit>,
                        )
                      }
                    >
                      {Object.entries(FIT_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}
              <label>
                <span>出力形式</span>
                <select
                  value={batchFormat}
                  onChange={(event) =>
                    setBatchFormat(event.target.value as PipelineImageMimeType)
                  }
                >
                  <option value="image/png">PNG</option>
                  <option value="image/jpeg">JPEG</option>
                  <option value="image/webp">WebP</option>
                </select>
              </label>
              <label>
                <span>品質（%）</span>
                <input
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  value={batchQuality}
                  disabled={batchFormat === 'image/png'}
                  onChange={(event) => setBatchQuality(event.target.value)}
                />
              </label>
            </fieldset>

            {batchRecipe === 'fixed' ? (
              <fieldset disabled={disableActions || batchRunning}>
                <legend>テキスト透かし（任意）</legend>
                <label>
                  <span>透かし文字</span>
                  <input
                    type="text"
                    value={watermarkText}
                    maxLength={4096}
                    placeholder="空欄なら追加しません"
                    onChange={(event) => setWatermarkText(event.target.value)}
                  />
                </label>
                <label>
                  <span>透かし位置</span>
                  <select
                    value={watermarkPosition}
                    disabled={!watermarkText}
                    onChange={(event) =>
                      setWatermarkPosition(
                        event.target.value as NonNullable<
                          typeof watermarkPosition
                        >,
                      )
                    }
                  >
                    {WATERMARK_POSITIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>透かし色</span>
                  <input
                    type="text"
                    value={watermarkColor}
                    disabled={!watermarkText}
                    onChange={(event) => setWatermarkColor(event.target.value)}
                  />
                </label>
                <label>
                  <span>透かし不透明度（%）</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={watermarkOpacity}
                    disabled={!watermarkText}
                    onChange={(event) =>
                      setWatermarkOpacity(event.target.value)
                    }
                  />
                </label>
              </fieldset>
            ) : null}

            <fieldset disabled={disableActions || batchRunning}>
              <legend>出力先</legend>
              <label>
                <span>保存方法</span>
                <select
                  value={batchOutputMode}
                  onChange={(event) =>
                    setBatchOutputMode(
                      event.target.value as AutomationBatchOutputMode,
                    )
                  }
                >
                  {OUTPUT_MODE_LABELS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit">バッチ変換を開始</button>
            </fieldset>
          </form>

          {batchProgress ? (
            <section aria-labelledby={`${id}-batch-progress-title`}>
              <h4 id={`${id}-batch-progress-title`}>変換の進捗</h4>
              <progress
                aria-label="バッチ変換の進捗"
                max={Math.max(1, batchProgress.total)}
                value={progressValue(batchProgress)}
              />
              <p aria-live="polite">
                完了 {batchProgress.completed}件 / 失敗 {batchProgress.failed}件
                / 全{batchProgress.total}件
                {batchProgress.active > 0
                  ? `（処理中 ${batchProgress.active}件）`
                  : ''}
              </p>
            </section>
          ) : null}

          {batchIsActive ? (
            <button
              type="button"
              disabled={cancellingBatch}
              onClick={cancelBatch}
            >
              {cancellingBatch ? 'キャンセル要求中…' : 'バッチ変換をキャンセル'}
            </button>
          ) : null}

          {batchFailures.length > 0 ? (
            <section aria-labelledby={`${id}-batch-failures-title`}>
              <h4 id={`${id}-batch-failures-title`}>失敗したファイル</h4>
              <ul>
                {batchFailures.map((failure) => (
                  <li key={failure.id}>{formatFailure(failure)}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      {activeTab === 'icons' ? (
        <div
          id={`${id}-icons-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-icons-tab`}
        >
          <h3>アイコンプリセット一括書き出し</h3>
          <p>
            出力元: <strong>{documentLabel}</strong>
          </p>

          <fieldset disabled={disableActions}>
            <legend>書き出すサイズ</legend>
            {allPresets.map((preset) => (
              <div key={preset.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedPresetIds.includes(preset.id)}
                    onChange={(event) =>
                      togglePreset(preset.id, event.target.checked)
                    }
                  />
                  {preset.label}（{preset.width} × {preset.height}）
                </label>
                {!preset.builtIn ? (
                  <button
                    type="button"
                    aria-label={`${preset.label}を削除`}
                    onClick={() => removeUserPreset(preset)}
                  >
                    削除
                  </button>
                ) : null}
              </div>
            ))}
          </fieldset>

          <form onSubmit={addUserPreset}>
            <fieldset disabled={disableActions}>
              <legend>ユーザー定義プリセットを追加</legend>
              <label>
                <span>プリセット名</span>
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={presetLabel}
                  onChange={(event) => setPresetLabel(event.target.value)}
                />
              </label>
              <label>
                <span>幅（px）</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={presetWidth}
                  onChange={(event) => setPresetWidth(event.target.value)}
                />
              </label>
              <label>
                <span>高さ（px）</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={presetHeight}
                  onChange={(event) => setPresetHeight(event.target.value)}
                />
              </label>
              <label>
                <span>ファイル名</span>
                <input
                  type="text"
                  required
                  value={presetFileName}
                  pattern='[^<>:"/\\|?*]+\.png'
                  onChange={(event) => setPresetFileName(event.target.value)}
                />
              </label>
              <label>
                <span>フィット方法</span>
                <select
                  value={presetFit}
                  onChange={(event) =>
                    setPresetFit(event.target.value as IconExportPreset['fit'])
                  }
                >
                  {Object.entries(FIT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>背景色</span>
                <input
                  type="text"
                  required
                  value={presetBackground}
                  onChange={(event) => setPresetBackground(event.target.value)}
                />
              </label>
              <button type="submit">プリセットを追加</button>
            </fieldset>
          </form>

          <fieldset disabled={disableActions}>
            <legend>アイコンの出力先</legend>
            <label>
              <span>保存方法</span>
              <select
                value={iconOutputMode}
                onChange={(event) =>
                  setIconOutputMode(
                    event.target.value as AutomationBatchOutputMode,
                  )
                }
              >
                {OUTPUT_MODE_LABELS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={exportIcons}>
              選択したプリセットを書き出し
            </button>
          </fieldset>
        </div>
      ) : null}

      {error ? <p role="alert">{error}</p> : null}
      <p role="status" aria-live="polite">
        {status.message}
      </p>
    </section>
  )
}

export default AutomationBatchPanel
