import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import {
  floodFillSelection,
  rasterizePolygonSelection,
  type SelectionPoint,
} from '../selection/algorithms'
import { SelectionMask } from '../selection/mask'
import {
  combineSelectionMasks,
  dilateSelectionMask,
  erodeSelectionMask,
  featherSelectionMask,
  invertSelectionMask,
  type SelectionCombineMode,
} from '../selection/operations'
import { SelectionWorkerClient } from '../selection/workerClient'
import LassoSelectionCanvas from '../selection/LassoSelectionCanvas'
import {
  removeBackground,
  type BackgroundSegmentationAdapter,
  type SegmentationContext,
} from '../background/segmentation'
import { BackgroundWorkerClient } from '../background/workerClient'
import type { BackgroundWorkerModelRequest } from '../background/workerProtocol'
import {
  LocalMacroRepository,
  type KeyValueStorage,
  type MacroRepository,
  type MacroRepositoryEntry,
} from '../automation/macroRepository'
import { parseEditorScript } from '../scripting/parser'
import {
  createSavedEditorScript,
  LocalScriptRepository,
  registerSavedScriptAsMacro,
  type ScriptRepository,
} from '../scripting'
import type { EditorScriptCommand } from '../scripting/types'
import {
  formatStudioMessage,
  getStudioComponentCopy,
  type StudioComponentCopy,
} from '../i18n.studio-components'
import type { AppLocale } from '../uiPreferences'

type AdvancedToolsTab = 'selection' | 'background' | 'script'

export interface AdvancedToolsStatus {
  kind: 'info' | 'success' | 'warning' | 'error'
  message: string
}

/**
 * A model is loaded only after the panel's explicit consent checkbox is set.
 * The parent owns download, checksum verification, OPFS caching, and adapter
 * construction, keeping those policies outside the presentation component.
 */
export interface AdvancedBackgroundModel {
  id: string
  label: string
  sizeBytes: number
  load(context: SegmentationContext): Promise<BackgroundSegmentationAdapter>
  workerModel?: Omit<BackgroundWorkerModelRequest, 'consentGranted'>
  revoke?(removeCachedModel?: boolean): Promise<void>
}

export interface AdvancedToolsPanelProps {
  documentWidth: number
  documentHeight: number
  getDocumentImageData(): Promise<ImageData>
  selectionMask?: SelectionMask
  onSelectionMask(mask: SelectionMask | undefined): void
  onBackgroundResult(result: ImageData, mask: SelectionMask): void
  onScriptCommands(commands: EditorScriptCommand[]): void
  onMacroRegistered?(entry: MacroRepositoryEntry): void
  onStatus?(status: AdvancedToolsStatus): void
  backgroundModel?: AdvancedBackgroundModel
  scriptRepository?: ScriptRepository
  macroRepository?: MacroRepository
  locale?: AppLocale
}

const TAB_ORDER: readonly AdvancedToolsTab[] = [
  'selection',
  'background',
  'script',
]

const SCRIPT_EXAMPLES = {
  resize: `editor.resize(1200, 630);`,
  watermark: `editor.addText("Pixelweave", {
  left: 40,
  top: 40,
  fill: "#ffffff",
  fontSize: 48
});`,
  filter: `editor.applyFilter("sepia", { amount: 0.45 });`,
  layers: `editor.forEachLayer(layer => {
  editor.applyFilter("sharpen", { amount: 0.4 }, layer.id);
});`,
} as const

type AdvancedToolsCopy = StudioComponentCopy['advancedTools']

const formatBytes = (bytes: number, copy: AdvancedToolsCopy): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return copy.unknownSize
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const memoryStorage = (): KeyValueStorage => {
  const entries = new Map<string, string>()
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value)
    },
    removeItem: (key) => {
      entries.delete(key)
    },
  }
}

const createDefaultMacroRepository = (): MacroRepository => {
  try {
    return new LocalMacroRepository(globalThis.localStorage)
  } catch {
    return new LocalMacroRepository(memoryStorage())
  }
}

const abortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError'

const parseInteger = (
  value: string,
  minimum: number,
  maximum: number,
  label: string,
  copy: AdvancedToolsCopy,
): number => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(
      formatStudioMessage(copy.integerRange, { label, minimum, maximum }),
    )
  }
  return parsed
}

