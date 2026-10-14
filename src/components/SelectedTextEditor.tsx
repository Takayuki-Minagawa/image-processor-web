import { useEffect, useId, useRef, useState } from 'react'
import type {
  SelectedTextContent,
  TextContentSettings,
} from '../editor/fabricEngine'
import { designStudioCopy } from '../i18n.design'
import type { AppLocale } from '../uiPreferences'

interface Props {
  locale: AppLocale
  value: SelectedTextContent
  disabled?: boolean
  onApply: (settings: TextContentSettings) => void
}

export default function SelectedTextEditor({
  locale,
  value,
  disabled = false,
  onApply,
}: Props) {
  const copy = designStudioCopy(locale).text
  const hintId = useId()
  const errorId = useId()
  const composing = useRef(false)
  const [text, setText] = useState(value.text)
  const [fontSize, setFontSize] = useState(String(value.fontSize))
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    setText(value.text)
    setFontSize(String(value.fontSize))
    setInvalid(false)
    composing.current = false
  }, [value.id, value.text, value.fontSize])

  const unavailable = disabled || value.locked
  const changed = text !== value.text || fontSize !== String(value.fontSize)
  const reset = () => {
    setText(value.text)
    setFontSize(String(value.fontSize))
    setInvalid(false)
  }
  const apply = () => {
    if (unavailable || composing.current || !changed) return
    const size = Number(fontSize)
    if (!fontSize.trim() || !Number.isFinite(size) || size < 6 || size > 512) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setFontSize(String(size))
    onApply({ text, fontSize: size })
  }

  return (
    <form
      className="selected-text-editor"
      onSubmit={(event) => {
        event.preventDefault()
        apply()
      }}
      onCompositionStart={() => {
        composing.current = true
      }}
      onCompositionEnd={() => {
        composing.current = false
      }}
      onKeyDown={(event) => {
        if (
          composing.current ||
          event.nativeEvent.isComposing ||
          event.nativeEvent.keyCode === 229
        ) {
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          reset()
        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          event.stopPropagation()
          apply()
        }
      }}
    >
      <fieldset disabled={unavailable}>
        <legend>{copy.edit}</legend>
        <label>
          <span>{copy.body}</span>
          <textarea
            rows={4}
            value={text}
            aria-describedby={hintId}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <label>
          <span>{copy.fontSize}</span>
          <input
            type="text"
            inputMode="decimal"
            value={fontSize}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            onChange={(event) => {
              setFontSize(event.target.value)
              setInvalid(false)
            }}
          />
        </label>
        <small>
          {copy.font}: {value.fontFamily}
        </small>
        <p id={hintId} className="panel-intro">
          {value.locked ? copy.locked : copy.editingHint}
        </p>
        {invalid ? (
          <p id={errorId} role="alert">
            {copy.invalidFontSize}
          </p>
        ) : null}
        <div className="selected-text-actions">
          <button type="submit" disabled={!changed}>
            {copy.applyChanges}
          </button>
          <button type="button" disabled={!changed} onClick={reset}>
            {copy.resetChanges}
          </button>
        </div>
      </fieldset>
    </form>
  )
}
