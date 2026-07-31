import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  toneCurveLutToPoints,
  toneCurvePointsToLut,
  type ToneCurvePoint,
} from '../editor/filters/curve'
import {
  createDefaultFilterOperation,
  validateFilterOperation,
} from '../editor/filters/registry'
import {
  LocalFilterPresetRepository,
  type FilterPresetRepository,
} from '../editor/filters/presetRepository'
import type { FilterPreset } from '../editor/filters/presets'
import {
  cloneFilterOperation,
  type FilterId,
  type FilterOperation,
  type FilterParametersById,
  type RgbColor,
} from '../editor/filters/types'
import './AdvancedFilterPanel.css'

type AdvancedFilterId =
  | 'levels'
  | 'curves'
  | 'white-balance'
  | 'vignette'
  | 'gradient-map'
  | 'duotone'
  | 'halftone'
  | 'glitch'

export interface AdvancedFilterPanelStatus {
  kind: 'info' | 'success' | 'warning' | 'error'
  message: string
}

export interface AdvancedFilterPreview {
  before: ImageData
  after: ImageData
}

export type AdvancedFilterPreviewRenderer = (
  operations: readonly FilterOperation[],
  signal: AbortSignal,
) => Promise<AdvancedFilterPreview>

export interface AdvancedFilterPanelProps {
  /**
   * Initial full registry chain. Operations not represented by this panel are
   * retained when a preset is saved or the chain is applied.
   */
  initialOperations?: readonly FilterOperation[]
  repository?: FilterPresetRepository
  disabled?: boolean
  editingAdjustmentId?: string
  renderPreview?: AdvancedFilterPreviewRenderer
  onChange?(operations: FilterOperation[]): void
  /** Applies a frozen raster layer. */
  onApply(operations: FilterOperation[]): void | Promise<void>
  onAddAdjustment?(operations: FilterOperation[]): void | Promise<void>
  onUpdateAdjustment?(
    id: string,
    operations: FilterOperation[],
  ): void | Promise<void>
  onStatus?(status: AdvancedFilterPanelStatus): void
}

interface NumberControlProps {
  label: string
  value: number
  minimum: number
  maximum: number
  step?: number
  integer?: boolean
  disabled?: boolean
  onChange(value: number): void
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value))

const NumberControl = ({
  label,
  value,
  minimum,
  maximum,
  step = 0.01,
  integer = false,
  disabled,
  onChange,
}: NumberControlProps) => (
  <label className="advanced-filter-number">
    <span>{label}</span>
    <input
      type="number"
      aria-label={label}
      value={value}
      min={minimum}
      max={maximum}
      step={step}
      disabled={disabled}
      onChange={(event) => {
        const parsed = Number(event.target.value)
        if (Number.isFinite(parsed)) {
          const normalized = clamp(parsed, minimum, maximum)
          onChange(integer ? Math.round(normalized) : normalized)
        }
      }}
    />
  </label>
)

const rgbToHex = ({ r, g, b }: RgbColor): string =>
  `#${[r, g, b]
    .map((channel) =>
      clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0'),
    )
    .join('')}`

const hexToRgb = (value: string): RgbColor => {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(value)
  if (!match) {
    return { r: 0, g: 0, b: 0 }
  }
  return {
    r: Number.parseInt(match[1], 16),
    g: Number.parseInt(match[2], 16),
    b: Number.parseInt(match[3], 16),
  }
}

interface ColorControlProps {
  label: string
  value: RgbColor
  disabled?: boolean
  onChange(value: RgbColor): void
}

const ColorControl = ({
  label,
  value,
  disabled,
  onChange,
}: ColorControlProps) => (
  <label className="advanced-filter-color">
    <span>{label}</span>
    <span>
      <input
        type="color"
        aria-label={label}
        value={rgbToHex(value)}
        disabled={disabled}
        onChange={(event) => onChange(hexToRgb(event.target.value))}
      />
      <output>{rgbToHex(value).toUpperCase()}</output>
    </span>
  </label>
)

