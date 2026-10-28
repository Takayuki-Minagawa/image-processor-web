import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PdfComparisonDialog from './PdfComparisonDialog'
import type {
  ComparisonCapture,
  PdfComparisonResult,
} from '../comparison/pdfComparison'
import type { PdfSession } from '../import/pdf'

const mock = vi.hoisted(() => ({
  openPdf: vi.fn(),
  createPdfComparison: vi.fn(),
}))
vi.mock('../import/pdf', () => ({ openPdf: mock.openPdf }))
vi.mock('../comparison/pdfComparison', () => ({
  createPdfComparison: mock.createPdfComparison,
}))

const capture: ComparisonCapture = {
  dataUrl: 'data:image/png;base64,current',
  width: 100,
  height: 200,
  documentWidth: 300,
  documentHeight: 600,
  name: 'Edited page',
  physicalSize: {
    unit: 'mm',
    widthMm: 25.4,
    heightMm: 50.8,
    sourceDpi: 300,
  },
  sourcePageNumber: 2,
}

const result = (pageNumber = 2): PdfComparisonResult => ({
  currentUrl: 'data:image/png;base64,current-white',
  referenceUrl: `data:image/png;base64,reference-${pageNumber}`,
  differenceUrl: `data:image/png;base64,difference-${pageNumber}`,
  currentWidth: 100,
  currentHeight: 200,
  referenceWidth: 100,
  referenceHeight: 200,
  referenceInfo: {
    pageNumber,
    widthMm: 25.4,
    heightMm: 50.8,
    widthPoints: 72,
    heightPoints: 144,
    rotation: 0,
  },
  alignment: 'matched',
})

