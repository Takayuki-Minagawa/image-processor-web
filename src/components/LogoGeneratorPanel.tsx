import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  createHarmonyPalettes,
  generateLogoVariations,
  locksFromVariation,
  type LogoFontPair,
  type LogoVariation,
  type LogoVariationLocks,
} from '../logo/generator'
import {
  generateColorHarmony,
  type ColorHarmonyRule,
  type HexColor,
} from '../logo/colors'
import {
  extractPalette,
  type ExtractedPaletteColor,
  type ImageDataLike,
} from '../logo/palette'
import { readPaletteImageFile } from '../logo/paletteSource'
import type { LogoTemplate } from '../logo/templateSchema'

export type LogoColorApplicationTarget = 'fill' | 'stroke'

export interface LogoGeneratorPanelProps {
  onInsert: (variation: LogoVariation) => void
  getImageData?: () => ImageDataLike | Promise<ImageDataLike>
  onApplyColor?: (
    color: HexColor,
    target: LogoColorApplicationTarget,
  ) => void | Promise<void>
  initialName?: string
  initialInitials?: string
  initialTagline?: string
  initialBaseColor?: string
  initialHarmonyRule?: ColorHarmonyRule
  seed?: string | number
  candidateCount?: number
  templates?: readonly LogoTemplate[]
  fontPairs?: readonly LogoFontPair[]
  paletteColorCount?: number
  className?: string
}

interface LockState {
  colors: boolean
  fonts: boolean
  layout: boolean
}

const HARMONY_OPTIONS: ReadonlyArray<{
  value: ColorHarmonyRule
  label: string
}> = [
  { value: 'complementary', label: '補色' },
  { value: 'analogous', label: '類似色' },
  { value: 'triadic', label: 'トライアド' },
  { value: 'monochromatic', label: 'モノクロマティック' },
]

const normalizeCandidateCount = (value: number | undefined): number =>
  Math.min(
    100,
    Math.max(
      12,
      Math.round(
        typeof value === 'number' && Number.isFinite(value) ? value : 12,
      ),
    ),
  )

const previewTransform = (
  rotation: number,
  centerX: number,
  centerY: number,
): string | undefined =>
  rotation === 0 ? undefined : `rotate(${rotation} ${centerX} ${centerY})`

function VariationPreview({
  variation,
}: {
  variation: LogoVariation
}): ReactNode {
  return (
    <svg
      viewBox={`0 0 ${variation.canvas.width} ${variation.canvas.height}`}
      aria-hidden="true"
      focusable="false"
    >
      {variation.elements.map((element) => {
        if (element.kind === 'shape') {
          const transform = previewTransform(
            element.rotation,
            element.x + element.width / 2,
            element.y + element.height / 2,
          )
          if (element.shape === 'ellipse') {
            return (
              <ellipse
                key={element.id}
                cx={element.x + element.width / 2}
                cy={element.y + element.height / 2}
                rx={element.width / 2}
                ry={element.height / 2}
                fill={element.fill}
                stroke={element.stroke}
                strokeWidth={element.strokeWidth}
                opacity={element.opacity}
                transform={transform}
              />
            )
          }
          return (
            <rect
              key={element.id}
              x={element.x}
              y={element.y}
              width={element.width}
              height={element.height}
              rx={element.cornerRadius}
              ry={element.cornerRadius}
              fill={element.fill}
              stroke={element.stroke}
              strokeWidth={element.strokeWidth}
              opacity={element.opacity}
              transform={transform}
            />
          )
        }

        const anchor =
          element.align === 'center'
            ? 'middle'
            : element.align === 'right'
              ? 'end'
              : 'start'
        const x =
          element.align === 'center'
            ? element.x + element.maxWidth / 2
            : element.align === 'right'
              ? element.x + element.maxWidth
              : element.x
        return (
          <text
            key={element.id}
            x={x}
            y={element.y}
            fill={element.color}
            opacity={element.opacity}
            fontFamily={element.fontFamily}
            fontSize={element.fontSize}
            fontWeight={element.fontWeight}
            letterSpacing={`${element.letterSpacing / 1000}em`}
            textAnchor={anchor}
            dominantBaseline="hanging"
            transform={previewTransform(element.rotation, x, element.y)}
          >
            {element.text}
          </text>
        )
      })}
    </svg>
  )
}

const variationLabel = (variation: LogoVariation, index: number): string =>
  `候補 ${index + 1}: ${variation.templateName}、配色 ${variation.palette.name}、フォント ${variation.fontPair.name}`

