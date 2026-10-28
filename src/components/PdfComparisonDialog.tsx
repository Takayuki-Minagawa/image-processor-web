import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppLocale } from '../uiPreferences'
import { comparisonCopy, comparisonErrorMessage } from '../i18n.comparison'
import { openPdf, type PdfSession } from '../import/pdf'
import {
  createPdfComparison,
  type ComparisonCapture,
  type PdfComparisonResult,
} from '../comparison/pdfComparison'
import './PdfComparisonDialog.css'

interface Props {
  locale: AppLocale
  captureCurrentPage: (signal: AbortSignal) => Promise<ComparisonCapture>
  onClose: () => void
}

type ComparisonMode = 'side' | 'overlay' | 'difference'

export default function PdfComparisonDialog({
  locale,
  captureCurrentPage,
  onClose,
}: Props) {
  const copy = comparisonCopy(locale)
  const captureCallback = useRef(captureCurrentPage)
  const [capture, setCapture] = useState<ComparisonCapture | null>(null)
  const [captureFailed, setCaptureFailed] = useState(false)
  const [selection, setSelection] = useState<{ file: File } | null>(null)
  const [session, setSession] = useState<PdfSession | null>(null)
  const [page, setPage] = useState(1)
  const [sourceFallback, setSourceFallback] = useState(false)
  const [opening, setOpening] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [result, setResult] = useState<PdfComparisonResult | null>(null)
  const [failure, setFailure] = useState<unknown>(null)
  const [mode, setMode] = useState<ComparisonMode>('side')
  const [opacity, setOpacity] = useState(50)
  const closedRef = useRef(false)
  const captureControllerRef = useRef<AbortController | null>(null)
  const loadControllerRef = useRef<AbortController | null>(null)
  const sessionRef = useRef<PdfSession | null>(null)
  const destroyedSessions = useRef(new WeakSet<PdfSession>())
  const renderRef = useRef<{
    controller: AbortController
    promise: Promise<void>
  } | null>(null)

  const destroySession = useCallback((value: PdfSession | null) => {
    if (!value || destroyedSessions.current.has(value)) return
    destroyedSessions.current.add(value)
    void value.destroy().catch(() => undefined)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    captureControllerRef.current = controller
    void captureCallback.current(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted && !closedRef.current) setCapture(value)
      },
      () => {
        if (!controller.signal.aborted && !closedRef.current)
          setCaptureFailed(true)
      },
    )
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!selection || !capture) return
    const controller = new AbortController()
    loadControllerRef.current = controller
    let opened: PdfSession | null = null
    void openPdf(selection.file, controller.signal).then(
      (value) => {
        opened = value
        if (controller.signal.aborted || closedRef.current) {
          destroySession(value)
          return
        }
        sessionRef.current = value
        const sourcePage = capture.sourcePageNumber
        const candidate =
          sourcePage !== undefined &&
          Number.isInteger(sourcePage) &&
          sourcePage >= 1 &&
          sourcePage <= value.pageCount
            ? sourcePage
            : 1
        setSourceFallback(sourcePage !== undefined && candidate !== sourcePage)
        setPage(candidate)
        setSession(value)
        setOpening(false)
      },
      (error: unknown) => {
        if (!controller.signal.aborted && !closedRef.current) {
          setFailure(error)
          setOpening(false)
        }
      },
    )
    return () => {
      controller.abort()
      destroySession(opened)
    }
  }, [selection, capture, destroySession])

  useEffect(() => {
    if (!capture || !session) return
    const controller = new AbortController()
    const previous = renderRef.current?.promise
    setRendering(true)
    setResult(null)
    setFailure(null)
    const promise = (async () => {
      // One render at a time, including an aborted request still settling.
      await previous
      if (controller.signal.aborted || closedRef.current) return
      try {
        const value = await createPdfComparison(
          capture,
          session,
          page,
          controller.signal,
        )
        if (!controller.signal.aborted && !closedRef.current) setResult(value)
      } catch (error) {
        if (!controller.signal.aborted && !closedRef.current) setFailure(error)
      } finally {
        if (!controller.signal.aborted && !closedRef.current)
          setRendering(false)
      }
    })()
    renderRef.current = { controller, promise }
    return () => controller.abort()
  }, [capture, session, page])

  const selectReference = (file: File) => {
    loadControllerRef.current?.abort()
    renderRef.current?.controller.abort()
    destroySession(sessionRef.current)
    sessionRef.current = null
    setSession(null)
    setResult(null)
    setFailure(null)
    setMode('side')
    setRendering(false)
    setOpening(true)
    setSelection({ file })
  }

  const selectPage = (value: number) => {
    if (
      !session ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > session.pageCount ||
      value === page
    )
      return
    renderRef.current?.controller.abort()
    setResult(null)
    setFailure(null)
    setMode('side')
    setPage(value)
  }

  const close = () => {
    closedRef.current = true
    captureControllerRef.current?.abort()
    loadControllerRef.current?.abort()
    renderRef.current?.controller.abort()
    destroySession(sessionRef.current)
    onClose()
  }

  const matched = result?.alignment === 'matched'
  const currentUrl = result?.currentUrl ?? capture?.dataUrl
  const currentWidth = result?.currentWidth ?? capture?.width
  const currentHeight = result?.currentHeight ?? capture?.height

  return (
    <div className="modal-form pdf-comparison-dialog">
      <p>{copy.referenceNotice}</p>
      <label>
        {copy.referenceFile}
        <input
          type="file"
          accept=".pdf,application/pdf"
          disabled={!capture}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) selectReference(file)
          }}
        />
      </label>
      {selection ? (
        <p className="pdf-comparison-file">{selection.file.name}</p>
      ) : null}
      {session ? (
        <>
          <div className="pdf-comparison-page-controls">
            <button
              type="button"
              className="secondary-button"
              disabled={page <= 1}
              onClick={() => selectPage(page - 1)}
            >
              {copy.previous}
            </button>
            <label>
              {copy.referencePage}
              <input
                type="number"
                min="1"
                max={session.pageCount}
                value={page}
                onChange={(event) => selectPage(Number(event.target.value))}
              />
            </label>
            <button
              type="button"
              className="secondary-button"
              disabled={page >= session.pageCount}
              onClick={() => selectPage(page + 1)}
            >
              {copy.next}
            </button>
            <span>
              {copy.pageCount}: {session.pageCount}
            </span>
          </div>
          {capture?.sourcePageNumber !== undefined ? (
            <p>{sourceFallback ? copy.sourceFallback : copy.sourceCandidate}</p>
          ) : null}
        </>
      ) : null}
      <div
        className="pdf-comparison-modes"
        role="group"
        aria-label={copy.modes}
      >
        {(['side', 'overlay', 'difference'] as const).map((value) => (
          <button
            key={value}
            type="button"
            className="secondary-button"
            aria-pressed={mode === value}
            disabled={
              !result ||
              (value !== 'side' && !matched) ||
              (value === 'difference' && !result.differenceUrl)
            }
            onClick={() => setMode(value)}
          >
            {value === 'side'
              ? copy.sideBySide
              : value === 'overlay'
                ? copy.overlay
                : copy.difference}
          </button>
        ))}
      </div>
      {capture ? (
        <div className="pdf-comparison-dimensions">
          <p>
            <strong>{copy.current}</strong>: {capture.name} ·{' '}
            {capture.documentWidth} × {capture.documentHeight} px ·{' '}
            {capture.physicalSize
              ? `${capture.physicalSize.widthMm.toFixed(2)} × ${capture.physicalSize.heightMm.toFixed(2)} mm`
              : copy.physicalUnknown}
          </p>
          {result ? (
            <p>
              <strong>{copy.reference}</strong>:{' '}
              {result.referenceInfo.pageNumber} ·{' '}
              {result.referenceInfo.widthMm.toFixed(2)} ×{' '}
              {result.referenceInfo.heightMm.toFixed(2)} mm
            </p>
          ) : null}
        </div>
      ) : null}
      {result ? (
        <p role="status">
          {matched
            ? copy.matched
            : result.alignment === 'size-mismatch'
              ? copy.sizeMismatch
              : copy.unknownSize}
        </p>
      ) : null}
      {captureFailed ? <p role="alert">{copy.captureFailed}</p> : null}
      {failure ? (
        <p role="alert">{comparisonErrorMessage(failure, locale)}</p>
      ) : null}
      {(!capture && !captureFailed) || opening || rendering ? (
        <p role="status">{copy.loading}</p>
      ) : null}
      {mode === 'side' ? (
        <div className="pdf-comparison-side">
          <figure>
            <figcaption>{copy.current}</figcaption>
            <div className="pdf-comparison-image-frame">
              {currentUrl ? (
                <img
                  src={currentUrl}
                  width={currentWidth}
                  height={currentHeight}
                  alt={copy.current}
                />
              ) : null}
            </div>
          </figure>
          <figure>
            <figcaption>{copy.reference}</figcaption>
            <div className="pdf-comparison-image-frame">
              {result ? (
                <img
                  src={result.referenceUrl}
                  width={result.referenceWidth}
                  height={result.referenceHeight}
                  alt={copy.reference}
                />
              ) : !selection ? (
                <p>{copy.chooseReference}</p>
              ) : null}
            </div>
          </figure>
        </div>
      ) : mode === 'overlay' && result && matched ? (
        <>
          <label className="pdf-comparison-opacity">
            <span>
              {copy.referenceOpacity} <output>{opacity}%</output>
            </span>
            <input
              type="range"
              aria-label={copy.referenceOpacity}
              min="0"
              max="100"
              step="1"
              value={opacity}
              onChange={(event) => setOpacity(Number(event.target.value))}
            />
          </label>
          <div
            className="pdf-comparison-overlay"
            role="img"
            aria-label={copy.overlayImage}
            style={{
              aspectRatio: `${result.currentWidth} / ${result.currentHeight}`,
              maxWidth: Math.min(
                560,
                (440 * result.currentWidth) / result.currentHeight,
              ),
            }}
          >
            <img src={result.currentUrl} alt="" aria-hidden="true" />
            <img
              src={result.referenceUrl}
              alt=""
              aria-hidden="true"
              style={{ opacity: opacity / 100 }}
            />
          </div>
        </>
      ) : mode === 'difference' && result?.differenceUrl && matched ? (
        <div className="pdf-comparison-image-frame">
          <img
            src={result.differenceUrl}
            width={result.currentWidth}
            height={result.currentHeight}
            alt={copy.differenceImage}
          />
        </div>
      ) : null}
      <p>{copy.fixedCapture}</p>
      <p>{copy.previewNotice}</p>
      <p>{copy.differenceNotice}</p>
      <div className="modal-actions">
        <button type="button" className="secondary-button" onClick={close}>
          {copy.close}
        </button>
      </div>
    </div>
  )
}
