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
  formatStudioMessage,
  getStudioComponentCopy,
} from '../i18n.studio-components'
import type { AppLocale } from '../uiPreferences'
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
  locale?: AppLocale
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
  enableLabel: string
  children: ReactNode
}

const FilterSection = ({
  id,
  label,
  enabled,
  disabled,
  onEnabled,
  enableLabel,
  children,
}: FilterSectionProps) => (
  <fieldset className="advanced-filter-section" data-filter-id={id}>
    <legend>
      <label>
        <input
          type="checkbox"
          aria-label={enableLabel}
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

const imageDataUrl = (image: ImageData, canvasError: string): string => {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error(canvasError)
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
  locale = 'ja',
}: AdvancedFilterPanelProps) => {
  const copy = getStudioComponentCopy(locale).advancedFilter
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
            beforeUrl: imageDataUrl(before, copy.previewCanvasFailed),
            afterUrl: imageDataUrl(after, copy.previewCanvasFailed),
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
              error instanceof Error ? error.message : copy.previewFailed,
          })
        })
    }, PREVIEW_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [
    copy.previewCanvasFailed,
    copy.previewFailed,
    operations,
    previewRetry,
    renderPreview,
  ])

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
        message: copy.selectFilter,
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
            ? formatStudioMessage(copy.applyFailedDetail, {
                message: error.message,
              })
            : copy.applyFailed,
      })
    } finally {
      setApplying(false)
    }
  }

  const applySelectedPreset = async (): Promise<void> => {
    const preset = presets.find(({ id }) => id === selectedPresetId)
    if (!preset) {
      report({ kind: 'warning', message: copy.selectPreset })
      return
    }
    const next = commit(
      cloneOperations(preset.filters),
      initialCurvePoints(preset.filters),
    )
    await runApply(
      next,
      formatStudioMessage(copy.presetApplied, { name: preset.name }),
    )
  }

  const savePreset = (event: FormEvent): void => {
    event.preventDefault()
    const name = presetName.trim()
    if (!name) {
      report({ kind: 'warning', message: copy.presetNameRequired })
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
          ? formatStudioMessage(copy.presetSaved, { name })
          : formatStudioMessage(copy.presetSavedSession, { name }),
      })
    } catch (error) {
      report({
        kind: 'error',
        message:
          error instanceof Error
            ? formatStudioMessage(copy.presetSaveFailedDetail, {
                message: error.message,
              })
            : copy.presetSaveFailed,
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
        message: formatStudioMessage(copy.presetDeleted, {
          name: selectedPreset.name,
        }),
      })
    }
  }

  const gradientStart = gradientMap.stops[0]
  const gradientEnd = gradientMap.stops.at(-1)!
  const controlsDisabled = disabled || applying

  return (
    <section className="advanced-filter-panel" aria-label={copy.panelLabel}>
      <header>
        <div>
          <p className="advanced-filter-eyebrow">CPU FILTER CHAIN</p>
          <h3>{copy.heading}</h3>
        </div>
        <output aria-label={copy.activeFilterCountLabel}>
          {operations.length} filters
        </output>
      </header>

      <div className="advanced-filter-presets">
        <label>
          <span>{copy.presets}</span>
          <select
            aria-label={copy.presets}
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
            {copy.applyPreset}
          </button>
          <button
            type="button"
            disabled={controlsDisabled || !selectedIsUserPreset}
            onClick={deleteSelectedPreset}
          >
            {copy.remove}
          </button>
        </div>
        <form onSubmit={savePreset}>
          <label>
            <span>{copy.newPresetName}</span>
            <input
              aria-label={copy.newPresetName}
              value={presetName}
              maxLength={200}
              disabled={controlsDisabled}
              onChange={(event) => setPresetName(event.target.value)}
            />
          </label>
          <button type="submit" disabled={controlsDisabled}>
            {copy.saveCurrent}
          </button>
        </form>
      </div>

      {renderPreview ? (
        <section
          className="advanced-filter-preview"
          aria-label={copy.previewLabel}
          aria-busy={previewState.kind === 'loading'}
        >
          <header>
            <div>
              <strong>{copy.previewTitle}</strong>
              <span>
                {formatStudioMessage(copy.previewActiveCount, {
                  count: operations.length,
                })}
              </span>
            </div>
            {previewState.kind === 'loading' ? (
              <span role="status">{copy.updating}</span>
            ) : null}
          </header>
          {previewState.kind === 'ready' ? (
            <div className="advanced-filter-preview-images">
              <figure>
                <img src={previewState.beforeUrl} alt={copy.beforeAlt} />
                <figcaption>Before</figcaption>
              </figure>
              <figure>
                <img src={previewState.afterUrl} alt={copy.afterAlt} />
                <figcaption>After</figcaption>
              </figure>
            </div>
          ) : previewState.kind === 'error' ? (
            <div className="advanced-filter-preview-error" role="status">
              <span>
                {formatStudioMessage(copy.previewUpdateFailed, {
                  message: previewState.message,
                })}
              </span>
              <button
                type="button"
                onClick={() => setPreviewRetry((value) => value + 1)}
              >
                {copy.retry}
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
          label={copy.levels}
          enableLabel={formatStudioMessage(copy.enableFilter, {
            label: copy.levels,
          })}
          enabled={enabled('levels')}
          disabled={controlsDisabled}
          onEnabled={(value) => toggle('levels', value)}
        >
          <NumberControl
            label={copy.inputBlack}
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
            label={copy.inputWhite}
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
            label={copy.gamma}
            value={levels.gamma}
            minimum={0.1}
            maximum={10}
            disabled={!enabled('levels') || controlsDisabled}
            onChange={(value) => update('levels', { ...levels, gamma: value })}
          />
          <NumberControl
            label={copy.outputBlack}
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
            label={copy.outputWhite}
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
          label={copy.curves}
          enableLabel={formatStudioMessage(copy.enableFilter, {
            label: copy.curves,
          })}
          enabled={enabled('curves')}
          disabled={controlsDisabled}
          onEnabled={(value) => toggle('curves', value)}
        >
          <svg
            className="tone-curve-preview"
            viewBox="0 0 240 120"
            role="img"
            aria-label={copy.curvePreview}
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
          <div className="tone-curve-points" aria-label={copy.curvePoints}>
            {curvePoints.map((point, index) => (
              <div key={`point-${index}`}>
                <NumberControl
                  label={formatStudioMessage(copy.pointX, {
                    index: index + 1,
                  })}
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
                  label={formatStudioMessage(copy.pointY, {
                    index: index + 1,
                  })}
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
                    aria-label={formatStudioMessage(copy.removePoint, {
                      index: index + 1,
                    })}
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
            {copy.addPoint}
          </button>
        </FilterSection>

        <FilterSection
          id="white-balance"
          label={copy.whiteBalance}
          enableLabel={formatStudioMessage(copy.enableFilter, {
            label: copy.whiteBalance,
          })}
          enabled={enabled('white-balance')}
          disabled={controlsDisabled}
          onEnabled={(value) => toggle('white-balance', value)}
        >
          <NumberControl
            label={copy.temperature}
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
            label={copy.tint}
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
          label={copy.vignette}
          enableLabel={formatStudioMessage(copy.enableFilter, {
            label: copy.vignette,
          })}
          enabled={enabled('vignette')}
          disabled={controlsDisabled}
          onEnabled={(value) => toggle('vignette', value)}
        >
          <NumberControl
            label={copy.vignetteAmount}
            value={vignette.amount}
            minimum={0}
            maximum={1}
            disabled={!enabled('vignette') || controlsDisabled}
            onChange={(value) =>
              update('vignette', { ...vignette, amount: value })
            }
          />
          <NumberControl
            label={copy.vignetteMidpoint}
            value={vignette.midpoint}
            minimum={0}
            maximum={1}
            disabled={!enabled('vignette') || controlsDisabled}
            onChange={(value) =>
              update('vignette', { ...vignette, midpoint: value })
            }
          />
          <NumberControl
            label={copy.vignetteSoftness}
            value={vignette.softness}
            minimum={0.01}
            maximum={1}
            disabled={!enabled('vignette') || controlsDisabled}
            onChange={(value) =>
              update('vignette', { ...vignette, softness: value })
            }
          />
          <ColorControl
            label={copy.vignetteColor}
            value={vignette.color}
            disabled={!enabled('vignette') || controlsDisabled}
            onChange={(value) =>
              update('vignette', { ...vignette, color: value })
            }
          />
        </FilterSection>

        <FilterSection
          id="gradient-map"
          label={copy.gradientMap}
          enableLabel={formatStudioMessage(copy.enableFilter, {
            label: copy.gradientMap,
          })}
          enabled={enabled('gradient-map')}
          disabled={controlsDisabled}
          onEnabled={(value) => toggle('gradient-map', value)}
        >
          <div
            className="gradient-map-preview"
            role="img"
            aria-label={copy.gradientPreview}
            style={{
              background: `linear-gradient(90deg, ${rgbToHex(
                gradientStart.color,
              )}, ${rgbToHex(gradientEnd.color)})`,
            }}
          />
          <ColorControl
            label={copy.gradientShadow}
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
            label={copy.gradientHighlight}
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
          label={copy.duotone}
          enableLabel={formatStudioMessage(copy.enableFilter, {
            label: copy.duotone,
          })}
          enabled={enabled('duotone')}
          disabled={controlsDisabled}
          onEnabled={(value) => toggle('duotone', value)}
        >
          <ColorControl
            label={copy.duotoneShadow}
            value={duotone.shadows}
            disabled={!enabled('duotone') || controlsDisabled}
            onChange={(value) =>
              update('duotone', { ...duotone, shadows: value })
            }
          />
          <ColorControl
            label={copy.duotoneHighlight}
            value={duotone.highlights}
            disabled={!enabled('duotone') || controlsDisabled}
            onChange={(value) =>
              update('duotone', { ...duotone, highlights: value })
            }
          />
        </FilterSection>

        <FilterSection
          id="halftone"
          label={copy.halftone}
          enableLabel={formatStudioMessage(copy.enableFilter, {
            label: copy.halftone,
          })}
          enabled={enabled('halftone')}
          disabled={controlsDisabled}
          onEnabled={(value) => toggle('halftone', value)}
        >
          <NumberControl
            label={copy.dotSize}
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
            label={copy.halftoneAngle}
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
            label={copy.dotColor}
            value={halftone.foreground}
            disabled={!enabled('halftone') || controlsDisabled}
            onChange={(value) =>
              update('halftone', { ...halftone, foreground: value })
            }
          />
          <ColorControl
            label={copy.halftoneBackground}
            value={halftone.background}
            disabled={!enabled('halftone') || controlsDisabled}
            onChange={(value) =>
              update('halftone', { ...halftone, background: value })
            }
          />
        </FilterSection>

        <FilterSection
          id="glitch"
          label={copy.glitch}
          enableLabel={formatStudioMessage(copy.enableFilter, {
            label: copy.glitch,
          })}
          enabled={enabled('glitch')}
          disabled={controlsDisabled}
          onEnabled={(value) => toggle('glitch', value)}
        >
          <NumberControl
            label={copy.glitchAmount}
            value={glitch.amount}
            minimum={0}
            maximum={1}
            disabled={!enabled('glitch') || controlsDisabled}
            onChange={(value) => update('glitch', { ...glitch, amount: value })}
          />
          <NumberControl
            label={copy.rgbOffset}
            value={glitch.offset}
            minimum={0}
            maximum={256}
            step={1}
            integer
            disabled={!enabled('glitch') || controlsDisabled}
            onChange={(value) => update('glitch', { ...glitch, offset: value })}
          />
          <NumberControl
            label={copy.scanlines}
            value={glitch.scanlines}
            minimum={0}
            maximum={1}
            disabled={!enabled('glitch') || controlsDisabled}
            onChange={(value) =>
              update('glitch', { ...glitch, scanlines: value })
            }
          />
          <NumberControl
            label={copy.glitchSeed}
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
        aria-label={copy.applyLabel}
        disabled={controlsDisabled || operations.length === 0}
        onClick={() => void runApply(operations, copy.applied)}
      >
        {applying ? copy.applying : copy.applyRaster}
      </button>

      {editingAdjustmentId && onUpdateAdjustment ? (
        <button
          className="advanced-filter-apply"
          type="button"
          disabled={controlsDisabled || operations.length === 0}
          onClick={() =>
            void runApply(operations, copy.adjustmentUpdated, (next) =>
              onUpdateAdjustment(editingAdjustmentId, next),
            )
          }
        >
          {applying ? copy.updating : copy.updateAdjustment}
        </button>
      ) : onAddAdjustment ? (
        <button
          className="advanced-filter-apply"
          type="button"
          disabled={controlsDisabled || operations.length === 0}
          onClick={() =>
            void runApply(operations, copy.adjustmentAdded, onAddAdjustment)
          }
        >
          {applying ? copy.adding : copy.addAdjustment}
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