export function LogoGeneratorPanel({
  onInsert,
  initialName = '',
  initialInitials = '',
  initialTagline = '',
  initialBaseColor = '#6757e8',
  initialHarmonyRule = 'complementary',
  seed = 'pixelweave-logo-panel',
  candidateCount,
  templates,
  fontPairs,
  getImageData,
  onApplyColor,
  paletteColorCount = 8,
  className,
}: LogoGeneratorPanelProps) {
  const headingId = useId()
  const candidateListId = useId()
  const paletteHeadingId = useId()
  const extractionRequest = useRef(0)
  const [name, setName] = useState(initialName)
  const [initials, setInitials] = useState(initialInitials)
  const [tagline, setTagline] = useState(initialTagline)
  const [baseColor, setBaseColor] = useState(initialBaseColor)
  const [harmonyRule, setHarmonyRule] =
    useState<ColorHarmonyRule>(initialHarmonyRule)
  const [locks, setLocks] = useState<LockState>({
    colors: false,
    fonts: false,
    layout: false,
  })
  const [variations, setVariations] = useState<LogoVariation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [seedRevision, setSeedRevision] = useState(0)
  const [extractedColors, setExtractedColors] = useState<
    ExtractedPaletteColor[]
  >([])
  const [selectedExtractedColor, setSelectedExtractedColor] =
    useState<HexColor | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [isApplyingColor, setIsApplyingColor] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('名称を入力して候補を生成してください。')

  const selected =
    variations.find((variation) => variation.id === selectedId) ?? null

  const generate = (
    revision: number,
    overrides: {
      baseColor?: HexColor
      harmonyRule?: ColorHarmonyRule
    } = {},
  ): void => {
    try {
      const effectiveBaseColor = overrides.baseColor ?? baseColor
      const effectiveHarmonyRule = overrides.harmonyRule ?? harmonyRule
      const palettes = createHarmonyPalettes(effectiveBaseColor)
      const preferredPaletteId = `harmony-${effectiveHarmonyRule}`
      const selectedLocks: LogoVariationLocks = selected
        ? locksFromVariation(selected, locks)
        : {}
      const count = normalizeCandidateCount(candidateCount)
      const seedPrefix = `${seed}:${revision}:${name}:${initials}:${tagline}:${effectiveBaseColor}:${effectiveHarmonyRule}`
      const common = {
        templates,
        palettes,
        fontPairs,
      }
      let nextVariations: LogoVariation[]

      if (selectedLocks.paletteId) {
        nextVariations = generateLogoVariations(
          { name, initials, tagline },
          {
            ...common,
            count,
            seed: `${seedPrefix}:locked`,
            locks: selectedLocks,
          },
        )
      } else {
        const preferred = generateLogoVariations(
          { name, initials, tagline },
          {
            ...common,
            count: 1,
            seed: `${seedPrefix}:preferred`,
            locks: {
              ...selectedLocks,
              paletteId: preferredPaletteId,
            },
          },
        )
        const remaining = generateLogoVariations(
          { name, initials, tagline },
          {
            ...common,
            count: count - 1,
            seed: `${seedPrefix}:grid`,
            locks: selectedLocks,
          },
        )
        nextVariations = [...preferred, ...remaining]
      }

      if (nextVariations.length === 0) {
        setVariations([])
        setSelectedId(null)
        setError('条件に合うロゴ候補がありません。')
        setStatus('候補は生成されませんでした。')
        return
      }
      setVariations(nextVariations)
      setSelectedId(nextVariations[0].id)
      setError(null)
      setStatus(`${nextVariations.length}件の候補を生成しました。`)
    } catch (generationError) {
      setVariations([])
      setSelectedId(null)
      setError(
        generationError instanceof Error && generationError.message
          ? `候補を生成できませんでした: ${generationError.message}`
          : '候補を生成できませんでした。入力内容を確認してください。',
      )
      setStatus('候補は生成されませんでした。')
    }
  }

  const onGenerate = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    generate(seedRevision)
  }

  const reshuffle = (): void => {
    const nextRevision = seedRevision + 1
    setSeedRevision(nextRevision)
    generate(nextRevision)
  }

  const extractColors = async (
    source: () => ImageDataLike | Promise<ImageDataLike>,
    sourceLabel: string,
  ): Promise<void> => {
    const request = extractionRequest.current + 1
    extractionRequest.current = request
    setIsExtracting(true)
    setError(null)
    setStatus(`${sourceLabel}から主要色を抽出しています。`)

    try {
      const image = await source()
      const colors = extractPalette(image, {
        maxColors: paletteColorCount,
      })
      if (extractionRequest.current !== request) {
        return
      }
      setExtractedColors(colors)
      setSelectedExtractedColor(null)
      if (colors.length === 0) {
        setError(`${sourceLabel}に抽出できる不透明な色が見つかりませんでした。`)
        setStatus('主要色は抽出されませんでした。')
        return
      }
      setStatus(`${sourceLabel}から${colors.length}色を抽出しました。`)
    } catch (extractionError) {
      if (extractionRequest.current !== request) {
        return
      }
      setExtractedColors([])
      setSelectedExtractedColor(null)
      setError(
        extractionError instanceof Error && extractionError.message
          ? `主要色を抽出できませんでした: ${extractionError.message}`
          : '主要色を抽出できませんでした。',
      )
      setStatus('主要色は抽出されませんでした。')
    } finally {
      if (extractionRequest.current === request) {
        setIsExtracting(false)
      }
    }
  }

  const onPaletteFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) {
      return
    }
    void extractColors(() => readPaletteImageFile(file), file.name)
  }

  const applyPaletteColorToCandidates = (color: HexColor): void => {
    if (locks.colors && selected) {
      setError('配色の固定を解除してから抽出色を選択してください。')
      return
    }
    setSelectedExtractedColor(color)
    setBaseColor(color)
    setError(null)
    if (variations.length === 0) {
      setStatus(`${color}を基準色に設定しました。`)
      return
    }
    const nextRevision = seedRevision + 1
    setSeedRevision(nextRevision)
    generate(nextRevision, { baseColor: color })
  }

  const selectHarmony = (rule: ColorHarmonyRule): void => {
    if (locks.colors && selected) {
      setError('配色の固定を解除してから配色ルールを変更してください。')
      return
    }
    setHarmonyRule(rule)
    setError(null)
    if (variations.length === 0) {
      const option = HARMONY_OPTIONS.find(({ value }) => value === rule)
      setStatus(`${option?.label ?? rule}の配色を選択しました。`)
      return
    }
    const nextRevision = seedRevision + 1
    setSeedRevision(nextRevision)
    generate(nextRevision, { harmonyRule: rule })
  }

  const applyColorToEditor = async (
    target: LogoColorApplicationTarget,
  ): Promise<void> => {
    if (!onApplyColor || !selectedExtractedColor) {
      return
    }
    setIsApplyingColor(true)
    setError(null)
    try {
      await onApplyColor(selectedExtractedColor, target)
      setStatus(
        `${selectedExtractedColor}を選択オブジェクトの${target === 'fill' ? '塗り' : '縁取り'}に適用しました。`,
      )
    } catch (applicationError) {
      setError(
        applicationError instanceof Error && applicationError.message
          ? `色を適用できませんでした: ${applicationError.message}`
          : '色を適用できませんでした。',
      )
    } finally {
      setIsApplyingColor(false)
    }
  }

  const insertSelected = (): void => {
    if (!selected) {
      setError('挿入する候補を選択してください。')
      return
    }
    try {
      onInsert(selected)
      setError(null)
      setStatus(`「${selected.templateName}」を挿入しました。`)
    } catch (insertError) {
      setError(
        insertError instanceof Error && insertError.message
          ? `候補を挿入できませんでした: ${insertError.message}`
          : '候補を挿入できませんでした。',
      )
    }
  }

  return (
    <section
      className={['logo-generator-panel', className].filter(Boolean).join(' ')}
      aria-labelledby={headingId}
    >
      <header>
        <h2 id={headingId}>ロゴテンプレートジェネレーター</h2>
        <p>名称と配色を指定し、編集可能なロゴ候補をローカルで生成します。</p>
      </header>

      <form onSubmit={onGenerate} noValidate>
        <div className="logo-generator-fields">
          <label>
            <span>名称</span>
            <input
              type="text"
              value={name}
              maxLength={120}
              aria-required="true"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            <span>イニシャル</span>
            <input
              type="text"
              value={initials}
              maxLength={6}
              onChange={(event) => setInitials(event.target.value)}
            />
          </label>
          <label>
            <span>タグライン</span>
            <input
              type="text"
              value={tagline}
              maxLength={160}
              onChange={(event) => setTagline(event.target.value)}
            />
          </label>
          <label>
            <span>基準色</span>
            <input
              type="color"
              value={baseColor}
              disabled={locks.colors && selected !== null}
              onChange={(event) => {
                setBaseColor(event.target.value)
                setSelectedExtractedColor(null)
              }}
            />
          </label>
          <label>
            <span>配色ルール</span>
            <select
              value={harmonyRule}
              disabled={locks.colors && selected !== null}
              onChange={(event) =>
                selectHarmony(event.target.value as ColorHarmonyRule)
              }
            >
              {HARMONY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="logo-generator-actions">
          <button type="submit">候補を生成</button>
          <button
            type="button"
            disabled={variations.length === 0}
            onClick={reshuffle}
          >
            固定項目を保って再生成
          </button>
        </div>
      </form>

      <section
        className="logo-palette-assistant"
        aria-labelledby={paletteHeadingId}
        aria-busy={isExtracting}
      >
        <header>
          <h3 id={paletteHeadingId}>配色アシスタント</h3>
          <p>
            ローカル画像または現在のキャンバスから主要色を抽出し、候補の配色に使えます。
          </p>
        </header>

        <div className="logo-palette-source-actions">
          <label className="logo-palette-file">
            <span>{isExtracting ? '色を抽出中…' : '画像から色を抽出'}</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={isExtracting}
              onChange={onPaletteFileChange}
            />
          </label>
          {getImageData ? (
            <button
              type="button"
              disabled={isExtracting}
              onClick={() =>
                void extractColors(getImageData, '現在のキャンバス')
              }
            >
              現在のキャンバスから色を抽出
            </button>
          ) : null}
        </div>

        {extractedColors.length > 0 ? (
          <div
            className="logo-extracted-palette"
            role="list"
            aria-label="抽出した主要色"
          >
            {extractedColors.map((color) => (
              <div key={color.hex} role="listitem">
                <button
                  type="button"
                  aria-label={`抽出色 ${color.hex}、使用率 ${Math.round(color.ratio * 100)}% をロゴ候補へ適用`}
                  aria-pressed={selectedExtractedColor === color.hex}
                  disabled={locks.colors && selected !== null}
                  onClick={() => applyPaletteColorToCandidates(color.hex)}
                >
                  <span
                    className="logo-color-swatch"
                    style={{ backgroundColor: color.hex }}
                    aria-hidden="true"
                  />
                  <span>{color.hex}</span>
                  <small>{Math.round(color.ratio * 100)}%</small>
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="logo-palette-empty">
            画像を選ぶと、抽出した主要色がここに表示されます。
          </p>
        )}

        {onApplyColor ? (
          <div className="logo-palette-apply-actions">
            <button
              type="button"
              disabled={!selectedExtractedColor || isApplyingColor}
              onClick={() => void applyColorToEditor('fill')}
            >
              選択色を塗りに適用
            </button>
            <button
              type="button"
              disabled={!selectedExtractedColor || isApplyingColor}
              onClick={() => void applyColorToEditor('stroke')}
            >
              選択色を縁取りに適用
            </button>
          </div>
        ) : null}

        <fieldset className="logo-harmony-suggestions">
          <legend>配色ルールの提案</legend>
          <div>
            {HARMONY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-label={`${option.label}の配色を選択`}
                aria-pressed={harmonyRule === option.value}
                disabled={locks.colors && selected !== null}
                onClick={() => selectHarmony(option.value)}
              >
                <span>{option.label}</span>
                <span className="logo-harmony-swatches" aria-hidden="true">
                  {generateColorHarmony(baseColor, option.value).map(
                    (color, index) => (
                      <span
                        key={`${option.value}-${index}`}
                        style={{ backgroundColor: color }}
                      />
                    ),
                  )}
                </span>
              </button>
            ))}
          </div>
        </fieldset>
      </section>

      <fieldset className="logo-generator-locks">
        <legend>固定オプション</legend>
        <label>
          <input
            type="checkbox"
            checked={locks.colors}
            disabled={!selected}
            onChange={(event) =>
              setLocks((current) => ({
                ...current,
                colors: event.target.checked,
              }))
            }
          />
          配色を固定
        </label>
        <label>
          <input
            type="checkbox"
            checked={locks.fonts}
            disabled={!selected}
            onChange={(event) =>
              setLocks((current) => ({
                ...current,
                fonts: event.target.checked,
              }))
            }
          />
          フォントを固定
        </label>
        <label>
          <input
            type="checkbox"
            checked={locks.layout}
            disabled={!selected}
            onChange={(event) =>
              setLocks((current) => ({
                ...current,
                layout: event.target.checked,
              }))
            }
          />
          レイアウトを固定
        </label>
      </fieldset>

      {error ? <p role="alert">{error}</p> : null}
      <p role="status" aria-live="polite">
        {status}
      </p>

      {variations.length > 0 ? (
        <ul
          id={candidateListId}
          className="logo-candidate-grid"
          aria-label="ロゴ候補"
        >
          {variations.map((variation, index) => (
            <li key={variation.id}>
              <button
                type="button"
                className="logo-candidate-card"
                aria-label={variationLabel(variation, index)}
                aria-pressed={selectedId === variation.id}
                onClick={() => {
                  setSelectedId(variation.id)
                  setError(null)
                }}
              >
                <VariationPreview variation={variation} />
                <span aria-hidden="true">
                  {variation.templateName}
                  <small>
                    {variation.palette.name} · {variation.fontPair.name}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p id={candidateListId} className="logo-candidate-empty">
          生成された候補はありません。
        </p>
      )}

      <button type="button" disabled={!selected} onClick={insertSelected}>
        選択した候補を挿入
      </button>
    </section>
  )
}

export default LogoGeneratorPanel