const parsePolygonPoints = (
  source: string,
  copy: AdvancedToolsCopy,
): SelectionPoint[] => {
  const lines = source
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 3 || lines.length > 10_000) {
    throw new RangeError(copy.polygonPointRange)
  }
  return lines.map((line, index) => {
    const match = line.match(
      /^(-?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*(-?(?:\d+(?:\.\d*)?|\.\d+))$/,
    )
    if (!match) {
      throw new RangeError(
        formatStudioMessage(copy.polygonLineFormat, { line: index + 1 }),
      )
    }
    const x = Number(match[1])
    const y = Number(match[2])
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError(
        formatStudioMessage(copy.polygonInvalidCoordinate, { line: index + 1 }),
      )
    }
    return { x, y }
  })
}

export function AdvancedToolsPanel({
  documentWidth,
  documentHeight,
  getDocumentImageData,
  selectionMask,
  onSelectionMask,
  onBackgroundResult,
  onScriptCommands,
  onMacroRegistered,
  onStatus,
  backgroundModel,
  scriptRepository: suppliedScriptRepository,
  macroRepository: suppliedMacroRepository,
  locale = 'ja',
}: AdvancedToolsPanelProps) {
  const copy = getStudioComponentCopy(locale).advancedTools
  const tabLabels: Record<AdvancedToolsTab, string> = {
    selection: copy.tabSelection,
    background: copy.tabBackground,
    script: copy.tabScript,
  }
  const id = useId()
  const [activeTab, setActiveTab] = useState<AdvancedToolsTab>('selection')
  const tabRefs = useRef<Partial<Record<AdvancedToolsTab, HTMLButtonElement>>>(
    {},
  )
  const [status, setStatus] = useState<AdvancedToolsStatus>({
    kind: 'info',
    message: copy.ready,
  })

  const [combineMode, setCombineMode] =
    useState<SelectionCombineMode>('replace')
  const [wandX, setWandX] = useState('0')
  const [wandY, setWandY] = useState('0')
  const [wandTolerance, setWandTolerance] = useState('24')
  const [polygonPoints, setPolygonPoints] = useState(
    `0,0\n${documentWidth},0\n${documentWidth},${documentHeight}\n0,${documentHeight}`,
  )
  const [selectionRadius, setSelectionRadius] = useState('4')
  const [selectionBusy, setSelectionBusy] = useState(false)
  const [selectionPreview, setSelectionPreview] = useState<ImageData>()

  const [useModel, setUseModel] = useState(Boolean(backgroundModel))
  const [modelConsent, setModelConsent] = useState(false)
  const [modelStorageBusy, setModelStorageBusy] = useState(false)
  const [allowModelFallback, setAllowModelFallback] = useState(true)
  const [backgroundBusy, setBackgroundBusy] = useState(false)
  const [backgroundProgress, setBackgroundProgress] = useState(0)
  const backgroundAbortRef = useRef<AbortController | null>(null)
  const backgroundRunGenerationRef = useRef(0)

  const [script, setScript] = useState<string>(SCRIPT_EXAMPLES.filter)
  const scriptRepository = useMemo(
    () => suppliedScriptRepository ?? new LocalScriptRepository(),
    [suppliedScriptRepository],
  )
  const macroRepository = useMemo(
    () => suppliedMacroRepository ?? createDefaultMacroRepository(),
    [suppliedMacroRepository],
  )
  const [savedScripts, setSavedScripts] = useState(() =>
    scriptRepository.list(),
  )
  const [selectedScriptId, setSelectedScriptId] = useState('')
  const [scriptName, setScriptName] = useState(copy.newScript)

  useEffect(() => {
    if (activeTab !== 'selection') return
    let active = true
    void getDocumentImageData()
      .then((image) => {
        if (
          active &&
          image.width === documentWidth &&
          image.height === documentHeight
        ) {
          setSelectionPreview(image)
        }
      })
      .catch(() => {
        if (active) setSelectionPreview(undefined)
      })
    return () => {
      active = false
    }
  }, [
    activeTab,
    documentHeight,
    documentWidth,
    getDocumentImageData,
    selectionMask,
  ])

  useEffect(
    () => () => {
      backgroundRunGenerationRef.current += 1
      backgroundAbortRef.current?.abort()
      backgroundAbortRef.current = null
    },
    [],
  )

  useEffect(() => {
    setModelConsent(false)
  }, [backgroundModel?.id])

  const report = (next: AdvancedToolsStatus): void => {
    setStatus(next)
    onStatus?.(next)
  }

  const documentPixels = async () => {
    const image = await getDocumentImageData()
    if (
      image.width !== documentWidth ||
      image.height !== documentHeight ||
      image.data.length !== documentWidth * documentHeight * 4
    ) {
      throw new RangeError(copy.imageDimensionMismatch)
    }
    return {
      width: image.width,
      height: image.height,
      data: image.data,
    }
  }

  const checkedCurrentMask = (): SelectionMask | undefined => {
    if (
      selectionMask &&
      (selectionMask.width !== documentWidth ||
        selectionMask.height !== documentHeight)
    ) {
      throw new RangeError(copy.currentMaskDimensionMismatch)
    }
    return selectionMask
  }

  const emitIncomingMask = (
    incoming: SelectionMask,
    mode: SelectionCombineMode = combineMode,
  ): void => {
    if (
      incoming.width !== documentWidth ||
      incoming.height !== documentHeight
    ) {
      throw new RangeError(copy.incomingMaskDimensionMismatch)
    }
    const current = checkedCurrentMask()
    const next =
      mode === 'replace'
        ? incoming
        : combineSelectionMasks(
            current ?? SelectionMask.empty(documentWidth, documentHeight),
            incoming,
            mode,
          )
    onSelectionMask(next)
  }

  const runMagicWand = async (): Promise<void> => {
    if (selectionBusy) return
    setSelectionBusy(true)
    try {
      const x = parseInteger(
        wandX,
        0,
        documentWidth - 1,
        copy.xCoordinate,
        copy,
      )
      const y = parseInteger(
        wandY,
        0,
        documentHeight - 1,
        copy.yCoordinate,
        copy,
      )
      const tolerance = parseInteger(
        wandTolerance,
        0,
        255,
        copy.tolerance,
        copy,
      )
      const image = await documentPixels()
      const incoming =
        typeof Worker === 'undefined'
          ? floodFillSelection(image, x, y, {
              tolerance,
              connectivity: 4,
              includeAlpha: true,
            })
          : await (async () => {
              const client = new SelectionWorkerClient(
                new Worker(
                  new URL('../selection/selection.worker.ts', import.meta.url),
                  { type: 'module' },
                ),
              )
              try {
                return await client.run(
                  {
                    kind: 'flood-fill',
                    image,
                    seedX: x,
                    seedY: y,
                    tolerance,
                    connectivity: 4,
                    includeAlpha: true,
                  },
                  undefined,
                  { transferOwnership: true },
                )
              } finally {
                client.dispose()
              }
            })()
      emitIncomingMask(incoming)
      report({
        kind: 'success',
        message: copy.magicWandUpdated,
      })
    } catch (error) {
      report({
        kind: 'error',
        message: error instanceof Error ? error.message : copy.magicWandFailed,
      })
    } finally {
      setSelectionBusy(false)
    }
  }

  const applyPolygonSelection = (
    points: readonly SelectionPoint[],
    source: 'polygon' | 'lasso',
    mode: SelectionCombineMode = combineMode,
  ): void => {
    try {
      const incoming = rasterizePolygonSelection(
        documentWidth,
        documentHeight,
        points,
        { samplesPerAxis: 2 },
      )
      emitIncomingMask(incoming, mode)
      report({
        kind: 'success',
        message: source === 'lasso' ? copy.lassoUpdated : copy.polygonUpdated,
      })
    } catch (error) {
      report({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : source === 'lasso'
              ? copy.lassoFailed
              : copy.polygonFailed,
      })
    }
  }

  const runPolygon = (): void => {
    try {
      applyPolygonSelection(parsePolygonPoints(polygonPoints, copy), 'polygon')
    } catch (error) {
      report({
        kind: 'error',
        message: error instanceof Error ? error.message : copy.polygonFailed,
      })
    }
  }

  const runLasso = (
    points: readonly SelectionPoint[],
    modifier?: 'add' | 'subtract',
  ): void => {
    setPolygonPoints(
      points
        .map(({ x, y }) => `${Number(x.toFixed(2))},${Number(y.toFixed(2))}`)
        .join('\n'),
    )
    applyPolygonSelection(points, 'lasso', modifier ?? combineMode)
  }

  const transformSelection = (
    operation: 'feather' | 'grow' | 'shrink' | 'invert',
  ): void => {
    try {
      const current = checkedCurrentMask()
      if (!current) {
        throw new Error(copy.selectionRequired)
      }
      let next: SelectionMask
      switch (operation) {
        case 'feather':
          next = featherSelectionMask(
            current,
            parseInteger(selectionRadius, 0, 256, copy.adjustmentRadius, copy),
          )
          break
        case 'grow':
          next = dilateSelectionMask(
            current,
            parseInteger(selectionRadius, 0, 128, copy.adjustmentRadius, copy),
          )
          break
        case 'shrink':
          next = erodeSelectionMask(
            current,
            parseInteger(selectionRadius, 0, 128, copy.adjustmentRadius, copy),
          )
          break
        case 'invert':
          next = invertSelectionMask(current)
          break
      }
      onSelectionMask(next)
      report({
        kind: 'success',
        message: copy.selectionAdjusted,
      })
    } catch (error) {
      report({
        kind: 'error',
        message:
          error instanceof Error ? error.message : copy.selectionAdjustFailed,
      })
    }
  }

  const runBackgroundRemoval = async (): Promise<void> => {
    if (backgroundBusy || backgroundAbortRef.current) return
    if (useModel && (!backgroundModel || !modelConsent)) {
      report({
        kind: 'error',
        message: copy.modelConsentRequired,
      })
      return
    }

    const controller = new AbortController()
    const generation = backgroundRunGenerationRef.current + 1
    backgroundRunGenerationRef.current = generation
    backgroundAbortRef.current = controller
    const isCurrentGeneration = (): boolean =>
      backgroundRunGenerationRef.current === generation
    const canPublishProgress = (): boolean =>
      isCurrentGeneration() && !controller.signal.aborted
    setBackgroundBusy(true)
    setBackgroundProgress(0)
    try {
      const image = await documentPixels()
      let adapter: BackgroundSegmentationAdapter | undefined
      const workerModel = useModel ? backgroundModel?.workerModel : undefined
      const useBackgroundWorker =
        typeof Worker !== 'undefined' && (!useModel || Boolean(workerModel))
      if (useModel && backgroundModel && !useBackgroundWorker) {
        adapter = await backgroundModel.load({
          signal: controller.signal,
          reportProgress: (progress) => {
            if (canPublishProgress()) {
              setBackgroundProgress(
                Math.max(0, Math.min(0.25, progress * 0.25)),
              )
            }
          },
        })
      }
      const onProgress = (progress: number): void => {
        if (!canPublishProgress()) return
        const base = adapter ? 0.25 : 0
        setBackgroundProgress(
          Math.max(0, Math.min(1, base + progress * (1 - base))),
        )
      }
      const result = useBackgroundWorker
        ? await (async () => {
            const client = new BackgroundWorkerClient(
              new Worker(
                new URL('../background/background.worker.ts', import.meta.url),
                { type: 'module' },
              ),
            )
            try {
              return await client.run(
                {
                  image,
                  options: {
                    fallbackOnModelError: allowModelFallback,
                  },
                  ...(workerModel
                    ? {
                        model: {
                          ...workerModel,
                          consentGranted: modelConsent,
                        },
                      }
                    : {}),
                },
                {
                  signal: controller.signal,
                  onProgress: (progress) => onProgress(progress),
                  transferOwnership: true,
                },
              )
            } finally {
              client.dispose()
            }
          })()
        : await removeBackground(
            image,
            {
              fallbackOnModelError: allowModelFallback,
            },
            {
              signal: controller.signal,
              reportProgress: (progress) => onProgress(progress),
            },
            adapter,
          )
      if (!canPublishProgress()) {
        throw new DOMException('Aborted', 'AbortError')
      }
      onBackgroundResult(
        new ImageData(
          new Uint8ClampedArray(result.rgba),
          result.width,
          result.height,
        ),
        result.mask,
      )
      report({
        kind: result.warning ? 'warning' : 'success',
        message:
          result.source === 'model'
            ? copy.backgroundRemovedModel
            : result.warning
              ? formatStudioMessage(copy.backgroundFallbackWarning, {
                  warning: result.warning,
                })
              : copy.backgroundRemovedHeuristic,
      })
    } catch (error) {
      if (!isCurrentGeneration()) return
      report(
        abortError(error)
          ? { kind: 'info', message: copy.backgroundCancelled }
          : {
              kind: 'error',
              message:
                error instanceof Error ? error.message : copy.backgroundFailed,
            },
      )
    } finally {
      if (backgroundAbortRef.current === controller) {
        backgroundAbortRef.current = null
        if (isCurrentGeneration()) {
          setBackgroundBusy(false)
          setModelConsent(false)
        }
      }
    }
  }

  const clearBackgroundModelStorage = async (): Promise<void> => {
    if (!backgroundModel?.revoke || modelStorageBusy) return
    setModelStorageBusy(true)
    try {
      await backgroundModel.revoke(true)
      setModelConsent(false)
      report({
        kind: 'success',
        message: copy.modelCacheDeleted,
      })
    } catch (error) {
      report({
        kind: 'error',
        message:
          error instanceof Error
            ? formatStudioMessage(copy.modelCacheDeleteFailedDetail, {
                message: error.message,
              })
            : copy.modelCacheDeleteFailed,
      })
    } finally {
      setModelStorageBusy(false)
    }
  }

  const refreshSavedScripts = (): void => {
    setSavedScripts(scriptRepository.list())
  }

  const saveScript = (): void => {
    try {
      const existing = selectedScriptId
        ? scriptRepository.get(selectedScriptId)
        : null
      const now = new Date().toISOString()
      const saved = createSavedEditorScript({
        appVersion: '0.1.0',
        id: existing?.script.id ?? `script-${Date.now().toString(36)}`,
        name: scriptName,
        source: script,
        createdAt: existing?.script.createdAt ?? now,
        updatedAt: now,
      })
      const result = scriptRepository.save(saved)
      setSelectedScriptId(result.script.id)
      refreshSavedScripts()
      report({
        kind: result.persisted ? 'success' : 'warning',
        message: result.persisted
          ? formatStudioMessage(copy.scriptSavedDevice, {
              name: result.script.name,
            })
          : formatStudioMessage(copy.scriptSavedSession, {
              name: result.script.name,
            }),
      })
    } catch (error) {
      report({
        kind: 'error',
        message:
          error instanceof Error
            ? formatStudioMessage(copy.scriptSaveFailedDetail, {
                message: error.message,
              })
            : copy.scriptSaveFailed,
      })
    }
  }

  const loadSelectedScript = (): void => {
    const entry = scriptRepository.get(selectedScriptId)
    if (!entry) {
      report({
        kind: 'warning',
        message: copy.selectScriptToLoad,
      })
      return
    }
    setScriptName(entry.script.name)
    setScript(entry.script.source)
    report({
      kind: 'success',
      message: formatStudioMessage(copy.scriptLoaded, {
        name: entry.script.name,
      }),
    })
  }

  const deleteSelectedScript = (): void => {
    const entry = scriptRepository.get(selectedScriptId)
    if (!entry || !scriptRepository.remove(selectedScriptId)) {
      report({
        kind: 'warning',
        message: copy.selectScriptToDelete,
      })
      return
    }
    setSelectedScriptId('')
    refreshSavedScripts()
    report({
      kind: 'success',
      message: formatStudioMessage(copy.scriptDeleted, {
        name: entry.script.name,
      }),
    })
  }

  const registerSelectedScriptAsMacro = (): void => {
    const entry = scriptRepository.get(selectedScriptId)
    if (!entry) {
      report({
        kind: 'warning',
        message: copy.selectScriptToRegister,
      })
      return
    }
    try {
      const macro = registerSavedScriptAsMacro(
        scriptRepository,
        macroRepository,
        {
          scriptId: entry.script.id,
          appVersion: '0.1.0',
          id: entry.script.id,
          name: entry.script.name,
          updatedAt: new Date().toISOString(),
        },
      )
      onMacroRegistered?.({ macro, diagnostics: [] })
      report({
        kind: 'success',
        message: formatStudioMessage(copy.scriptRegistered, {
          name: entry.script.name,
        }),
      })
    } catch (error) {
      report({
        kind: 'error',
        message:
          error instanceof Error
            ? formatStudioMessage(copy.registerFailedDetail, {
                message: error.message,
              })
            : copy.registerFailed,
      })
    }
  }

  const runScript = (): void => {
    try {
      const program = parseEditorScript(script)
      onScriptCommands(program.commands)
      report({
        kind: 'success',
        message: formatStudioMessage(copy.commandsCreated, {
          count: program.commands.length,
        }),
      })
    } catch (error) {
      report({
        kind: 'error',
        message:
          error instanceof Error ? error.message : copy.scriptParseFailed,
      })
    }
  }

  const handleTabKey = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    tab: AdvancedToolsTab,
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

  const statusRole = status.kind === 'error' ? 'alert' : 'status'

  return (
    <section className="advanced-tools-panel" aria-labelledby={`${id}-title`}>
      <header>
        <p>LOCAL ADVANCED TOOLS</p>
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

      {activeTab === 'selection' ? (
        <div
          id={`${id}-selection-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-selection-tab`}
        >
          <h3>{copy.selectionHeading}</h3>
          <p>{copy.selectionDescription}</p>

          <label>
            <span>{copy.combineMethod}</span>
            <select
              value={combineMode}
              onChange={(event) =>
                setCombineMode(event.target.value as SelectionCombineMode)
              }
            >
              <option value="replace">{copy.replace}</option>
              <option value="add">{copy.add}</option>
              <option value="subtract">{copy.subtract}</option>
              <option value="intersect">{copy.intersect}</option>
            </select>
          </label>

          <fieldset>
            <legend>{copy.magicWand}</legend>
            <label>
              <span>{copy.xCoordinate}</span>
              <input
                type="number"
                min="0"
                max={Math.max(0, documentWidth - 1)}
                value={wandX}
                onChange={(event) => setWandX(event.target.value)}
              />
            </label>
            <label>
              <span>{copy.yCoordinate}</span>
              <input
                type="number"
                min="0"
                max={Math.max(0, documentHeight - 1)}
                value={wandY}
                onChange={(event) => setWandY(event.target.value)}
              />
            </label>
            <label>
              <span>{copy.tolerance}</span>
              <input
                type="number"
                min="0"
                max="255"
                value={wandTolerance}
                onChange={(event) => setWandTolerance(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={selectionBusy}
              onClick={() => void runMagicWand()}
            >
              {selectionBusy ? copy.selecting : copy.runMagicWand}
            </button>
          </fieldset>

          <fieldset>
            <legend>{copy.polygonAndLasso}</legend>
            <LassoSelectionCanvas
              documentWidth={documentWidth}
              documentHeight={documentHeight}
              previewImage={selectionPreview}
              selectionMask={selectionMask}
              disabled={selectionBusy}
              locale={locale}
              onComplete={runLasso}
              onIncomplete={() =>
                report({
                  kind: 'info',
                  message: copy.lassoNeedsPoints,
                })
              }
            />
            <label>
              <span>{copy.vertexCoordinates}</span>
              <textarea
                rows={6}
                value={polygonPoints}
                onChange={(event) => setPolygonPoints(event.target.value)}
              />
            </label>
            <button type="button" onClick={runPolygon}>
              {copy.runPolygon}
            </button>
          </fieldset>

          <fieldset>
            <legend>{copy.adjustSelection}</legend>
            <label>
              <span>{copy.adjustmentRadius}</span>
              <input
                type="number"
                min="0"
                max="256"
                value={selectionRadius}
                onChange={(event) => setSelectionRadius(event.target.value)}
              />
            </label>
            <div role="group" aria-label={copy.adjustmentActions}>
              <button
                type="button"
                onClick={() => transformSelection('feather')}
              >
                {copy.feather}
              </button>
              <button type="button" onClick={() => transformSelection('grow')}>
                {copy.grow}
              </button>
              <button
                type="button"
                onClick={() => transformSelection('shrink')}
              >
                {copy.shrink}
              </button>
              <button
                type="button"
                onClick={() => transformSelection('invert')}
              >
                {copy.invert}
              </button>
              <button
                type="button"
                onClick={() => {
                  onSelectionMask(undefined)
                  report({
                    kind: 'success',
                    message: copy.selectionCleared,
                  })
                }}
              >
                {copy.clear}
              </button>
            </div>
          </fieldset>
        </div>
      ) : null}

      {activeTab === 'background' ? (
        <div
          id={`${id}-background-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-background-tab`}
        >
          <h3>{copy.backgroundHeading}</h3>
          <p>{copy.backgroundDescription}</p>

          {backgroundModel ? (
            <fieldset>
              <legend>{copy.localModel}</legend>
              <p>
                {formatStudioMessage(copy.modelDescription, {
                  label: backgroundModel.label,
                  size: formatBytes(backgroundModel.sizeBytes, copy),
                })}
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={useModel}
                  onChange={(event) => setUseModel(event.target.checked)}
                />
                {copy.useLocalModel}
              </label>
              {useModel ? (
                <label>
                  <input
                    type="checkbox"
                    checked={modelConsent}
                    disabled={backgroundBusy}
                    onChange={(event) => setModelConsent(event.target.checked)}
                  />
                  {copy.modelConsent}
                </label>
              ) : null}
              <label>
                <input
                  type="checkbox"
                  checked={allowModelFallback}
                  onChange={(event) =>
                    setAllowModelFallback(event.target.checked)
                  }
                />
                {copy.allowFallback}
              </label>
              {backgroundModel.revoke ? (
                <div>
                  <p aria-live="polite">{copy.consentAndCacheDescription}</p>
                  <button
                    type="button"
                    disabled={backgroundBusy || modelStorageBusy}
                    onClick={() => void clearBackgroundModelStorage()}
                  >
                    {modelStorageBusy
                      ? copy.deletingModel
                      : copy.deleteConsentAndCache}
                  </button>
                </div>
              ) : null}
            </fieldset>
          ) : (
            <p>{copy.noModel}</p>
          )}

          {backgroundBusy ? (
            <div>
              <progress
                aria-label={copy.backgroundProgress}
                max="1"
                value={backgroundProgress}
              />
              <button
                type="button"
                onClick={() => backgroundAbortRef.current?.abort()}
              >
                {copy.cancelBackground}
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={useModel && (!backgroundModel || !modelConsent)}
              onClick={() => void runBackgroundRemoval()}
            >
              {copy.removeBackground}
            </button>
          )}
        </div>
      ) : null}

      {activeTab === 'script' ? (
        <div
          id={`${id}-script-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-script-tab`}
        >
          <h3>{copy.scriptHeading}</h3>
          <p>
            {copy.scriptDescriptionBefore} <code>editor.*</code>
            {copy.scriptDescriptionMiddle} <code>fetch</code>
            {copy.scriptCodeSeparator}
            <code>document</code>
            {copy.scriptDescriptionAfter}
          </p>
          <label>
            <span>{copy.scriptExample}</span>
            <select
              defaultValue="filter"
              onChange={(event) =>
                setScript(
                  SCRIPT_EXAMPLES[
                    event.target.value as keyof typeof SCRIPT_EXAMPLES
                  ],
                )
              }
            >
              <option value="resize">{copy.exampleResize}</option>
              <option value="watermark">{copy.exampleWatermark}</option>
              <option value="filter">{copy.exampleFilter}</option>
              <option value="layers">{copy.exampleLayers}</option>
            </select>
          </label>
          <fieldset>
            <legend>{copy.savedScriptGroup}</legend>
            <label>
              <span>{copy.savedScripts}</span>
              <select
                value={selectedScriptId}
                onChange={(event) => setSelectedScriptId(event.target.value)}
              >
                <option value="">{copy.select}</option>
                {savedScripts.map(({ script: saved }) => (
                  <option key={saved.id} value={saved.id}>
                    {saved.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{copy.scriptName}</span>
              <input
                value={scriptName}
                maxLength={128}
                onChange={(event) => setScriptName(event.target.value)}
              />
            </label>
            <div role="group" aria-label={copy.savedScriptActions}>
              <button type="button" onClick={saveScript}>
                {copy.save}
              </button>
              <button
                type="button"
                disabled={!selectedScriptId}
                onClick={loadSelectedScript}
              >
                {copy.load}
              </button>
              <button
                type="button"
                disabled={!selectedScriptId}
                onClick={deleteSelectedScript}
              >
                {copy.delete}
              </button>
              <button
                type="button"
                disabled={!selectedScriptId}
                onClick={registerSelectedScriptAsMacro}
              >
                {copy.registerMacro}
              </button>
            </div>
          </fieldset>
          <label>
            <span>{copy.editorScript}</span>
            <textarea
              rows={12}
              spellCheck={false}
              value={script}
              onChange={(event) => setScript(event.target.value)}
            />
          </label>
          <button type="button" onClick={runScript}>
            {copy.verifyAndRun}
          </button>
        </div>
      ) : null}

      <p
        role={statusRole}
        aria-live={status.kind === 'error' ? 'assertive' : 'polite'}
        aria-atomic="true"
      >
        {status.message}
      </p>
    </section>
  )
}

export default AdvancedToolsPanel
