import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PdfImportDialog from './PdfImportDialog'

const mock = vi.hoisted(() => ({
  openPdf: vi.fn(),
  session: {
    pageCount: 2,
    getPageInfo: vi.fn(),
    renderPage: vi.fn(),
    thumbnail: vi.fn(),
    destroy: vi.fn(),
  },
}))
vi.mock('../import/pdf', () => ({ openPdf: mock.openPdf }))
const info = {
  pageNumber: 1,
  widthMm: 25.4,
  heightMm: 50.8,
  widthPoints: 72,
  heightPoints: 144,
  rotation: 0,
}

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  mock.openPdf.mockResolvedValue(mock.session)
  mock.session.getPageInfo.mockImplementation(async (pageNumber: number) => ({
    ...info,
    pageNumber,
  }))
  mock.session.thumbnail.mockResolvedValue('data:image/png;base64,preview')
  mock.session.renderPage.mockImplementation(
    async (pageNumber: number, dpi: number) => ({
      ...info,
      pageNumber,
      dpi,
      width: dpi,
      height: dpi * 2,
      dataUrl: 'data:image/png;base64,image',
    }),
  )
  mock.session.destroy.mockResolvedValue(undefined)
})

function setup(onImport = vi.fn().mockResolvedValue(true)) {
  const onClose = vi.fn()
  const view = render(
    <PdfImportDialog
      file={new File(['%PDF'], 'input.pdf')}
      locale="en"
      onImport={onImport}
      onClose={onClose}
    />,
  )
  return { ...view, onImport, onClose }
}

describe('PDF import dialog', () => {
  it('defaults to one page, shows physical preview, and imports ordered selection', async () => {
    const { onImport, onClose } = setup()
    await screen.findByText('1 / 2 · 25.40 × 50.80 mm')
    fireEvent.change(screen.getByLabelText('Page range (e.g. 1, 3-5)'), {
      target: { value: '2,1' },
    })
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Import selected pages' }),
      ).toBeEnabled(),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Import selected pages' }),
    )
    await waitFor(() => expect(onImport).toHaveBeenCalled())
    expect(
      onImport.mock.calls[0][0].map(
        (p: { pageNumber: number }) => p.pageNumber,
      ),
    ).toEqual([1, 2])
    expect(onImport.mock.calls[0][1]).toBe('replace')
    expect(onClose).toHaveBeenCalledOnce()
  })
  it('does not commit any page when a later render fails', async () => {
    mock.session.renderPage
      .mockResolvedValueOnce({
        ...info,
        width: 150,
        height: 300,
        dataUrl: 'data:image/png;base64,image',
        dpi: 150,
      })
      .mockRejectedValueOnce(new Error('failure'))
    const { onImport, onClose } = setup()
    await screen.findByLabelText('Page range (e.g. 1, 3-5)')
    fireEvent.change(screen.getByLabelText('Page range (e.g. 1, 3-5)'), {
      target: { value: '1-2' },
    })
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Import selected pages' }),
      ).toBeEnabled(),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Import selected pages' }),
    )
    await screen.findByRole('alert')
    expect(onImport).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
  it('keeps the dialog when replacement confirmation is declined', async () => {
    const { onClose, onImport } = setup(vi.fn().mockResolvedValue(false))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Import selected pages' }),
      ).toBeEnabled(),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Import selected pages' }),
    )
    await waitFor(() => expect(onImport).toHaveBeenCalledOnce())
    expect(onClose).not.toHaveBeenCalled()
  })
  it('aborts the active render and destroys the session on close', async () => {
    let renderSignal: AbortSignal | undefined
    mock.session.renderPage.mockImplementation(
      (_page: number, _dpi: number, signal: AbortSignal) => {
        renderSignal = signal
        return new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () =>
            reject(new DOMException('cancel', 'AbortError')),
          ),
        )
      },
    )
    const { unmount, onImport } = setup()
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Import selected pages' }),
      ).toBeEnabled(),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Import selected pages' }),
    )
    await waitFor(() => expect(renderSignal).toBeDefined())
    unmount()
    expect(renderSignal!.aborted).toBe(true)
    expect(mock.session.destroy).toHaveBeenCalledOnce()
    expect(onImport).not.toHaveBeenCalled()
  })
})