interface FilterSectionProps {
  id: AdvancedFilterId
  label: string
  enabled: boolean
  disabled?: boolean
  onEnabled(enabled: boolean): void
  children: ReactNode
}

const FilterSection = ({
  id,
  label,
  enabled,
  disabled,
  onEnabled,
  children,
}: FilterSectionProps) => (
  <fieldset className="advanced-filter-section" data-filter-id={id}>
    <legend>
      <label>
        <input
          type="checkbox"
          aria-label={`${label}を有効化`}
          checked={enabled}
          disabled={disabled}
          onChange={(event) => onEnabled(event.target.checked)}
        />
        <span>{label}</span>
      </label>
    </legend>
    <div className="advanced-filter-fields">{children}</div>
  </fieldset>
)

const safeOperations = (
  operations: readonly FilterOperation[] | undefined,
): FilterOperation[] =>
  (operations ?? []).flatMap((operation, index) => {
    try {
      return [validateFilterOperation(operation, `filters[${index}]`)]
    } catch {
      return []
    }
  })

const getOperation = <I extends FilterId>(
  operations: readonly FilterOperation[],
  id: I,
): FilterOperation<I> | undefined =>
  operations.find((operation) => operation.id === id) as
    FilterOperation<I> | undefined

const getParameters = <I extends FilterId>(
  operations: readonly FilterOperation[],
  id: I,
): FilterParametersById[I] =>
  getOperation(operations, id)?.params ??
  createDefaultFilterOperation(id).params

const replaceOperation = <I extends FilterId>(
  operations: readonly FilterOperation[],
  id: I,
  params: FilterParametersById[I],
): FilterOperation[] => {
  const operation = { id, params } as FilterOperation<I>
  return getOperation(operations, id)
    ? operations.map((candidate) =>
        candidate.id === id ? (operation as FilterOperation) : candidate,
      )
    : [...operations, operation as FilterOperation]
}

const removeOperation = (
  operations: readonly FilterOperation[],
  id: FilterId,
): FilterOperation[] => operations.filter((operation) => operation.id !== id)

const initialCurvePoints = (
  operations: readonly FilterOperation[],
): ToneCurvePoint[] => {
  const curves = getParameters(operations, 'curves')
  return toneCurveLutToPoints(curves.master)
}

const presetIdentifier = (
  name: string,
  existing: readonly FilterPreset[],
): string => {
  const stem =
    name
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-|-$/gu, '')
      .slice(0, 50) || 'preset'
  const base = `user-${stem}`
  if (!existing.some(({ id }) => id === base)) {
    return base
  }
  let suffix = 2
  while (existing.some(({ id }) => id === `${base}-${suffix}`)) {
    suffix += 1
  }
  return `${base}-${suffix}`
}

const cloneOperations = (
  operations: readonly FilterOperation[],
): FilterOperation[] => operations.map(cloneFilterOperation)

const PREVIEW_DEBOUNCE_MS = 180

const imageDataUrl = (image: ImageData): string => {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('プレビュー用Canvasを作成できませんでした。')
  }
  context.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

type PreviewState =
  | { kind: 'loading' }
  | { kind: 'ready'; beforeUrl: string; afterUrl: string }
  | { kind: 'error'; message: string }