const session = (pageCount = 3): PdfSession => ({
  pageCount,
  getPageInfo: vi.fn(),
  renderPage: vi.fn(),
  thumbnail: vi.fn(),
  destroy: vi.fn().mockResolvedValue(undefined),
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

afterEach(cleanup)
beforeEach(() => {
  vi.resetAllMocks()
  mock.openPdf.mockResolvedValue(session())
  mock.createPdfComparison.mockImplementation(
    async (_capture: ComparisonCapture, _session: PdfSession, page: number) =>
      result(page),
  )
})

function setup(
  captureCurrentPage = vi.fn().mockResolvedValue(capture),
  locale: 'en' | 'ja' = 'en',
) {
  const onClose = vi.fn()
  const view = render(
    <PdfComparisonDialog
      locale={locale}
      captureCurrentPage={captureCurrentPage}
      onClose={onClose}
    />,
  )
  return { ...view, onClose, captureCurrentPage }
}

async function chooseFile(name = 'reference.pdf') {
  const input = screen.getByLabelText('Choose reference PDF')
  await waitFor(() => expect(input).toBeEnabled())
  fireEvent.change(input, {
    target: {
      files: [new File(['%PDF-1.7'], name, { type: 'application/pdf' })],
    },
  })
}

describe('PDF comparison dialog', () => {
  it('captures once, suggests the imported page, and renders only the selected reference page', async () => {
    const { captureCurrentPage, rerender, onClose } = setup()
    await chooseFile()
    await screen.findByRole('img', { name: 'Reference PDF page' })
    expect(screen.getByLabelText('Reference page number')).toHaveValue(2)
    expect(mock.createPdfComparison).toHaveBeenCalledTimes(1)
    expect(mock.createPdfComparison.mock.calls[0][2]).toBe(2)
    expect(
      screen.getByText(/cannot verify that it is the same original/),
    ).toBeVisible()
    expect(screen.getByText(/page number is a suggestion/)).toBeVisible()
    const replacementCapture = vi.fn().mockResolvedValue(capture)
    rerender(
      <PdfComparisonDialog
        locale="ja"
        captureCurrentPage={replacementCapture}
        onClose={onClose}
      />,
    )
    expect(captureCurrentPage).toHaveBeenCalledOnce()
    expect(replacementCapture).not.toHaveBeenCalled()
    expect(mock.openPdf).toHaveBeenCalledOnce()
    expect(mock.createPdfComparison).toHaveBeenCalledOnce()
    expect(screen.getByRole('img', { name: '現在のページ' })).toHaveAttribute(
      'src',
      result().currentUrl,
    )
  })

  it('offers matched overlay opacity and pixel difference without recapturing or rerendering the PDF', async () => {
    const { captureCurrentPage } = setup()
    await chooseFile()
    const overlayButton = screen.getByRole('button', { name: 'Overlay' })
    await waitFor(() => expect(overlayButton).toBeEnabled())
    fireEvent.click(overlayButton)
    const overlay = screen.getByRole('img', {
      name: 'Current and reference overlay',
    })
    expect(overlay.querySelectorAll('img')).toHaveLength(2)
    expect(overlay.querySelectorAll('img')[1]).toHaveStyle({ opacity: '0.5' })
    const slider = screen.getByRole('slider', {
      name: /Reference page opacity/,
    })
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '100')
    fireEvent.change(slider, { target: { value: '80' } })
    expect(overlay.querySelectorAll('img')[1]).toHaveStyle({ opacity: '0.8' })
    fireEvent.click(screen.getByRole('button', { name: 'Difference' }))
    expect(
      screen.getByRole('img', {
        name: 'Current and reference pixel difference',
      }),
    ).toHaveAttribute('src', result().differenceUrl)
    expect(screen.getByText(/Black pixels match/)).toBeVisible()
    expect(screen.getByText(/does not prove an exact match/)).toBeVisible()
    expect(mock.createPdfComparison).toHaveBeenCalledOnce()
    expect(captureCurrentPage).toHaveBeenCalledOnce()
  })

  it.each(['size-mismatch', 'unknown-size'] as const)(
    'keeps %s previews separate and disables overlay and difference',
    async (alignment) => {
      mock.createPdfComparison.mockResolvedValue({
        ...result(),
        alignment,
        referenceWidth: 150,
        differenceUrl: undefined,
      })
      setup()
      await chooseFile()
      await screen.findByRole('img', { name: 'Reference PDF page' })
      expect(screen.getByRole('button', { name: 'Overlay' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Difference' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Side by side' })).toBeEnabled()
      expect(screen.getByText(/not on the same scale/)).toBeVisible()
    },
  )

  it('explains falling back to page 1 when the imported page does not exist in the selected PDF', async () => {
    mock.openPdf.mockResolvedValue(session(1))
    setup()
    await chooseFile()
    await screen.findByRole('img', { name: 'Reference PDF page' })
    expect(screen.getByLabelText('Reference page number')).toHaveValue(1)
    expect(screen.getByText(/outside the selected PDF/)).toBeVisible()
    expect(mock.createPdfComparison.mock.calls[0][2]).toBe(1)
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
  })

  it('aborts a stale page and waits for it to settle before rendering the next page', async () => {
    const first = deferred<PdfComparisonResult>()
    mock.createPdfComparison.mockReturnValueOnce(first.promise)
    setup()
    await chooseFile()
    await waitFor(() => expect(mock.createPdfComparison).toHaveBeenCalledOnce())
    const firstSignal = mock.createPdfComparison.mock.calls[0][3] as AbortSignal
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(firstSignal.aborted).toBe(true)
    expect(mock.createPdfComparison).toHaveBeenCalledOnce()
    expect(screen.queryByRole('img', { name: 'Reference PDF page' })).toBeNull()
    await act(async () => first.resolve(result(2)))
    await waitFor(() =>
      expect(mock.createPdfComparison).toHaveBeenCalledTimes(2),
    )
    expect(mock.createPdfComparison.mock.calls[1][2]).toBe(3)
    expect(
      await screen.findByRole('img', { name: 'Reference PDF page' }),
    ).toHaveAttribute('src', result(3).referenceUrl)
  })

  it('destroys a late session from an obsolete file selection without displaying it', async () => {
    const first = deferred<PdfSession>()
    const obsolete = session(10)
    const latest = session(1)
    mock.openPdf
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(latest)
    setup()
    await chooseFile('old.pdf')
    const firstSignal = mock.openPdf.mock.calls[0][1] as AbortSignal
    await chooseFile('new.pdf')
    expect(firstSignal.aborted).toBe(true)
    await screen.findByRole('img', { name: 'Reference PDF page' })
    await act(async () => first.resolve(obsolete))
    expect(obsolete.destroy).toHaveBeenCalledOnce()
    expect(latest.destroy).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Reference page number')).toHaveValue(1)
    expect(mock.createPdfComparison).toHaveBeenCalledOnce()
    expect(mock.createPdfComparison.mock.calls[0][1]).toBe(latest)
  })

  it('releases the previous session on reselection and discards its delayed render failure', async () => {
    const first = deferred<PdfComparisonResult>()
    const previous = session()
    const latest = session(1)
    mock.openPdf.mockResolvedValueOnce(previous).mockResolvedValueOnce(latest)
    mock.createPdfComparison.mockReturnValueOnce(first.promise)
    setup()
    await chooseFile('old.pdf')
    await waitFor(() => expect(mock.createPdfComparison).toHaveBeenCalledOnce())
    const firstSignal = mock.createPdfComparison.mock.calls[0][3] as AbortSignal
    await chooseFile('new.pdf')
    expect(firstSignal.aborted).toBe(true)
    expect(previous.destroy).toHaveBeenCalledOnce()
    await act(async () => first.reject(new Error('old render failure')))
    await screen.findByRole('img', { name: 'Reference PDF page' })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(mock.createPdfComparison.mock.calls[1][1]).toBe(latest)
  })

  it('keeps Close available while capturing and ignores the delayed capture after closing', async () => {
    const delayed = deferred<ComparisonCapture>()
    const captureCurrentPage = vi.fn().mockReturnValue(delayed.promise)
    const { onClose } = setup(captureCurrentPage)
    const signal = captureCurrentPage.mock.calls[0][0] as AbortSignal
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(signal.aborted).toBe(true)
    await act(async () => delayed.resolve(capture))
    expect(screen.queryByRole('img', { name: 'Current page' })).toBeNull()
    expect(mock.openPdf).not.toHaveBeenCalled()
  })

  it('aborts rendering and destroys the session once when closed and unmounted', async () => {
    const delayed = deferred<PdfComparisonResult>()
    const opened = session()
    mock.openPdf.mockResolvedValue(opened)
    mock.createPdfComparison.mockReturnValue(delayed.promise)
    const { unmount, onClose } = setup()
    await chooseFile()
    await waitFor(() => expect(mock.createPdfComparison).toHaveBeenCalledOnce())
    const signal = mock.createPdfComparison.mock.calls[0][3] as AbortSignal
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(signal.aborted).toBe(true)
    expect(opened.destroy).toHaveBeenCalledOnce()
    unmount()
    await act(async () => delayed.resolve(result()))
    expect(opened.destroy).toHaveBeenCalledOnce()
  })

  it('destroys a session that finishes opening after unmount', async () => {
    const delayed = deferred<PdfSession>()
    const opened = session()
    mock.openPdf.mockReturnValue(delayed.promise)
    const { unmount } = setup()
    await chooseFile()
    const signal = mock.openPdf.mock.calls[0][1] as AbortSignal
    unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => delayed.resolve(opened))
    expect(opened.destroy).toHaveBeenCalledOnce()
    expect(mock.createPdfComparison).not.toHaveBeenCalled()
  })

  it('localizes PDF failures and recovers when another reference is selected', async () => {
    mock.openPdf.mockRejectedValueOnce({ code: 'password-required' })
    const { captureCurrentPage } = setup()
    await chooseFile('locked.pdf')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Password-protected PDFs are not supported',
    )
    await chooseFile('readable.pdf')
    await screen.findByRole('img', { name: 'Reference PDF page' })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(captureCurrentPage).toHaveBeenCalledOnce()
  })

  it('shows capture failure without enabling file input and still allows closing', async () => {
    const { onClose } = setup(
      vi.fn().mockRejectedValue(new Error('capture failed')),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not capture the current page',
    )
    expect(screen.getByLabelText('Choose reference PDF')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('explains dimension failures without suggesting a nonexistent DPI control and recovers on another page', async () => {
    mock.createPdfComparison.mockRejectedValueOnce({ code: 'page-size-limit' })
    setup()
    await chooseFile()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Select another page or PDF')
    expect(alert).not.toHaveTextContent('DPI')
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    await screen.findByRole('img', { name: 'Reference PDF page' })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(mock.createPdfComparison.mock.calls[1][2]).toBe(1)
  })
})
