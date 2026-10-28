import { useEffect, useRef, useState } from 'react'
import type { AppLocale } from '../uiPreferences'
import { pdfCopy, pdfErrorMessage } from '../i18n.pdf'
import {
  openPdf,
  type PdfSession,
  type PdfPageInfo,
  type PdfRasterPage,
} from '../import/pdf'
import {
  estimatePdfSelection,
  parsePdfPageRange,
  PDF_IMPORT_LIMITS,
} from '../import/pdfSelection'
import './PdfImportDialog.css'

export type PdfImportTarget = 'replace' | 'append'
interface Props {
  file: File
  locale: AppLocale
  onImport: (
    pages: PdfRasterPage[],
    target: PdfImportTarget,
    signal: AbortSignal,
  ) => Promise<boolean>
  onClose: () => void
}

export default function PdfImportDialog({
  file,
  locale,
  onImport,
  onClose,
}: Props) {
  const copy = pdfCopy(locale)
  const [session, setSession] = useState<PdfSession | null>(null)
  const [current, setCurrent] = useState(1)
  const [range, setRange] = useState('1')
  const [dpi, setDpi] = useState(150)
  const [target, setTarget] = useState<PdfImportTarget>('replace')
  const [preview, setPreview] = useState<{
    url: string
    info: PdfPageInfo
  } | null>(null)
  const [selection, setSelection] = useState<{
    pages: number[]
    estimate: ReturnType<typeof estimatePdfSelection>
  } | null>(null)
  const [error, setError] = useState('')
  const [selectionError, setSelectionError] = useState('')
  const [progress, setProgress] = useState<string | null>(null)
  const operationRef = useRef<AbortController | null>(null)
  const previewRef = useRef<{
    controller: AbortController
    promise: Promise<void>
  } | null>(null)
  const activeRef = useRef(true)

  useEffect(() => {
    activeRef.current = true
    const controller = new AbortController()
    let opened: PdfSession | undefined
    void openPdf(file, controller.signal)
      .then((value) => {
        opened = value
        if (controller.signal.aborted) return value.destroy()
        setSession(value)
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(pdfErrorMessage(failure, locale))
      })
    return () => {
      activeRef.current = false
      operationRef.current?.abort()
      previewRef.current?.controller.abort()
      controller.abort()
      void opened?.destroy()
    }
  }, [file, locale])

  useEffect(() => {
    if (!session || progress !== null) return
    const controller = new AbortController()
    const previous = previewRef.current?.promise
    const promise = (async () => {
      await previous
      if (controller.signal.aborted) return
      setPreview(null)
      try {
        const info = await session.getPageInfo(current)
        const url = await session.thumbnail(current, controller.signal)
        if (!controller.signal.aborted) setPreview({ url, info })
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(pdfErrorMessage(failure, locale))
      }
    })()
    previewRef.current = { controller, promise }
    return () => controller.abort()
  }, [current, session, progress, locale])

  useEffect(() => {
    if (!session || progress !== null) return
    let active = true
    setSelection(null)
    setSelectionError('')
    void (async () => {
      const pages = parsePdfPageRange(range, session.pageCount)
      const info: PdfPageInfo[] = []
      for (const page of pages) {
        if (!active) return
        info.push(await session.getPageInfo(page))
      }
      const estimate = estimatePdfSelection(info, dpi)
      if (active) setSelection({ pages, estimate })
    })().catch((failure: unknown) => {
      if (active) setSelectionError(pdfErrorMessage(failure, locale))
    })
    return () => {
      active = false
    }
  }, [range, dpi, session, locale, progress])

  const run = async () => {
    if (!session || !selection || operationRef.current) return
    const controller = new AbortController()
    operationRef.current = controller
    previewRef.current?.controller.abort()
    setError('')
    setProgress(`0 / ${selection.pages.length}`)
    try {
      await previewRef.current?.promise
      const rasters: PdfRasterPage[] = []
      let encodedCharacters = 0
      for (const page of selection.pages) {
        controller.signal.throwIfAborted()
        const raster = await session.renderPage(page, dpi, controller.signal)
        encodedCharacters += raster.dataUrl.length
        if (encodedCharacters > PDF_IMPORT_LIMITS.encodedCharacters)
          throw new RangeError('encoded-size-limit')
        rasters.push(raster)
        setProgress(`${rasters.length} / ${selection.pages.length}`)
      }
      controller.signal.throwIfAborted()
      setProgress(copy.committing)
      const imported = await onImport(rasters, target, controller.signal)
      if (imported && activeRef.current) onClose()
    } catch (failure) {
      if (activeRef.current && !controller.signal.aborted)
        setError(pdfErrorMessage(failure, locale))
    } finally {
      operationRef.current = null
      if (activeRef.current) setProgress(null)
    }
  }

  const toggleCurrent = () => {
    const pages = new Set(selection?.pages ?? [])
    if (pages.has(current)) pages.delete(current)
    else pages.add(current)
    setRange([...pages].sort((a, b) => a - b).join(', '))
  }

  return (
    <form
      className="modal-form pdf-import-form"
      onSubmit={(event) => {
        event.preventDefault()
        void run()
      }}
    >
      <p>{copy.appearance}</p>
      {!session && !error ? <p role="status">{copy.loading}</p> : null}
      {session ? (
        <>
          <fieldset disabled={progress !== null}>
            <legend>{copy.preview}</legend>
            <div className="pdf-preview">
              {preview ? (
                <>
                  <img src={preview.url} alt={`${copy.preview} ${current}`} />
                  <p>
                    {current} / {session.pageCount} ·{' '}
                    {preview.info.widthMm.toFixed(2)} ×{' '}
                    {preview.info.heightMm.toFixed(2)} mm
                  </p>
                </>
              ) : (
                <p role="status">{copy.loading}</p>
              )}
            </div>
            <div className="pdf-page-controls">
              <button
                type="button"
                className="secondary-button"
                disabled={current <= 1}
                onClick={() => setCurrent(current - 1)}
              >
                {copy.previous}
              </button>
              <input
                type="number"
                min="1"
                max={session.pageCount}
                aria-label={copy.preview}
                value={current}
                onChange={(event) => {
                  const n = Number(event.target.value)
                  if (Number.isInteger(n) && n >= 1 && n <= session.pageCount)
                    setCurrent(n)
                }}
              />
              <button
                type="button"
                className="secondary-button"
                disabled={current >= session.pageCount}
                onClick={() => setCurrent(current + 1)}
              >
                {copy.next}
              </button>
            </div>
            <div className="pdf-page-controls">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setRange(String(current))}
              >
                {copy.current}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={toggleCurrent}
              >
                {copy.toggle}
              </button>
            </div>
            <label>
              {copy.range}
              <input
                value={range}
                onChange={(event) => setRange(event.target.value)}
              />
            </label>
            <label>
              {copy.dpi}
              <select
                value={dpi}
                onChange={(event) => setDpi(Number(event.target.value))}
              >
                {[72, 150, 300].map((value) => (
                  <option key={value} value={value}>
                    {value} dpi
                  </option>
                ))}
              </select>
            </label>
            <label>
              {copy.target}
              <select
                value={target}
                onChange={(event) =>
                  setTarget(event.target.value as PdfImportTarget)
                }
              >
                <option value="replace">{copy.replace}</option>
                <option value="append">{copy.append}</option>
              </select>
            </label>
          </fieldset>
          {selection ? (
            <p className="pdf-estimate">
              {copy.selected}: {selection.pages.length} · {copy.pixels}:{' '}
              {(selection.estimate.totalPixels / 1e6).toFixed(1)} MP ·{' '}
              {copy.largest}:{' '}
              {(selection.estimate.largestPixels / 1e6).toFixed(1)} MP ·{' '}
              {copy.memory}: {selection.estimate.memoryMiB} MiB
            </p>
          ) : null}
          {selectionError ? <p role="alert">{selectionError}</p> : null}
          <p className="field-note">{copy.estimateNote}</p>
        </>
      ) : null}
      <p className="field-note">{copy.limits}</p>
      {error ? <p role="alert">{error}</p> : null}
      {progress !== null ? <p role="status">{progress}</p> : null}
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
          disabled={!selection || progress !== null}
        >
          {copy.submit}
        </button>
      </div>
    </form>
  )
}
