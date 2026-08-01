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
import {
  BUNDLED_LOGO_FONT_LICENSES,
  ensureLogoFontsLoaded,
} from '../logo/fonts'
import type { LogoTemplate } from '../logo/templateSchema'
import {
  formatStudioMessage,
  getStudioComponentCopy,
} from '../i18n.studio-components'
import type { AppLocale } from '../uiPreferences'

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
  locale?: AppLocale
}

interface LockState {
  colors: boolean
  fonts: boolean
  layout: boolean
}

const HARMONY_RULES: readonly ColorHarmonyRule[] = [
  'complementary',
  'analogous',
  'triadic',
  'monochromatic',
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
  locale = 'ja',
}: LogoGeneratorPanelProps) {
  const copy = getStudioComponentCopy(locale).logo
  const harmonyOptions: ReadonlyArray<{
    value: ColorHarmonyRule
    label: string
  }> = HARMONY_RULES.map((value) => ({
    value,
    label:
      value === 'complementary'
        ? copy.harmonyComplementary
        : value === 'analogous'
          ? copy.harmonyAnalogous
          : value === 'triadic'
            ? copy.harmonyTriadic
            : copy.harmonyMonochromatic,
  }))
  const variationLabel = (variation: LogoVariation, index: number): string =>
    formatStudioMessage(copy.variationLabel, {
      index: index + 1,
      template: variation.templateName,
      palette: variation.palette.name,
      font: variation.fontPair.name,
    })
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
  const [status, setStatus] = useState(copy.initialStatus)

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
        setError(copy.noCandidatesError)
        setStatus(copy.noCandidatesStatus)
        return
      }
      setVariations(nextVariations)
      setSelectedId(nextVariations[0].id)
      setError(null)
      setStatus(
        formatStudioMessage(copy.generatedCount, {
          count: nextVariations.length,
        }),
      )
    } catch (generationError) {
      setVariations([])
      setSelectedId(null)
      setError(
        generationError instanceof Error && generationError.message
          ? formatStudioMessage(copy.generationFailedDetail, {
              message: generationError.message,
            })
          : copy.generationFailed,
      )
      setStatus(copy.noCandidatesStatus)
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
    setStatus(
      formatStudioMessage(copy.extractingColors, { source: sourceLabel }),
    )

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
        setError(
          formatStudioMessage(copy.noOpaqueColors, { source: sourceLabel }),
        )
        setStatus(copy.colorsNotExtracted)
        return
      }
      setStatus(
        formatStudioMessage(copy.extractedColors, {
          source: sourceLabel,
          count: colors.length,
        }),
      )
    } catch (extractionError) {
      if (extractionRequest.current !== request) {
        return
      }
      setExtractedColors([])
      setSelectedExtractedColor(null)
      setError(
        extractionError instanceof Error && extractionError.message
          ? formatStudioMessage(copy.extractionFailedDetail, {
              message: extractionError.message,
            })
          : copy.extractionFailed,
      )
      setStatus(copy.colorsNotExtracted)
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
      setError(copy.unlockColorsForExtract)
      return
    }
    setSelectedExtractedColor(color)
    setBaseColor(color)
    setError(null)
    if (variations.length === 0) {
      setStatus(formatStudioMessage(copy.baseColorSet, { color }))
      return
    }
    const nextRevision = seedRevision + 1
    setSeedRevision(nextRevision)
    generate(nextRevision, { baseColor: color })
  }

  const selectHarmony = (rule: ColorHarmonyRule): void => {
    if (locks.colors && selected) {
      setError(copy.unlockColorsForHarmony)
      return
    }
    setHarmonyRule(rule)
    setError(null)
    if (variations.length === 0) {
      const option = harmonyOptions.find(({ value }) => value === rule)
      setStatus(
        formatStudioMessage(copy.harmonySelected, {
          harmony: option?.label ?? rule,
        }),
      )
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
        formatStudioMessage(copy.colorApplied, {
          color: selectedExtractedColor,
          target: target === 'fill' ? copy.fill : copy.stroke,
        }),
      )
    } catch (applicationError) {
      setError(
        applicationError instanceof Error && applicationError.message
          ? formatStudioMessage(copy.colorApplyFailedDetail, {
              message: applicationError.message,
            })
          : copy.colorApplyFailed,
      )
    } finally {
      setIsApplyingColor(false)
    }
  }

  const insertSelected = async (): Promise<void> => {
    if (!selected) {
      setError(copy.selectCandidate)
      return
    }
    try {
      // Fabric measures the text as soon as it is created, so the bundled
      // fonts must be resolved first or the layout would be computed from
      // fallback metrics and baked into the inserted layers.
      await ensureLogoFontsLoaded()
      onInsert(selected)
      setError(null)
      setStatus(
        formatStudioMessage(copy.inserted, { template: selected.templateName }),
      )
    } catch (insertError) {
      setError(
        insertError instanceof Error && insertError.message
          ? formatStudioMessage(copy.insertFailedDetail, {
              message: insertError.message,
            })
          : copy.insertFailed,
      )
    }
  }

  return (
    <section
      className={['logo-generator-panel', className].filter(Boolean).join(' ')}
      aria-labelledby={headingId}
    >
      <header>
        <h2 id={headingId}>{copy.heading}</h2>
        <p>{copy.description}</p>
      </header>

      <form onSubmit={onGenerate} noValidate>
        <div className="logo-generator-fields">
          <label>
            <span>{copy.name}</span>
            <input
              type="text"
              value={name}
              maxLength={120}
              aria-required="true"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            <span>{copy.initials}</span>
            <input
              type="text"
              value={initials}
              maxLength={6}
              onChange={(event) => setInitials(event.target.value)}
            />
          </label>
          <label>
            <span>{copy.tagline}</span>
            <input
              type="text"
              value={tagline}
              maxLength={160}
              onChange={(event) => setTagline(event.target.value)}
            />
          </label>
          <label>
            <span>{copy.baseColor}</span>
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
            <span>{copy.harmonyRule}</span>
            <select
              value={harmonyRule}
              disabled={locks.colors && selected !== null}
              onChange={(event) =>
                selectHarmony(event.target.value as ColorHarmonyRule)
              }
            >
              {harmonyOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="logo-generator-actions">
          <button type="submit">{copy.generate}</button>
          <button
            type="button"
            disabled={variations.length === 0}
            onClick={reshuffle}
          >
            {copy.reshuffle}
          </button>
        </div>
      </form>

      <section
        className="logo-palette-assistant"
        aria-labelledby={paletteHeadingId}
        aria-busy={isExtracting}
      >
        <header>
          <h3 id={paletteHeadingId}>{copy.paletteHeading}</h3>
          <p>{copy.paletteDescription}</p>
        </header>

        <div className="logo-palette-source-actions">
          <label className="logo-palette-file">
            <span>
              {isExtracting ? copy.extracting : copy.extractFromImage}
            </span>
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
                void extractColors(getImageData, copy.currentCanvas)
              }
            >
              {copy.extractFromCanvas}
            </button>
          ) : null}
        </div>

        {extractedColors.length > 0 ? (
          <div
            className="logo-extracted-palette"
            role="list"
            aria-label={copy.extractedPalette}
          >
            {extractedColors.map((color) => (
              <div key={color.hex} role="listitem">
                <button
                  type="button"
                  aria-label={formatStudioMessage(copy.extractedColorLabel, {
                    color: color.hex,
                    ratio: Math.round(color.ratio * 100),
                  })}
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
          <p className="logo-palette-empty">{copy.paletteEmpty}</p>
        )}

        {onApplyColor ? (
          <div className="logo-palette-apply-actions">
            <button
              type="button"
              disabled={!selectedExtractedColor || isApplyingColor}
              onClick={() => void applyColorToEditor('fill')}
            >
              {copy.applyFill}
            </button>
            <button
              type="button"
              disabled={!selectedExtractedColor || isApplyingColor}
              onClick={() => void applyColorToEditor('stroke')}
            >
              {copy.applyStroke}
            </button>
          </div>
        ) : null}

        <fieldset className="logo-harmony-suggestions">
          <legend>{copy.harmonySuggestions}</legend>
          <div>
            {harmonyOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-label={formatStudioMessage(copy.selectHarmonyLabel, {
                  harmony: option.label,
                })}
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
        <legend>{copy.lockOptions}</legend>
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
          {copy.lockColors}
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
          {copy.lockFonts}
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
          {copy.lockLayout}
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
          aria-label={copy.candidates}
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
          {copy.emptyCandidates}
        </p>
      )}

      <button
        type="button"
        disabled={!selected}
        onClick={() => void insertSelected()}
      >
        {copy.insertSelected}
      </button>

      <p className="logo-font-attribution">
        {copy.bundledFonts}
        {BUNDLED_LOGO_FONT_LICENSES.map(({ family, license, url }, index) => (
          <span key={family}>
            {index > 0 ? copy.listSeparator : ''}
            <a href={url} target="_blank" rel="noreferrer noopener">
              {family}
            </a>
            {copy.licenseOpen}
            {license}
            {copy.licenseClose}
          </span>
        ))}
        {copy.fontAttribution}
      </p>
    </section>
  )
}

export default LogoGeneratorPanel
