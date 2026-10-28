import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SvgImportDialog from './SvgImportDialog'
import { SvgSafetyError } from '../lib/svgSafety'

const mock = vi.hoisted(() => ({ prepare: vi.fn() }))
vi.mock('../import/svgGeometry', () => ({
  prepareSvgNativeImport: mock.prepare,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mock.prepare.mockReturnValue({
    source: '<svg/>',
    width: 96,
    height: 48,
    viewportWidth: 96,
    viewportHeight: 48,
    physicalSize: { unit: 'mm', widthMm: 25.4, heightMm: 12.7, sourceDpi: 96 },
    inferred: false,
    removedElements: 0,
    removedAttributes: 0,
  })
})
afterEach(cleanup)

function setup(onImport = vi.fn().mockResolvedValue(true), size = 6) {
  const file = new File(['<svg/>'], 'original.svg', { type: 'image/svg+xml' })
  Object.defineProperty(file, 'size', { value: size })
  Object.defineProperty(file, 'text', {
    value: vi.fn().mockResolvedValue('<svg/>'),
  })
  const onClose = vi.fn()
  return {
    ...render(
      <SvgImportDialog
        file={file}
        locale="en"
        onImport={onImport}
        onClose={onClose}
      />,
    ),
    file,
    onImport,
    onClose,
  }
}

describe('SVG original-size import dialog', () => {
  it('shows physical and pixel dimensions and sends an explicit append destination', async () => {
    const { onImport, onClose } = setup()
    await screen.findByText('Page dimensions: 96 × 48 px')
    expect(
      screen.getByText('Original physical size: 25.4 × 12.7 mm'),
    ).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Destination'), {
      target: { value: 'append' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Import SVG' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(onImport).toHaveBeenCalledWith(
      mock.prepare.mock.results[0].value,
      'append',
      expect.any(AbortSignal),
    )
  })
  it('requires explicit confirmation for inferred dimensions', async () => {
    mock.prepare.mockReturnValue({
      ...mock.prepare(),
      inferred: true,
      physicalSize: undefined,
    })
    const { onImport } = setup()
    const checkbox = await screen.findByLabelText(
      'I confirm importing at the inferred size',
    )
    const submit = screen.getByRole('button', { name: 'Import SVG' })
    expect(submit).toBeDisabled()
    fireEvent.submit(submit.closest('form')!)
    expect(onImport).not.toHaveBeenCalled()
    fireEvent.click(checkbox)
    expect(submit).toBeEnabled()
    fireEvent.click(submit)
    await waitFor(() => expect(onImport).toHaveBeenCalledOnce())
  })
  it('rejects oversized files before reading and keeps the document untouched', async () => {
    const { file, onImport } = setup(undefined, 5 * 1024 * 1024 + 1)
    await screen.findByRole('alert')
    expect(file.text).not.toHaveBeenCalled()
    expect(mock.prepare).not.toHaveBeenCalled()
    expect(onImport).not.toHaveBeenCalled()
  })
  it('reports unsafe input without enabling import', async () => {
    mock.prepare.mockImplementation(() => {
      throw new SvgSafetyError('invalid-svg', 'invalid')
    })
    const { onImport } = setup()
    await screen.findByText(
      'Invalid SVG or dimensions. Check width, height and viewBox.',
    )
    expect(screen.getByRole('button', { name: 'Import SVG' })).toBeDisabled()
    expect(onImport).not.toHaveBeenCalled()
  })
  it('keeps the dialog when replacement is declined', async () => {
    const { onImport, onClose } = setup(vi.fn().mockResolvedValue(false))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Import SVG' })).toBeEnabled(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Import SVG' }))
    await waitFor(() => expect(onImport).toHaveBeenCalledOnce())
    expect(onClose).not.toHaveBeenCalled()
  })
  it('aborts preparation on cancellation and unmount', async () => {
    let signal: AbortSignal | undefined
    const onImport = vi.fn((_geometry, _target, received: AbortSignal) => {
      signal = received
      return new Promise<boolean>((_resolve, reject) =>
        received.addEventListener('abort', () =>
          reject(new DOMException('cancel', 'AbortError')),
        ),
      )
    })
    const { unmount, onClose } = setup(onImport)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Import SVG' })).toBeEnabled(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Import SVG' }))
    await waitFor(() => expect(signal).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(signal!.aborted).toBe(true)
    expect(onClose).toHaveBeenCalledOnce()
    unmount()
  })
})
