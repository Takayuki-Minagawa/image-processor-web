import { useEffect, useRef, useState } from 'react'
import type { AppLocale } from '../uiPreferences'
import { svgCopy, svgErrorMessage } from '../i18n.svg'
import { MAX_SVG_BYTES, SvgSafetyError } from '../lib/svgSafety'
import {
  prepareSvgNativeImport,
  type SvgNativeGeometry,
} from '../import/svgGeometry'
import './SvgImportDialog.css'

export type SvgImportTarget = 'replace' | 'append'
interface Props {
  file: File
  locale: AppLocale
  onImport: (
    geometry: SvgNativeGeometry,
    target: SvgImportTarget,
    signal: AbortSignal,
  ) => Promise<boolean>
  onClose: () => void
}

export default function SvgImportDialog({
  file,
  locale,
  onImport,
  onClose,
}: Props) {
  const copy = svgCopy(locale)
  const [geometry, setGeometry] = useState<SvgNativeGeometry | null>(null)
  const [target, setTarget] = useState<SvgImportTarget>('replace')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const operationRef = useRef<AbortController | null>(null)
  const activeRef = useRef(true)

  useEffect(() => {
    let active = true
    activeRef.current = true
    void (async () => {
      if (!file.size || file.size > MAX_SVG_BYTES)
        throw new SvgSafetyError('svg-byte-limit', 'Invalid SVG file size')
      const source = await file.text()
      if (!active) return
      setGeometry(prepareSvgNativeImport(source))
    })().catch((failure: unknown) => {
      if (active) setError(svgErrorMessage(failure, locale))
    })
    return () => {
      active = false
      activeRef.current = false
      operationRef.current?.abort()
    }
  }, [file, locale])

  const run = async () => {
    if (!geometry || operationRef.current || (geometry.inferred && !confirmed))
      return
    const controller = new AbortController()
    operationRef.current = controller
    setWorking(true)
    setError('')
    try {
      const imported = await onImport(geometry, target, controller.signal)
      if (imported && activeRef.current) onClose()
    } catch (failure) {
      if (activeRef.current && !controller.signal.aborted)
        setError(svgErrorMessage(failure, locale))
    } finally {
      operationRef.current = null
      if (activeRef.current) setWorking(false)
    }
  }

  return (
    <form
      className="modal-form svg-import-form"
      onSubmit={(event) => {
        event.preventDefault()
        void run()
      }}
    >
      <p className="svg-file-name">{file.name}</p>
      {!geometry && !error ? <p role="status">{copy.loading}</p> : null}
      {geometry ? (
        <>
          <p>
            <strong>
              {copy.dimensions}: {geometry.width} × {geometry.height} px
            </strong>
          </p>
          {geometry.physicalSize ? (
            <p>
              {geometry.inferred ? copy.inferredPhysical : copy.physical}:{' '}
              {Number(geometry.physicalSize.widthMm.toFixed(4))} ×{' '}
              {Number(geometry.physicalSize.heightMm.toFixed(4))} mm
            </p>
          ) : null}
          <fieldset disabled={working}>
            {geometry.inferred ? (
              <>
                <p>{copy.inferred}</p>
                <label className="svg-inferred-confirmation">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  {copy.confirmInferred}
                </label>
              </>
            ) : null}
            <label>
              {copy.target}
              <select
                value={target}
                onChange={(event) =>
                  setTarget(event.target.value as SvgImportTarget)
                }
              >
                <option value="replace">{copy.replace}</option>
                <option value="append">{copy.append}</option>
              </select>
            </label>
          </fieldset>
          {geometry.removedElements + geometry.removedAttributes > 0 ? (
            <p role="status">{copy.sanitized}</p>
          ) : null}
        </>
      ) : null}
      <p className="field-note">{copy.units}</p>
      <p className="field-note">{copy.material}</p>
      <p className="field-note">{copy.limitations}</p>
      {error ? <p role="alert">{error}</p> : null}
      {working ? <p role="status">{copy.committing}</p> : null}
      <div className="modal-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            operationRef.current?.abort()
            onClose()
          }}
        >
          {copy.cancel}
        </button>
        <button
          type="submit"
          className="primary-button"
          disabled={!geometry || working || (geometry.inferred && !confirmed)}
        >
          {copy.submit}
        </button>
      </div>
    </form>
  )
}
