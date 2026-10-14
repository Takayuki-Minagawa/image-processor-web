import { useId } from 'react'
import { inspectorCopy } from '../i18n.inspector'
import type { AppLocale } from '../uiPreferences'
import NumericInput from './NumericInput'

export default function AdjustmentControl({
  label,
  value,
  min = -1,
  max = 1,
  step = 0.01,
  integer = false,
  scale = 100,
  unit = '',
  locale,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  integer?: boolean
  scale?: number
  unit?: string
  locale: AppLocale
  onChange: (value: number) => void
}) {
  const id = useId()
  const hintId = `${id}-hint`
  const copy = inspectorCopy(locale)
  // Remove binary arithmetic noise without limiting precise input to four decimals.
  const scaled = (number: number) => Number((number * scale).toPrecision(15))
  const displayed = scaled(value)
  const minimum = scaled(min)
  const maximum = scaled(max)
  const increment = scaled(step)
  return (
    <div className="adjustment-control">
      <span>
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>
          {displayed}
          {unit}
        </output>
      </span>
      <input
        id={id}
        type="range"
        aria-label={label}
        aria-valuetext={`${displayed}${unit}`}
        aria-describedby={hintId}
        min={minimum}
        max={maximum}
        step={integer ? increment : 'any'}
        value={displayed}
        onChange={(event) => onChange(Number(event.target.value) / scale)}
        onKeyDown={(event) => {
          const direction =
            event.key === 'ArrowUp' || event.key === 'ArrowRight'
              ? 1
              : event.key === 'ArrowDown' || event.key === 'ArrowLeft'
                ? -1
                : 0
          if (!direction) return
          event.preventDefault()
          const next = Math.min(
            maximum,
            Math.max(
              minimum,
              Number((displayed + direction * increment).toPrecision(15)),
            ),
          )
          if (next !== displayed) onChange(next / scale)
        }}
      />
      <NumericInput
        label={copy.numericLabel(label)}
        value={displayed}
        min={minimum}
        max={maximum}
        step={increment}
        integer={integer}
        locale={locale}
        describedBy={hintId}
        onCommit={(next) => onChange(next / scale)}
      />
      <small id={hintId}>{copy.range(minimum, maximum, unit)}</small>
    </div>
  )
}