export const AdvancedFilterPanel = ({
  initialOperations,
  repository,
  disabled = false,
  editingAdjustmentId,
  renderPreview,
  onChange,
  onApply,
  onAddAdjustment,
  onUpdateAdjustment,
  onStatus,
}: AdvancedFilterPanelProps) => {
  const [fallbackRepository] = useState(() => new LocalFilterPresetRepository())
  const activeRepository = repository ?? fallbackRepository
  const [operations, setOperations] = useState<FilterOperation[]>(() =>
    safeOperations(initialOperations),
  )
  const [curvePoints, setCurvePoints] = useState<ToneCurvePoint[]>(() =>
    initialCurvePoints(safeOperations(initialOperations)),
  )
  const [presets, setPresets] = useState<FilterPreset[]>(() =>
    activeRepository.listAll(),
  )
  const [selectedPresetId, setSelectedPresetId] = useState(
    () => activeRepository.listAll()[0]?.id ?? '',
  )
  const [presetName, setPresetName] = useState('')
  const [status, setStatus] = useState<AdvancedFilterPanelStatus | null>(null)
  const [applying, setApplying] = useState(false)
  const [previewState, setPreviewState] = useState<PreviewState>({
    kind: 'loading',
  })
  const [previewRetry, setPreviewRetry] = useState(0)
  const previewGeneration = useRef(0)

  useEffect(() => {
    const next = safeOperations(initialOperations)
    setOperations(next)
    setCurvePoints(initialCurvePoints(next))
  }, [editingAdjustmentId, initialOperations])

  useEffect(() => {
    if (!renderPreview) {
      return
    }

    const generation = previewGeneration.current + 1
    previewGeneration.current = generation
    const controller = new AbortController()
    setPreviewState({ kind: 'loading' })
    const timeout = window.setTimeout(() => {
      void renderPreview(cloneOperations(operations), controller.signal)
        .then(({ before, after }) => {
          if (
            controller.signal.aborted ||
            generation !== previewGeneration.current
          ) {
            return
          }
          setPreviewState({
            kind: 'ready',
            beforeUrl: imageDataUrl(before),
            afterUrl: imageDataUrl(after),
          })
        })
        .catch((error: unknown) => {
          if (
            controller.signal.aborted ||
            generation !== previewGeneration.current
          ) {
            return
          }
          setPreviewState({
            kind: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'プレビューを作成できませんでした。',
          })
        })
    }, PREVIEW_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [operations, previewRetry, renderPreview])

  const report = (next: AdvancedFilterPanelStatus): void => {
    setStatus(next)
    onStatus?.(next)
  }

  const commit = (
    next: readonly FilterOperation[],
    nextCurvePoints?: readonly ToneCurvePoint[],
  ): FilterOperation[] => {
    const validated = safeOperations(next)
    setOperations(validated)
    if (nextCurvePoints) {
      setCurvePoints([...nextCurvePoints])
    }
    onChange?.(cloneOperations(validated))
    return validated
  }

  const enabled = (id: AdvancedFilterId): boolean =>
    getOperation(operations, id) !== undefined

  const toggle = (id: AdvancedFilterId, nextEnabled: boolean): void => {
    if (!nextEnabled) {
      commit(removeOperation(operations, id))
      return
    }
    const next = replaceOperation(
      operations,
      id,
      createDefaultFilterOperation(id).params,
    )
    commit(
      next,
      id === 'curves'
        ? toneCurveLutToPoints(getParameters(next, 'curves').master)
        : undefined,
    )
  }

  const update = <I extends AdvancedFilterId>(
    id: I,
    params: FilterParametersById[I],
  ): void => {
    commit(replaceOperation(operations, id, params))
  }

  const levels = getParameters(operations, 'levels')
  const curves = getParameters(operations, 'curves')
  const whiteBalance = getParameters(operations, 'white-balance')
  const vignette = getParameters(operations, 'vignette')
  const gradientMap = getParameters(operations, 'gradient-map')
  const duotone = getParameters(operations, 'duotone')
  const halftone = getParameters(operations, 'halftone')
  const glitch = getParameters(operations, 'glitch')

  const curvePolyline = useMemo(
    () =>
      curvePoints
        .map(({ x, y }) => `${(x / 255) * 240},${120 - (y / 255) * 120}`)
        .join(' '),
    [curvePoints],
  )

  const changeCurvePoint = (
    index: number,
    axis: keyof ToneCurvePoint,
    value: number,
  ): void => {
    const next = curvePoints.map((point) => ({ ...point }))
    const previousX = next[index - 1]?.x ?? -1
    const nextX = next[index + 1]?.x ?? 256
    next[index][axis] =
      axis === 'x'
        ? clamp(Math.round(value), previousX + 1, nextX - 1)
        : clamp(Math.round(value), 0, 255)
    setCurvePoints(next)
    update('curves', {
      ...curves,
      master: toneCurvePointsToLut(next),
    })
  }

  const addCurvePoint = (): void => {
    if (curvePoints.length >= 16) {
      return
    }
    let insertionIndex = 1
    let largestGap = -1
    for (let index = 1; index < curvePoints.length; index += 1) {
      const gap = curvePoints[index].x - curvePoints[index - 1].x
      if (gap > largestGap) {
        largestGap = gap
        insertionIndex = index
      }
    }
    const left = curvePoints[insertionIndex - 1]
    const right = curvePoints[insertionIndex]
    const next = [...curvePoints]
    next.splice(insertionIndex, 0, {
      x: Math.round((left.x + right.x) / 2),
      y: Math.round((left.y + right.y) / 2),
    })
    setCurvePoints(next)
    update('curves', {
      ...curves,
      master: toneCurvePointsToLut(next),
    })
  }

  const removeCurvePoint = (index: number): void => {
    if (
      curvePoints.length <= 2 ||
      index === 0 ||
      index === curvePoints.length - 1
    ) {
      return
    }
    const next = curvePoints.filter((_point, candidate) => candidate !== index)
    setCurvePoints(next)
    update('curves', {
      ...curves,
      master: toneCurvePointsToLut(next),
    })
  }

  const runApply = async (
    next: readonly FilterOperation[],
    successMessage: string,
    apply: (operations: FilterOperation[]) => void | Promise<void> = onApply,
  ): Promise<void> => {
    if (next.length === 0) {
      report({
        kind: 'warning',
        message: '有効なフィルターを1つ以上選択してください。',
      })
      return
    }
    setApplying(true)
    try {
      await apply(cloneOperations(next))
      report({ kind: 'success', message: successMessage })
    } catch (error) {
      report({
        kind: 'error',
        message:
          error instanceof Error
            ? `フィルターを適用できませんでした: ${error.message}`
            : 'フィルターを適用できませんでした。',
      })
    } finally {
      setApplying(false)
    }
  }

  const applySelectedPreset = async (): Promise<void> => {
    const preset = presets.find(({ id }) => id === selectedPresetId)
    if (!preset) {
      report({ kind: 'warning', message: 'プリセットを選択してください。' })
      return
    }
    const next = commit(
      cloneOperations(preset.filters),
      initialCurvePoints(preset.filters),
    )
    await runApply(next, `プリセット「${preset.name}」を適用しました。`)
  }

  const savePreset = (event: FormEvent): void => {
    event.preventDefault()
    const name = presetName.trim()
    if (!name) {
      report({ kind: 'warning', message: 'プリセット名を入力してください。' })
      return
    }
    try {
      const result = activeRepository.save({
        schemaVersion: 1,
        id: presetIdentifier(name, presets),
        name,
        filters: cloneOperations(operations),
      })
      const refreshed = activeRepository.listAll()
      setPresets(refreshed)
      setSelectedPresetId(result.preset.id)
      setPresetName('')
      report({
        kind: result.persisted ? 'success' : 'warning',
        message: result.persisted
          ? `プリセット「${name}」を保存しました。`
          : `プリセット「${name}」はこのセッションだけに保存されました。`,
      })
    } catch (error) {
      report({
        kind: 'error',
        message:
          error instanceof Error
            ? `プリセットを保存できませんでした: ${error.message}`
            : 'プリセットを保存できませんでした。',
      })
    }
  }

  const selectedPreset = presets.find(({ id }) => id === selectedPresetId)
  const selectedIsUserPreset =
    selectedPreset !== undefined &&
    activeRepository.listUser().some(({ id }) => id === selectedPreset.id)

  const deleteSelectedPreset = (): void => {
    if (!selectedIsUserPreset || !selectedPreset) {
      return
    }
    if (activeRepository.remove(selectedPreset.id)) {
      const refreshed = activeRepository.listAll()
      setPresets(refreshed)
      setSelectedPresetId(refreshed[0]?.id ?? '')
      report({
        kind: 'success',
        message: `プリセット「${selectedPreset.name}」を削除しました。`,
      })
    }
  }

  const gradientStart = gradientMap.stops[0]
  const gradientEnd = gradientMap.stops.at(-1)!
  const controlsDisabled = disabled || applying

  return (
    <section className="advanced-filter-panel" aria-label="詳細フィルター">
      <header>
        <div>
          <p className="advanced-filter-eyebrow">CPU FILTER CHAIN</p>
          <h3>詳細フィルター</h3>
        </div>
        <output aria-label="有効な詳細フィルター数">
          {operations.length} filters
        </output>
      </header>

      <div className="advanced-filter-presets">
        <label>
          <span>フィルタープリセット</span>
          <select
            aria-label="フィルタープリセット"
            value={selectedPresetId}
            disabled={controlsDisabled || presets.length === 0}
            onChange={(event) => setSelectedPresetId(event.target.value)}
          >
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
        <div className="advanced-filter-preset-actions">
          <button
            type="button"
            disabled={controlsDisabled || !selectedPreset}
            onClick={() => void applySelectedPreset()}
          >
            プリセットを適用
          </button>
          <button
            type="button"
            disabled={controlsDisabled || !selectedIsUserPreset}
            onClick={deleteSelectedPreset}
          >
            削除
          </button>
        </div>
        <form onSubmit={savePreset}>
          <label>
            <span>新しいプリセット名</span>
            <input
              aria-label="新しいプリセット名"
              value={presetName}
              maxLength={200}
              disabled={controlsDisabled}
              onChange={(event) => setPresetName(event.target.value)}
            />
          </label>
          <button type="submit" disabled={controlsDisabled}>
            現在の設定を保存
          </button>
        </form>
      </div>

      {renderPreview ? (
        <section
          className="advanced-filter-preview"
          aria-label="実画像フィルタープレビュー"
          aria-busy={previewState.kind === 'loading'}
        >
          <header>
            <div>
              <strong>実画像プレビュー</strong>
              <span>有効な {operations.length} 件を適用</span>
            </div>
            {previewState.kind === 'loading' ? (
              <span role="status">更新中…</span>
            ) : null}
          </header>
          {previewState.kind === 'ready' ? (
            <div className="advanced-filter-preview-images">
              <figure>
                <img
                  src={previewState.beforeUrl}
                  alt="フィルター適用前のプレビュー"
                />
                <figcaption>Before</figcaption>
              </figure>
              <figure>
                <img
                  src={previewState.afterUrl}
                  alt="フィルター適用後のプレビュー"
                />
                <figcaption>After</figcaption>
              </figure>
            </div>
          ) : previewState.kind === 'error' ? (
            <div className="advanced-filter-preview-error" role="status">
              <span>プレビューを更新できません: {previewState.message}</span>
              <button
                type="button"
                onClick={() => setPreviewRetry((value) => value + 1)}
              >
                再試行
              </button>
            </div>
          ) : (
            <div
              className="advanced-filter-preview-placeholder"
              aria-hidden="true"
            />
          )}
        </section>
      ) : null}

      <div className="advanced-filter-grid">
        <FilterSection
          id="levels"
          label="レベル補正"
          enabled={enabled('levels')}
          disabled={controlsDisabled}
          onEnabled={(value) => toggle('levels', value)}
        >
          <NumberControl
            label="入力ブラック"
            value={levels.inputBlack}
            minimum={0}
            maximum={levels.inputWhite - 1}
            step={1}
            integer
            disabled={!enabled('levels') || controlsDisabled}
            onChange={(value) =>
              update('levels', { ...levels, inputBlack: value })
            }
          />
          <NumberControl
            label="入力ホワイト"
            value={levels.inputWhite}
            minimum={levels.inputBlack + 1}
            maximum={255}
            step={1}
            integer
            disabled={!enabled('levels') || controlsDisabled}
            onChange={(value) =>
              update('levels', { ...levels, inputWhite: value })
            }
          />
          <NumberControl
            label="ガンマ"
            value={levels.gamma}
            minimum={0.1}
            maximum={10}
            disabled={!enabled('levels') || controlsDisabled}
            onChange={(value) => update('levels', { ...levels, gamma: value })}
          />
          <NumberControl
            label="出力ブラック"
            value={levels.outputBlack}
            minimum={0}
            maximum={levels.outputWhite - 1}
            step={1}
            integer
            disabled={!enabled('levels') || controlsDisabled}
            onChange={(value) =>
              update('levels', { ...levels, outputBlack: value })
            }
          />
          <NumberControl
            label="出力ホワイト"
            value={levels.outputWhite}
            minimum={levels.outputBlack + 1}
            maximum={255}
            step={1}
            integer
            disabled={!enabled('levels') || controlsDisabled}
            onChange={(value) =>
              update('levels', { ...levels, outputWhite: value })
            }
          />
        </FilterSection>

        <FilterSection
          id="curves"
          label="トーンカーブ"
          enabled={enabled('curves')}
          disabled={controlsDisabled}
          onEnabled={(value) => toggle('curves', value)}
        >
          <svg
            className="tone-curve-preview"
            viewBox="0 0 240 120"
            role="img"
            aria-label="トーンカーブのプレビュー"
          >
            <path d="M 0 60 H 240 M 120 0 V 120" />
            <polyline points={curvePolyline} />
            {curvePoints.map(({ x, y }) => (
              <circle
                key={`${x}-${y}`}
                cx={(x / 255) * 240}
                cy={120 - (y / 255) * 120}
                r="3"
              />
            ))}
          </svg>
          <div className="tone-curve-points" aria-label="トーンカーブ制御点">
            {curvePoints.map((point, index) => (
              <div key={`point-${index}`}>
                <NumberControl
                  label={`ポイント ${index + 1} X`}
                  value={point.x}
                  minimum={curvePoints[index - 1]?.x + 1 || 0}
                  maximum={curvePoints[index + 1]?.x - 1 || 255}
                  step={1}
                  integer
                  disabled={
                    !enabled('curves') ||
                    controlsDisabled ||
                    index === 0 ||
                    index === curvePoints.length - 1
                  }
                  onChange={(value) => changeCurvePoint(index, 'x', value)}
                />
                <NumberControl
                  label={`ポイント ${index + 1} Y`}
                  value={point.y}
                  minimum={0}
                  maximum={255}
                  step={1}
                  integer
                  disabled={!enabled('curves') || controlsDisabled}
                  onChange={(value) => changeCurvePoint(index, 'y', value)}
                />
                {index > 0 && index < curvePoints.length - 1 ? (
                  <button
                    type="button"
                    aria-label={`ポイント ${index + 1} を削除`}
                    disabled={!enabled('curves') || controlsDisabled}
                    onClick={() => removeCurvePoint(index)}
                  >
                    −
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={
              !enabled('curves') || controlsDisabled || curvePoints.length >= 16
            }
            onClick={addCurvePoint}
          >
            制御点を追加
          </button>
        </FilterSection>

        <FilterSection
          id="white-balance"
          label="ホワイトバランス"
          enabled={enabled('white-balance')}
          disabled={controlsDisabled}
          onEnabled={(value) => toggle('white-balance', value)}
        >
          <NumberControl
            label="色温度"
            value={whiteBalance.temperature}
            minimum={-1}
            maximum={1}
            disabled={!enabled('white-balance') || controlsDisabled}
            onChange={(value) =>
              update('white-balance', {
                ...whiteBalance,
                temperature: value,
              })
            }
          />
          <NumberControl
            label="色かぶり補正"
            value={whiteBalance.tint}
            minimum={-1}
            maximum={1}
            disabled={!enabled('white-balance') || controlsDisabled}
            onChange={(value) =>
              update('white-balance', { ...whiteBalance, tint: value })
            }
          />
        </FilterSection>

        <FilterSection
          id="vignette"
          label="ビネット"
          enabled={enabled('vignette')}
          disabled={controlsDisabled}
          onEnabled={(value) => toggle('vignette', value)}
        >
          <NumberControl
            label="ビネット量"
            value={vignette.amount}
            minimum={0}
            maximum={1}
            disabled={!enabled('vignette') || controlsDisabled}
            onChange={(value) =>
              update('vignette', { ...vignette, amount: value })
            }
          />
          <NumberControl
            label="ビネット中間点"
            value={vignette.midpoint}
            minimum={0}
            maximum={1}
            disabled={!enabled('vignette') || controlsDisabled}
            onChange={(value) =>
              update('vignette', { ...vignette, midpoint: value })
            }
          />
          <NumberControl
            label="ビネットぼかし"
            value={vignette.softness}
            minimum={0.01}
            maximum={1}
            disabled={!enabled('vignette') || controlsDisabled}
            onChange={(value) =>
              update('vignette', { ...vignette, softness: value })
            }
          />
          <ColorControl
            label="ビネット色"
            value={vignette.color}
            disabled={!enabled('vignette') || controlsDisabled}
            onChange={(value) =>
              update('vignette', { ...vignette, color: value })
            }
          />
        </FilterSection>

        <FilterSection
          id="gradient-map"
          label="グラデーションマップ"
          enabled={enabled('gradient-map')}
          disabled={controlsDisabled}
          onEnabled={(value) => toggle('gradient-map', value)}
        >
          <div
            className="gradient-map-preview"
            role="img"
            aria-label="グラデーションマップのプレビュー"
            style={{
              background: `linear-gradient(90deg, ${rgbToHex(
                gradientStart.color,
              )}, ${rgbToHex(gradientEnd.color)})`,
            }}
          />
          <ColorControl
            label="グラデーション暗部色"
            value={gradientStart.color}
            disabled={!enabled('gradient-map') || controlsDisabled}
            onChange={(value) =>
              update('gradient-map', {
                stops: gradientMap.stops.map((stop, index) =>
                  index === 0 ? { ...stop, color: value } : stop,
                ),
              })
            }
          />
          <ColorControl
            label="グラデーション明部色"
            value={gradientEnd.color}
            disabled={!enabled('gradient-map') || controlsDisabled}
            onChange={(value) =>
              update('gradient-map', {
                stops: gradientMap.stops.map((stop, index) =>
                  index === gradientMap.stops.length - 1
                    ? { ...stop, color: value }
                    : stop,
                ),
              })
            }
          />
        </FilterSection>

        <FilterSection
          id="duotone"
          label="デュオトーン"
          enabled={enabled('duotone')}
          disabled={controlsDisabled}
          onEnabled={(value) => toggle('duotone', value)}
        >
          <ColorControl
            label="デュオトーン暗部色"
            value={duotone.shadows}
            disabled={!enabled('duotone') || controlsDisabled}
            onChange={(value) =>
              update('duotone', { ...duotone, shadows: value })
            }
          />
          <ColorControl
            label="デュオトーン明部色"
            value={duotone.highlights}
            disabled={!enabled('duotone') || controlsDisabled}
            onChange={(value) =>
              update('duotone', { ...duotone, highlights: value })
            }
          />
        </FilterSection>

        <FilterSection
          id="halftone"
          label="ハーフトーン"
          enabled={enabled('halftone')}
          disabled={controlsDisabled}
          onEnabled={(value) => toggle('halftone', value)}
        >
          <NumberControl
            label="ドットサイズ"
            value={halftone.size}
            minimum={2}
            maximum={64}
            step={1}
            integer
            disabled={!enabled('halftone') || controlsDisabled}
            onChange={(value) =>
              update('halftone', { ...halftone, size: value })
            }
          />
          <NumberControl
            label="ハーフトーン角度"
            value={halftone.angle}
            minimum={0}
            maximum={180}
            step={1}
            disabled={!enabled('halftone') || controlsDisabled}
            onChange={(value) =>
              update('halftone', { ...halftone, angle: value })
            }
          />
          <ColorControl
            label="ドット色"
            value={halftone.foreground}
            disabled={!enabled('halftone') || controlsDisabled}
            onChange={(value) =>
              update('halftone', { ...halftone, foreground: value })
            }
          />
          <ColorControl
            label="ハーフトーン背景色"
            value={halftone.background}
            disabled={!enabled('halftone') || controlsDisabled}
            onChange={(value) =>
              update('halftone', { ...halftone, background: value })
            }
          />
        </FilterSection>

        <FilterSection
          id="glitch"
          label="グリッチ"
          enabled={enabled('glitch')}
          disabled={controlsDisabled}
          onEnabled={(value) => toggle('glitch', value)}
        >
          <NumberControl
            label="グリッチ量"
            value={glitch.amount}
            minimum={0}
            maximum={1}
            disabled={!enabled('glitch') || controlsDisabled}
            onChange={(value) => update('glitch', { ...glitch, amount: value })}
          />
          <NumberControl
            label="RGBオフセット"
            value={glitch.offset}
            minimum={0}
            maximum={256}
            step={1}
            integer
            disabled={!enabled('glitch') || controlsDisabled}
            onChange={(value) => update('glitch', { ...glitch, offset: value })}
          />
          <NumberControl
            label="スキャンライン"
            value={glitch.scanlines}
            minimum={0}
            maximum={1}
            disabled={!enabled('glitch') || controlsDisabled}
            onChange={(value) =>
              update('glitch', { ...glitch, scanlines: value })
            }
          />
          <NumberControl
            label="グリッチ乱数シード"
            value={glitch.seed}
            minimum={0}
            maximum={0xffffffff}
            step={1}
            integer
            disabled={!enabled('glitch') || controlsDisabled}
            onChange={(value) => update('glitch', { ...glitch, seed: value })}
          />
        </FilterSection>
      </div>

      <button
        className="advanced-filter-apply"
        type="button"
        aria-label="詳細フィルターを適用"
        disabled={controlsDisabled || operations.length === 0}
        onClick={() =>
          void runApply(operations, '詳細フィルターを適用しました。')
        }
      >
        {applying ? '適用中…' : 'ラスターレイヤーへ適用'}
      </button>

      {editingAdjustmentId && onUpdateAdjustment ? (
        <button
          className="advanced-filter-apply"
          type="button"
          disabled={controlsDisabled || operations.length === 0}
          onClick={() =>
            void runApply(
              operations,
              '詳細調整レイヤーを更新しました。',
              (next) => onUpdateAdjustment(editingAdjustmentId, next),
            )
          }
        >
          {applying ? '更新中…' : '選択中の調整レイヤーを更新'}
        </button>
      ) : onAddAdjustment ? (
        <button
          className="advanced-filter-apply"
          type="button"
          disabled={controlsDisabled || operations.length === 0}
          onClick={() =>
            void runApply(
              operations,
              '詳細調整レイヤーを追加しました。',
              onAddAdjustment,
            )
          }
        >
          {applying ? '追加中…' : '調整レイヤーとして追加'}
        </button>
      ) : null}

      {status ? (
        <p
          className={`advanced-filter-status ${status.kind}`}
          role={status.kind === 'error' ? 'alert' : 'status'}
        >
          {status.message}
        </p>
      ) : null}
    </section>
  )
}

export default AdvancedFilterPanel
