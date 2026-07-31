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
}

const TAB_ORDER: readonly AdvancedToolsTab[] = [
  'selection',
  'background',
  'script',
]

const TAB_LABELS: Record<AdvancedToolsTab, string> = {
  selection: '選択範囲',
  background: '背景除去',
  script: 'スクリプト',
}

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

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return 'サイズ不明'
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
): number => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(
      `${label}は${minimum}から${maximum}までの整数で指定してください。`,
    )
  }
  return parsed
}

const parsePolygonPoints = (source: string): SelectionPoint[] => {
  const lines = source
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 3 || lines.length > 10_000) {
    throw new RangeError('多角形には3点以上10,000点以下が必要です。')
  }
  return lines.map((line, index) => {
    const match = line.match(
      /^(-?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*(-?(?:\d+(?:\.\d*)?|\.\d+))$/,
    )
    if (!match) {
      throw new RangeError(
        `${index + 1}行目を「X,Y」の形式で入力してください。`,
      )
    }
    const x = Number(match[1])
    const y = Number(match[2])
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError(`${index + 1}行目の座標が不正です。`)
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
}: AdvancedToolsPanelProps) {
  const id = useId()
  const [activeTab, setActiveTab] = useState<AdvancedToolsTab>('selection')
  const tabRefs = useRef<Partial<Record<AdvancedToolsTab, HTMLButtonElement>>>(
    {},
  )
  const [status, setStatus] = useState<AdvancedToolsStatus>({
    kind: 'info',
    message: '高度ツールの準備ができました。',
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
  const [scriptName, setScriptName] = useState('新しいスクリプト')

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
      throw new RangeError(
        '取得した画像データの寸法がドキュメントと一致しません。',
      )
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
      throw new RangeError(
        '現在の選択マスクの寸法がドキュメントと一致しません。',
      )
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
      throw new RangeError(
        '新しい選択マスクの寸法がドキュメントと一致しません。',
      )
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
      const x = parseInteger(wandX, 0, documentWidth - 1, 'X座標')
      const y = parseInteger(wandY, 0, documentHeight - 1, 'Y座標')
      const tolerance = parseInteger(wandTolerance, 0, 255, '許容値')
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
        message: '自動選択を更新しました。',
      })
    } catch (error) {
      report({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : '自動選択を完了できませんでした。',
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
        message:
          source === 'lasso'
            ? 'なげなわ選択を更新しました。'
            : '多角形選択を更新しました。',
      })
    } catch (error) {
      report({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : source === 'lasso'
              ? 'なげなわ選択を完了できませんでした。'
              : '多角形選択を完了できませんでした。',
      })
    }
  }

  const runPolygon = (): void => {
    try {
      applyPolygonSelection(parsePolygonPoints(polygonPoints), 'polygon')
    } catch (error) {
      report({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : '多角形選択を完了できませんでした。',
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
        throw new Error('先に選択範囲を作成してください。')
      }
      let next: SelectionMask
      switch (operation) {
        case 'feather':
          next = featherSelectionMask(
            current,
            parseInteger(selectionRadius, 0, 256, '調整半径'),
          )
          break
        case 'grow':
          next = dilateSelectionMask(
            current,
            parseInteger(selectionRadius, 0, 128, '調整半径'),
          )
          break
        case 'shrink':
          next = erodeSelectionMask(
            current,
            parseInteger(selectionRadius, 0, 128, '調整半径'),
          )
          break
        case 'invert':
          next = invertSelectionMask(current)
          break
      }
      onSelectionMask(next)
      report({
        kind: 'success',
        message: '選択範囲を調整しました。',
      })
    } catch (error) {
      report({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : '選択範囲を調整できませんでした。',
      })
    }
  }

  const runBackgroundRemoval = async (): Promise<void> => {
    if (backgroundBusy || backgroundAbortRef.current) return
    if (useModel && (!backgroundModel || !modelConsent)) {
      report({
        kind: 'error',
        message: 'ローカルAIモデルを使うには明示的な同意が必要です。',
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
            ? 'ローカルAIモデルで背景を除去しました。'
            : result.warning
              ? `モデル処理に失敗したため簡易推定を使用しました。${result.warning}`
              : 'モデルを使わない簡易推定で背景を除去しました。',
      })
    } catch (error) {
      if (!isCurrentGeneration()) return
      report(
        abortError(error)
          ? { kind: 'info', message: '背景除去をキャンセルしました。' }
          : {
              kind: 'error',
              message:
                error instanceof Error
                  ? error.message
                  : '背景除去を完了できませんでした。',
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
        message: '実行同意を取り消し、端末内モデルキャッシュを削除しました。',
      })
    } catch (error) {
      report({
        kind: 'error',
        message:
          error instanceof Error
            ? `モデルデータを削除できませんでした: ${error.message}`
            : 'モデルデータを削除できませんでした。',
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
          ? `スクリプト「${result.script.name}」を端末へ保存しました。`
          : `スクリプト「${result.script.name}」をこのセッションへ保存しました。`,
      })
    } catch (error) {
      report({
        kind: 'error',
        message:
          error instanceof Error
            ? `スクリプトを保存できませんでした: ${error.message}`
            : 'スクリプトを保存できませんでした。',
      })
    }
  }

  const loadSelectedScript = (): void => {
    const entry = scriptRepository.get(selectedScriptId)
    if (!entry) {
      report({
        kind: 'warning',
        message: '読み込む保存済みスクリプトを選択してください。',
      })
      return
    }
    setScriptName(entry.script.name)
    setScript(entry.script.source)
    report({
      kind: 'success',
      message: `スクリプト「${entry.script.name}」を読み込みました。`,
    })
  }

  const deleteSelectedScript = (): void => {
    const entry = scriptRepository.get(selectedScriptId)
    if (!entry || !scriptRepository.remove(selectedScriptId)) {
      report({
        kind: 'warning',
        message: '削除する保存済みスクリプトを選択してください。',
      })
      return
    }
    setSelectedScriptId('')
    refreshSavedScripts()
    report({
      kind: 'success',
      message: `スクリプト「${entry.script.name}」を削除しました。`,
    })
  }

  const registerSelectedScriptAsMacro = (): void => {
    const entry = scriptRepository.get(selectedScriptId)
    if (!entry) {
      report({
        kind: 'warning',
        message: 'マクロへ登録する保存済みスクリプトを選択してください。',
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
        message: `スクリプト「${entry.script.name}」をマクロへ登録しました。`,
      })
    } catch (error) {
      report({
        kind: 'error',
        message:
          error instanceof Error
            ? `マクロへ登録できませんでした: ${error.message}`
            : 'マクロへ登録できませんでした。',
      })
    }
  }

  const runScript = (): void => {
    try {
      const program = parseEditorScript(script)
      onScriptCommands(program.commands)
      report({
        kind: 'success',
        message: `${program.commands.length}件の安全なコマンドを作成しました。`,
      })
    } catch (error) {
      report({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'スクリプトを解析できませんでした。',
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
        <h2 id={`${id}-title`}>高度ツール</h2>
      </header>

      <div role="tablist" aria-label="高度ツールのカテゴリ">
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

      {activeTab === 'selection' ? (
        <div
          id={`${id}-selection-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-selection-tab`}
        >
          <h3>選択マスク</h3>
          <p>
            8bitの選択マスクをドキュメント座標で作成します。画像データは端末外へ送信しません。
          </p>

          <label>
            <span>選択範囲の合成方法</span>
            <select
              value={combineMode}
              onChange={(event) =>
                setCombineMode(event.target.value as SelectionCombineMode)
              }
            >
              <option value="replace">置き換え</option>
              <option value="add">追加</option>
              <option value="subtract">除外</option>
              <option value="intersect">交差</option>
            </select>
          </label>

          <fieldset>
            <legend>自動選択（マジックワンド）</legend>
            <label>
              <span>X座標</span>
              <input
                type="number"
                min="0"
                max={Math.max(0, documentWidth - 1)}
                value={wandX}
                onChange={(event) => setWandX(event.target.value)}
              />
            </label>
            <label>
              <span>Y座標</span>
              <input
                type="number"
                min="0"
                max={Math.max(0, documentHeight - 1)}
                value={wandY}
                onChange={(event) => setWandY(event.target.value)}
              />
            </label>
            <label>
              <span>許容値</span>
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
              {selectionBusy ? '選択中…' : '自動選択を実行'}
            </button>
          </fieldset>

          <fieldset>
            <legend>多角形・なげなわ選択</legend>
            <LassoSelectionCanvas
              documentWidth={documentWidth}
              documentHeight={documentHeight}
              previewImage={selectionPreview}
              selectionMask={selectionMask}
              disabled={selectionBusy}
              onComplete={runLasso}
              onIncomplete={() =>
                report({
                  kind: 'info',
                  message: 'なげなわ選択には3点以上の軌跡が必要です。',
                })
              }
            />
            <label>
              <span>頂点座標（1行にX,Y）</span>
              <textarea
                rows={6}
                value={polygonPoints}
                onChange={(event) => setPolygonPoints(event.target.value)}
              />
            </label>
            <button type="button" onClick={runPolygon}>
              多角形選択を実行
            </button>
          </fieldset>

          <fieldset>
            <legend>選択範囲の調整</legend>
            <label>
              <span>調整半径</span>
              <input
                type="number"
                min="0"
                max="256"
                value={selectionRadius}
                onChange={(event) => setSelectionRadius(event.target.value)}
              />
            </label>
            <div role="group" aria-label="選択範囲の調整操作">
              <button
                type="button"
                onClick={() => transformSelection('feather')}
              >
                ぼかす
              </button>
              <button type="button" onClick={() => transformSelection('grow')}>
                拡張
              </button>
              <button
                type="button"
                onClick={() => transformSelection('shrink')}
              >
                縮小
              </button>
              <button
                type="button"
                onClick={() => transformSelection('invert')}
              >
                反転
              </button>
              <button
                type="button"
                onClick={() => {
                  onSelectionMask(undefined)
                  report({
                    kind: 'success',
                    message: '選択範囲を解除しました。',
                  })
                }}
              >
                解除
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
          <h3>ローカル背景除去</h3>
          <p>
            処理対象の画像は端末内だけで扱います。簡易推定は外周色を基準にするため、AIモデルと同等の品質ではありません。
          </p>

          {backgroundModel ? (
            <fieldset>
              <legend>ローカルAIモデル</legend>
              <p>
                {backgroundModel.label}（
                {formatBytes(backgroundModel.sizeBytes)}
                ）を必要時に読み込みます。
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={useModel}
                  onChange={(event) => setUseModel(event.target.checked)}
                />
                ローカルAIモデルを使用する
              </label>
              {useModel ? (
                <label>
                  <input
                    type="checkbox"
                    checked={modelConsent}
                    disabled={backgroundBusy}
                    onChange={(event) => setModelConsent(event.target.checked)}
                  />
                  表示されたモデルを端末内で取得・実行することに同意する
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
                モデル処理に失敗した場合、簡易推定へ切り替える
              </label>
              {backgroundModel.revoke ? (
                <div>
                  <p aria-live="polite">
                    実行同意は保存されず、背景除去の実行後に解除されます。取得済みモデルキャッシュはオフライン再利用のため端末内に保持され、ここから削除できます。
                  </p>
                  <button
                    type="button"
                    disabled={backgroundBusy || modelStorageBusy}
                    onClick={() => void clearBackgroundModelStorage()}
                  >
                    {modelStorageBusy
                      ? 'モデルデータを削除中…'
                      : '同意とモデルキャッシュを削除'}
                  </button>
                </div>
              ) : null}
            </fieldset>
          ) : (
            <p>
              AIモデルは設定されていません。モデルを取得せず、決定的な簡易推定を使用します。
            </p>
          )}

          {backgroundBusy ? (
            <div>
              <progress
                aria-label="背景除去の進捗"
                max="1"
                value={backgroundProgress}
              />
              <button
                type="button"
                onClick={() => backgroundAbortRef.current?.abort()}
              >
                背景除去をキャンセル
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={useModel && (!backgroundModel || !modelConsent)}
              onClick={() => void runBackgroundRemoval()}
            >
              背景を除去
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
          <h3>安全なスクリプト</h3>
          <p>
            スクリプトは実行せず、許可された
            <code>editor.*</code>
            呼び出しだけをコマンドへ変換します。
            <code>fetch</code>、<code>document</code>
            、グローバル参照、任意の式やループは拒否されます。
          </p>
          <label>
            <span>スクリプト例</span>
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
              <option value="resize">キャンバスをリサイズ</option>
              <option value="watermark">テキストを追加</option>
              <option value="filter">フィルターを適用</option>
              <option value="layers">全レイヤーへ適用</option>
            </select>
          </label>
          <fieldset>
            <legend>保存スクリプト</legend>
            <label>
              <span>保存済みスクリプト</span>
              <select
                value={selectedScriptId}
                onChange={(event) => setSelectedScriptId(event.target.value)}
              >
                <option value="">選択してください</option>
                {savedScripts.map(({ script: saved }) => (
                  <option key={saved.id} value={saved.id}>
                    {saved.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>スクリプト名</span>
              <input
                value={scriptName}
                maxLength={128}
                onChange={(event) => setScriptName(event.target.value)}
              />
            </label>
            <div role="group" aria-label="保存スクリプトの操作">
              <button type="button" onClick={saveScript}>
                保存
              </button>
              <button
                type="button"
                disabled={!selectedScriptId}
                onClick={loadSelectedScript}
              >
                読み込み
              </button>
              <button
                type="button"
                disabled={!selectedScriptId}
                onClick={deleteSelectedScript}
              >
                削除
              </button>
              <button
                type="button"
                disabled={!selectedScriptId}
                onClick={registerSelectedScriptAsMacro}
              >
                マクロへ登録
              </button>
            </div>
          </fieldset>
          <label>
            <span>エディタースクリプト</span>
            <textarea
              rows={12}
              spellCheck={false}
              value={script}
              onChange={(event) => setScript(event.target.value)}
            />
          </label>
          <button type="button" onClick={runScript}>
            安全性を確認して実行
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
