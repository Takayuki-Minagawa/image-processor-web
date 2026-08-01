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
import {
  formatStudioMessage,
  getStudioComponentCopy,
  type StudioComponentCopy,
} from '../i18n.studio-components'
import type { AppLocale } from '../uiPreferences'

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
  locale?: AppLocale
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

type ParameterInputValue = string | boolean
type AutomationCopy = StudioComponentCopy['automation']

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback

const parsePositiveInteger = (
  source: string,
  label: string,
  copy: AutomationCopy,
): number => {
  const value = Number(source)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(formatStudioMessage(copy.positiveInteger, { label }))
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
  copy: AutomationCopy,
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
      throw new RangeError(copy.directoryDepth)
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
  copy: AutomationCopy,
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
      throw new TypeError(
        formatStudioMessage(copy.parameterNumber, {
          label: definition.label,
        }),
      )
    }
    return value
  }
  if (definition.required && source === '') {
    throw new TypeError(
      formatStudioMessage(copy.parameterRequired, {
        label: definition.label,
      }),
    )
  }
  return source
}

const parameterOverrides = (
  macro: MacroDocument,
  values: Readonly<Record<string, ParameterInputValue>>,
  copy: AutomationCopy,
): Readonly<Record<string, AutomationScalar>> =>
  Object.fromEntries(
    macro.parameters.flatMap((definition) => {
      const value = scalarFromParameterInput(
        definition,
        parameterValue(definition, values),
        copy,
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

const formatFailure = (failure: BatchFailure, copy: AutomationCopy): string =>
  `${failure.sourceName}: ${errorMessage(failure.error, copy.processingFailed)}`

const progressValue = (progress: BatchProgress): number =>
  Math.min(progress.total, progress.completed + progress.failed)

function ParameterControl({
  definition,
  value,
  onChange,
  copy,
}: {
  definition: MacroParameterDefinition
  value: ParameterInputValue
  onChange(value: ParameterInputValue): void
  copy: AutomationCopy
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
          {definition.required ? copy.requiredSuffix : ''}
        </span>
        <select
          value={String(value)}
          required={definition.required}
          onChange={(event) => onChange(event.target.value)}
        >
          {!definition.required && definition.default === undefined ? (
            <option value="">{copy.useDefault}</option>
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
        {definition.required ? copy.requiredSuffix : ''}
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
  documentLabel,
  initialTab = 'macros',
  className,
  locale = 'ja',
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
  const copy = getStudioComponentCopy(locale).automation
  const resolvedDocumentLabel = documentLabel ?? copy.currentDocument
  const tabLabels: Record<AutomationBatchTab, string> = {
    macros: copy.tabMacros,
    batch: copy.tabBatch,
    icons: copy.tabIcons,
  }
  const fitLabels = {
    contain: copy.fitContain,
    cover: copy.fitCover,
    stretch: copy.fitStretch,
  } as const
  const outputModeLabels: ReadonlyArray<{
    value: AutomationBatchOutputMode
    label: string
  }> = [
    { value: 'auto', label: copy.outputAuto },
    { value: 'directory', label: copy.outputDirectory },
    { value: 'zip', label: copy.outputZip },
  ]
  const watermarkPositions = [
    ['topLeft', copy.positionTopLeft],
    ['topRight', copy.positionTopRight],
    ['bottomLeft', copy.positionBottomLeft],
    ['bottomRight', copy.positionBottomRight],
    ['center', copy.positionCenter],
  ] as const
  const id = useId()
  const tabRefs = useRef<
    Partial<Record<AutomationBatchTab, HTMLButtonElement>>
  >({})
  const [activeTab, setActiveTab] = useState<AutomationBatchTab>(initialTab)
  const [status, setStatus] = useState<AutomationBatchPanelStatus>({
    kind: 'info',
    message: copy.ready,
  })
  const [error, setError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [cancellingBatch, setCancellingBatch] = useState(false)

  const [recordingName, setRecordingName] = useState(copy.newMacro)
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
      const message = errorMessage(actionError, copy.actionFailed)
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
          throw new TypeError(copy.macroNameRequired)
        }
        return onStartMacroRecording(name)
      },
      copy.recordingStarted,
    )
  }

  const stopRecording = (): void => {
    void runAction(
      'stop-recording',
      onStopMacroRecording,
      formatStudioMessage(copy.recordingStopped, {
        count: recordedCommandCount,
      }),
    )
  }

  const replaySelectedMacro = (): void => {
    void runAction(
      'replay-macro',
      () => {
        if (!selectedMacro) {
          throw new TypeError(copy.replaySelectionRequired)
        }
        return onReplayMacro({
          macro: selectedMacro,
          parameters: parameterOverrides(selectedMacro, parameterValues, copy),
        })
      },
      formatStudioMessage(copy.replayedMacro, {
        name: selectedMacro?.name ?? '',
      }),
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
            message: formatStudioMessage(copy.importedWithWarnings, {
              count: parsed.diagnostics.length,
            }),
          })
        }
      },
      copy.importedMacro,
    )
  }

  const exportSelectedMacro = (): void => {
    void runAction(
      'export-macro',
      () => {
        if (!selectedMacro) {
          throw new TypeError(copy.exportSelectionRequired)
        }
        return onExportMacro({
          macro: selectedMacro,
          fileName: macroFileName(selectedMacro),
          source: serializeMacro(selectedMacro),
        })
      },
      copy.exportedMacro,
    )
  }

  const startBatch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void runAction(
      'start-batch',
      () => {
        if (batchFiles.length === 0) {
          throw new TypeError(copy.batchFilesRequired)
        }
        if (batchFiles.length > MAX_BATCH_ITEMS) {
          throw new RangeError(
            formatStudioMessage(copy.tooManyFiles, {
              max: MAX_BATCH_ITEMS,
            }),
          )
        }
        const items: BatchItem[] = batchFiles.map((file, index) => {
          const type = pipelineMimeType(file)
          if (!type) {
            throw new TypeError(
              formatStudioMessage(copy.unsupportedImage, { name: file.name }),
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
            throw new TypeError(copy.batchMacroRequired)
          }
          commands = resolveMacroParameters(
            selectedBatchMacro,
            parameterOverrides(selectedBatchMacro, batchParameterValues, copy),
          )
          assertBatchSafeCommands(commands)
        } else {
          const width = parsePositiveInteger(batchWidth, copy.width, copy)
          const height = parsePositiveInteger(batchHeight, copy.height, copy)
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
              throw new RangeError(copy.watermarkOpacityRange)
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
          throw new RangeError(copy.qualityRange)
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
      copy.batchStarted,
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
          ? formatStudioMessage(copy.folderTooMany, {
              count: images.length,
              max: MAX_BATCH_ITEMS,
            })
          : skipped > 0
            ? formatStudioMessage(copy.selectedAndSkipped, {
                count: images.length,
                skipped,
              })
            : formatStudioMessage(copy.selectedFromFolder, {
                count: images.length,
              }),
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
      const selected = await collectDirectoryImages(directory, copy)
      setBatchFiles(selected.files)
      report({
        kind:
          selected.truncated ||
          selected.skipped > 0 ||
          selected.files.length === 0
            ? 'warning'
            : 'success',
        message: selected.truncated
          ? formatStudioMessage(copy.folderAtLeastTooMany, {
              count: selected.files.length,
              max: MAX_BATCH_ITEMS,
            })
          : selected.files.length === 0
            ? copy.noSupportedImages
            : selected.skipped > 0
              ? formatStudioMessage(copy.selectedAndSkipped, {
                  count: selected.files.length,
                  skipped: selected.skipped,
                })
              : formatStudioMessage(copy.selectedFromFolder, {
                  count: selected.files.length,
                }),
      })
    } catch (directoryError) {
      if (
        directoryError instanceof DOMException &&
        directoryError.name === 'AbortError'
      ) {
        report({
          kind: 'info',
          message: copy.folderSelectionCancelled,
        })
      } else {
        const message = errorMessage(directoryError, copy.folderReadFailed)
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
          message: copy.cancelRequested,
        })
      })
      .catch((cancelError: unknown) => {
        const message = errorMessage(cancelError, copy.cancelFailed)
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
          throw new TypeError(copy.presetNameRequired)
        }
        const preset = validateIconPreset({
          id: uniquePresetId(label, allPresets),
          label,
          width: parsePositiveInteger(presetWidth, copy.width, copy),
          height: parsePositiveInteger(presetHeight, copy.height, copy),
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
            formatStudioMessage(copy.duplicateFileName, {
              name: preset.fileName,
            }),
          )
        }
        await onChangeUserIconPresets([...userIconPresets, preset])
        setSelectedPresetIds((current) => [...current, preset.id])
        setPresetLabel('')
      },
      copy.presetAdded,
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
      formatStudioMessage(copy.presetRemoved, { name: preset.label }),
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
          throw new TypeError(copy.exportPresetRequired)
        }
        return onExportIcons({ presets, outputMode: iconOutputMode })
      },
      copy.iconExportStarted,
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
        <h2 id={`${id}-title`}>{copy.heading}</h2>
      </header>

      <div role="tablist" aria-label={copy.tabList}>
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
            {tabLabels[tab]}
          </button>
        ))}
      </div>

      {activeTab === 'macros' ? (
        <div
          id={`${id}-macros-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-macros-tab`}
        >
          <h3>{copy.macroHeading}</h3>
          <p>{copy.macroDescription}</p>

          <form onSubmit={startRecording}>
            <fieldset disabled={disableActions || isRecording}>
              <legend>{copy.recording}</legend>
              <label>
                <span>{copy.macroName}</span>
                <input
                  type="text"
                  value={recordingName}
                  maxLength={128}
                  required
                  onChange={(event) => setRecordingName(event.target.value)}
                />
              </label>
              <button type="submit">{copy.startRecording}</button>
            </fieldset>
          </form>
          {isRecording ? (
            <div role="group" aria-label={copy.recordingGroup}>
              <p aria-live="polite">
                {formatStudioMessage(copy.recordingProgress, {
                  count: recordedCommandCount,
                })}
              </p>
              <button
                type="button"
                disabled={disableActions}
                onClick={stopRecording}
              >
                {copy.stopRecording}
              </button>
            </div>
          ) : null}

          <fieldset disabled={disableActions || savedMacros.length === 0}>
            <legend>{copy.savedMacros}</legend>
            <label>
              <span>{copy.selectMacro}</span>
              <select
                value={selectedMacro?.id ?? ''}
                onChange={(event) => {
                  setSelectedMacroId(event.target.value)
                  setParameterValues({})
                }}
              >
                {savedMacros.length === 0 ? (
                  <option value="">{copy.noSavedMacros}</option>
                ) : null}
                {savedMacros.map(({ macro }) => (
                  <option key={macro.id} value={macro.id}>
                    {macro.name}
                  </option>
                ))}
              </select>
            </label>

            {selectedEntry && selectedEntry.diagnostics.length > 0 ? (
              <ul aria-label={copy.macroWarnings}>
                {selectedEntry.diagnostics.map((diagnostic, index) => (
                  <li key={`${diagnostic.code}-${index}`}>
                    {diagnostic.message}
                  </li>
                ))}
              </ul>
            ) : null}

            {selectedMacro && selectedMacro.parameters.length > 0 ? (
              <fieldset>
                <legend>{copy.replayParameters}</legend>
                {selectedMacro.parameters.map((definition) => (
                  <ParameterControl
                    key={definition.name}
                    definition={definition}
                    value={parameterValue(definition, parameterValues)}
                    copy={copy}
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
              <p>{copy.noReplayParameters}</p>
            )}

            <div role="group" aria-label={copy.savedMacroActions}>
              <button type="button" onClick={replaySelectedMacro}>
                {copy.replayCurrent}
              </button>
              <button type="button" onClick={exportSelectedMacro}>
                {copy.exportJson}
              </button>
            </div>
          </fieldset>

          <label>
            <span>{copy.importJson}</span>
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
          <h3>{copy.batchHeading}</h3>
          <p>{copy.batchDescription}</p>

          <form onSubmit={startBatch}>
            <fieldset disabled={disableActions || batchRunning}>
              <legend>{copy.inputImages}</legend>
              <label>
                <span>
                  {formatStudioMessage(copy.imageFiles, {
                    max: MAX_BATCH_ITEMS,
                  })}
                </span>
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
                <span>{copy.inputFolder}</span>
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
                {copy.pickFolder}
              </button>
              <p>
                {formatStudioMessage(copy.selectedCount, {
                  count: batchFiles.length,
                })}
              </p>
              {batchFiles.length > 0 ? (
                <ul aria-label={copy.selectedBatchImages}>
                  {batchFiles.slice(0, 20).map((file, index) => (
                    <li key={`${file.name}-${file.size}-${index}`}>
                      {file.name}
                    </li>
                  ))}
                  {batchFiles.length > 20 ? (
                    <li>
                      {formatStudioMessage(copy.remainingCount, {
                        count: batchFiles.length - 20,
                      })}
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </fieldset>

            <fieldset disabled={disableActions || batchRunning}>
              <legend>{copy.recipe}</legend>
              <label>
                <span>{copy.appliedProcess}</span>
                <select
                  value={batchRecipe}
                  onChange={(event) =>
                    setBatchRecipe(event.target.value as 'fixed' | 'macro')
                  }
                >
                  <option value="fixed">{copy.fixedRecipe}</option>
                  <option value="macro" disabled={savedMacros.length === 0}>
                    {copy.savedMacros}
                  </option>
                </select>
              </label>
              {batchRecipe === 'macro' ? (
                <>
                  <label>
                    <span>{copy.batchMacro}</span>
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
                      copy={copy}
                      onChange={(value) =>
                        setBatchParameterValues((current) => ({
                          ...current,
                          [definition.name]: value,
                        }))
                      }
                    />
                  ))}
                  <p>{copy.batchMacroHint}</p>
                </>
              ) : null}
            </fieldset>

            <fieldset disabled={disableActions || batchRunning}>
              <legend>
                {batchRecipe === 'fixed'
                  ? copy.resizeAndFormat
                  : copy.outputFormat}
              </legend>
              {batchRecipe === 'fixed' ? (
                <>
                  <label>
                    <span>{copy.widthPx}</span>
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
                    <span>{copy.heightPx}</span>
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
                    <span>{copy.fitMethod}</span>
                    <select
                      value={batchFit}
                      onChange={(event) =>
                        setBatchFit(
                          event.target.value as NonNullable<typeof batchFit>,
                        )
                      }
                    >
                      {Object.entries(fitLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}
              <label>
                <span>{copy.outputFormat}</span>
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
                <span>{copy.qualityPercent}</span>
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
                <legend>{copy.watermarkOptional}</legend>
                <label>
                  <span>{copy.watermarkText}</span>
                  <input
                    type="text"
                    value={watermarkText}
                    maxLength={4096}
                    placeholder={copy.watermarkPlaceholder}
                    onChange={(event) => setWatermarkText(event.target.value)}
                  />
                </label>
                <label>
                  <span>{copy.watermarkPosition}</span>
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
                    {watermarkPositions.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{copy.watermarkColor}</span>
                  <input
                    type="text"
                    value={watermarkColor}
                    disabled={!watermarkText}
                    onChange={(event) => setWatermarkColor(event.target.value)}
                  />
                </label>
                <label>
                  <span>{copy.watermarkOpacity}</span>
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
              <legend>{copy.destination}</legend>
              <label>
                <span>{copy.saveMethod}</span>
                <select
                  value={batchOutputMode}
                  onChange={(event) =>
                    setBatchOutputMode(
                      event.target.value as AutomationBatchOutputMode,
                    )
                  }
                >
                  {outputModeLabels.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit">{copy.startBatch}</button>
            </fieldset>
          </form>

          {batchProgress ? (
            <section aria-labelledby={`${id}-batch-progress-title`}>
              <h4 id={`${id}-batch-progress-title`}>{copy.progressHeading}</h4>
              <progress
                aria-label={copy.progressLabel}
                max={Math.max(1, batchProgress.total)}
                value={progressValue(batchProgress)}
              />
              <p aria-live="polite">
                {formatStudioMessage(copy.progressSummary, {
                  completed: batchProgress.completed,
                  failed: batchProgress.failed,
                  total: batchProgress.total,
                })}
                {batchProgress.active > 0
                  ? formatStudioMessage(copy.activeSummary, {
                      active: batchProgress.active,
                    })
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
              {cancellingBatch ? copy.cancelling : copy.cancelBatch}
            </button>
          ) : null}

          {batchFailures.length > 0 ? (
            <section aria-labelledby={`${id}-batch-failures-title`}>
              <h4 id={`${id}-batch-failures-title`}>{copy.failedFiles}</h4>
              <ul>
                {batchFailures.map((failure) => (
                  <li key={failure.id}>{formatFailure(failure, copy)}</li>
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
          <h3>{copy.iconHeading}</h3>
          <p>
            {copy.exportSource} <strong>{resolvedDocumentLabel}</strong>
          </p>

          <fieldset disabled={disableActions}>
            <legend>{copy.exportSizes}</legend>
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
                  {formatStudioMessage(copy.presetDimensions, {
                    label: preset.label,
                    width: preset.width,
                    height: preset.height,
                  })}
                </label>
                {!preset.builtIn ? (
                  <button
                    type="button"
                    aria-label={formatStudioMessage(copy.removePresetLabel, {
                      label: preset.label,
                    })}
                    onClick={() => removeUserPreset(preset)}
                  >
                    {copy.remove}
                  </button>
                ) : null}
              </div>
            ))}
          </fieldset>

          <form onSubmit={addUserPreset}>
            <fieldset disabled={disableActions}>
              <legend>{copy.addCustomPreset}</legend>
              <label>
                <span>{copy.presetName}</span>
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={presetLabel}
                  onChange={(event) => setPresetLabel(event.target.value)}
                />
              </label>
              <label>
                <span>{copy.widthPx}</span>
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
                <span>{copy.heightPx}</span>
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
                <span>{copy.fileName}</span>
                <input
                  type="text"
                  required
                  value={presetFileName}
                  pattern='[^<>:"/\\|?*]+\.png'
                  onChange={(event) => setPresetFileName(event.target.value)}
                />
              </label>
              <label>
                <span>{copy.fitMethod}</span>
                <select
                  value={presetFit}
                  onChange={(event) =>
                    setPresetFit(event.target.value as IconExportPreset['fit'])
                  }
                >
                  {Object.entries(fitLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{copy.backgroundColor}</span>
                <input
                  type="text"
                  required
                  value={presetBackground}
                  onChange={(event) => setPresetBackground(event.target.value)}
                />
              </label>
              <button type="submit">{copy.addPreset}</button>
            </fieldset>
          </form>

          <fieldset disabled={disableActions}>
            <legend>{copy.iconDestination}</legend>
            <label>
              <span>{copy.saveMethod}</span>
              <select
                value={iconOutputMode}
                onChange={(event) =>
                  setIconOutputMode(
                    event.target.value as AutomationBatchOutputMode,
                  )
                }
              >
                {outputModeLabels.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={exportIcons}>
              {copy.exportSelectedPresets}
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
