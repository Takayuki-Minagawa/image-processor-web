import { useRef, useState } from 'react'
import { Copy, Download } from 'lucide-react'
import type { ExportImageFormat } from '../editor/fabricEngine'
import type { EditorUiCopy } from '../i18n'
import { sanitizeFileStem } from '../lib/fileCore'
import { imageDimensionsAreSafe } from '../lib/imageSafety'
import { canCopyPngToClipboard } from '../export/clipboardImage'
import { calculateRasterExportDimensions } from '../export/rasterImage'

export interface ExportImageSettings {
  format: ExportImageFormat | 'svg'
  quality: number
  multiplier: number
  svgScope: 'document' | 'selection'
}

export type ExportImageAction = 'download' | 'clipboard'

interface Props {
  settings: ExportImageSettings
  onChange: (settings: ExportImageSettings) => void
  documentSize: { width: number; height: number }
  projectName: string
  ui: EditorUiCopy
  busy: boolean
  onExport: (action: ExportImageAction) => Promise<void>
  onClose: () => void
}

export default function ExportImageForm({
  settings,
  onChange,
  documentSize,
  projectName,
  ui,
  busy,
  onExport,
  onClose,
}: Props) {
  const pendingRef = useRef(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<{
    error: boolean
    message: string
  } | null>(null)
  const supported = canCopyPngToClipboard()
  const outputSize = (multiplier: number) =>
    calculateRasterExportDimensions(
      documentSize.width,
      documentSize.height,
      multiplier,
    )
  const dimensions = outputSize(settings.multiplier)
  const safe = settings.format === 'svg' || imageDimensionsAreSafe(dimensions)
  const disabled = pending || busy
  const change = (update: Partial<ExportImageSettings>) => {
    setFeedback(null)
    onChange({ ...settings, ...update })
  }
  const run = async (action: ExportImageAction) => {
    if (pendingRef.current || busy || !safe) return
    pendingRef.current = true
    setPending(true)
    setFeedback(null)
    try {
      await onExport(action)
      if (action === 'clipboard')
        setFeedback({ error: false, message: ui.clipboardCopied })
    } catch (error) {
      setFeedback({
        error: true,
        message: error instanceof Error ? error.message : ui.exportFailed,
      })
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  return (
    <form
      className="modal-form"
      onSubmit={(event) => {
        event.preventDefault()
        void run('download')
      }}
    >
      <fieldset className="format-options" disabled={disabled}>
        <legend>{ui.fileFormat}</legend>
        {(['png', 'jpeg', 'webp', 'svg'] as const).map((format) => (
          <label
            key={format}
            className={settings.format === format ? 'selected' : ''}
          >
            <input
              type="radio"
              name="format"
              value={format}
              checked={settings.format === format}
              onChange={() => change({ format })}
            />
            <span>{format === 'jpeg' ? 'JPG' : format.toUpperCase()}</span>
            <small>{ui.formatNotes[format]}</small>
          </label>
        ))}
      </fieldset>
      <label className="adjustment-control">
        <span>
          {ui.quality}
          <output>{Math.round(settings.quality * 100)}%</output>
        </span>
        <input
          type="range"
          aria-label={ui.quality}
          min="0.1"
          max="1"
          step="0.01"
          disabled={
            disabled || settings.format === 'png' || settings.format === 'svg'
          }
          value={settings.quality}
          onChange={(event) => change({ quality: Number(event.target.value) })}
        />
      </label>
      {settings.format === 'svg' ? (
        <>
          <label>
            <span>{ui.svgScope}</span>
            <select
              disabled={disabled}
              value={settings.svgScope}
              onChange={(event) =>
                change({
                  svgScope: event.target.value as 'document' | 'selection',
                })
              }
            >
              <option value="document">{ui.wholeCanvas}</option>
              <option value="selection">{ui.selectedObject}</option>
            </select>
          </label>
          <p className="panel-intro">{ui.svgEmbeddedHint}</p>
        </>
      ) : null}
      <label>
        <span>{ui.scale}</span>
        <select
          disabled={disabled || settings.format === 'svg'}
          value={settings.multiplier}
          onChange={(event) =>
            change({ multiplier: Number(event.target.value) })
          }
        >
          {[0.5, 1, 2].map((multiplier) => (
            <option
              key={multiplier}
              value={multiplier}
              disabled={!imageDimensionsAreSafe(outputSize(multiplier))}
            >
              {multiplier === 1 ? ui.originalScale : `${multiplier}×`}
            </option>
          ))}
        </select>
      </label>
      <div className="export-summary">
        <span aria-hidden="true">▧</span>
        <span>
          <strong>
            {settings.format === 'svg'
              ? settings.svgScope === 'document'
                ? `${documentSize.width} × ${documentSize.height} viewBox`
                : ui.selectionViewBox
              : `${dimensions.width} × ${dimensions.height} px`}
          </strong>
          <small>
            {sanitizeFileStem(projectName)}.
            {settings.format === 'jpeg' ? 'jpg' : settings.format}
          </small>
        </span>
      </div>
      {!safe ? <p role="alert">{ui.exportTooLarge}</p> : null}
      {settings.format === 'png' && !supported ? (
        <p className="panel-intro">{ui.clipboardUnavailable}</p>
      ) : null}
      {feedback ? (
        <p role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>
      ) : null}
      <div className="modal-actions">
        <button className="secondary-button" type="button" onClick={onClose}>
          {ui.cancel}
        </button>
        {settings.format === 'png' ? (
          <button
            className="secondary-button"
            type="button"
            disabled={disabled || !safe || !supported}
            onClick={() => void run('clipboard')}
          >
            <Copy aria-hidden="true" />
            {ui.copyPng}
          </button>
        ) : null}
        <button
          className="primary-button"
          type="submit"
          disabled={disabled || !safe}
        >
          <Download aria-hidden="true" />
          {ui.download}
        </button>
      </div>
    </form>
  )
}
