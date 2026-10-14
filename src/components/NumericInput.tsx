import { useId, useState } from 'react'
import { inspectorCopy } from '../i18n.inspector'
import type { AppLocale } from '../uiPreferences'

interface NumericInputProps {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  integer?: boolean
  locale: AppLocale
  disabled?: boolean
  describedBy?: string
  onCommit: (value: number) => void
}

// Keep incomplete input (including empty, '-' and decimal points) separate
// from the document. External edits and Undo replace the draft with the model.
export default function NumericInput({
  label,
  value,
  min,
  max,
  step = 1,
  integer = false,
  locale,
  disabled,
  describedBy,
  onCommit,
}: NumericInputProps) {
  const id = useId()
  const copy = inspectorCopy(locale)
  const [state, setState] = useState({
    model: value,
    draft: String(value),
    error: '',
  })
  if (state.model !== value) {
    setState({ model: value, draft: String(value), error: '' })
  }
  const reset = () =>
    setState({ model: value, draft: String(value), error: '' })
  const commit = () => {
    const text = state.draft.trim()
    const next = Number(text)
    const error =
      !text || !Number.isFinite(next)
        ? copy.invalidNumber
        : integer && !Number.isInteger(next)
          ? copy.invalidInteger
          : (min !== undefined && next < min) ||
              (max !== undefined && next > max)
            ? copy.outOfRange(min, max)
            : ''
    if (error) {
      setState({ ...state, error })
      return
    }
    setState({ model: value, draft: String(next), error: '' })
    if (next !== value) onCommit(next)
  }
  return (
    <span className="numeric-input-field">
      <input
        type="text"
        inputMode="decimal"
        role="spinbutton"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-invalid={Boolean(state.error)}
        aria-describedby={
          [describedBy, state.error ? id : undefined]
            .filter(Boolean)
            .join(' ') || undefined
        }
        value={state.draft}
        disabled={disabled}
        onChange={(event) =>
          setState({ model: value, draft: event.target.value, error: '' })
        }
        onBlur={commit}
        onKeyDown={(event) => {
          if (
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229
          )
            return
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            reset()
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            const parsed = Number(state.draft)
            const start =
              state.draft.trim() &&
              Number.isFinite(parsed) &&
              (!integer || Number.isInteger(parsed))
                ? parsed
                : value
            const next = Math.min(
              max ?? Infinity,
              Math.max(
                min ?? -Infinity,
                Number(
                  (
                    start + (event.key === 'ArrowUp' ? step : -step)
                  ).toPrecision(15),
                ),
              ),
            )
            setState({ model: value, draft: String(next), error: '' })
            if (next !== value) onCommit(next)
          }
        }}
      />
      {state.error ? (
        <span id={id} className="numeric-input-error" role="alert">
          {state.error}
        </span>
      ) : null}
    </span>
  )
}
