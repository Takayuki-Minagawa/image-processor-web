import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ExportImageForm, { type ExportImageSettings } from './ExportImageForm'
import { ENGLISH_EDITOR_UI_COPY as ui } from '../i18n.en'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const settings: ExportImageSettings = {
  format: 'png',
  quality: 0.92,
  multiplier: 1,
  svgScope: 'document',
}

function show(
  overrides: Partial<React.ComponentProps<typeof ExportImageForm>> = {},
) {
  return render(
    <ExportImageForm
      settings={settings}
      onChange={vi.fn()}
      documentSize={{ width: 320, height: 240 }}
      projectName="Example"
      ui={ui}
      busy={false}
      onExport={vi.fn(async () => undefined)}
      onClose={vi.fn()}
      {...overrides}
    />,
  )
}

describe('image export form', () => {
  it('keeps download available and explains unsupported clipboard access', () => {
    vi.stubGlobal('ClipboardItem', undefined)
    show()
    expect(screen.getByRole('button', { name: ui.copyPng })).toBeDisabled()
    expect(screen.getByText(ui.clipboardUnavailable)).toBeVisible()
    expect(screen.getByRole('button', { name: ui.download })).toBeEnabled()
  })

  it('shows failures inside the dialog and permits a retry', async () => {
    const onExport = vi
      .fn()
      .mockRejectedValueOnce(new Error(ui.exportUnsupported))
      .mockResolvedValueOnce(undefined)
    show({ onExport })
    fireEvent.click(screen.getByRole('button', { name: ui.download }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      ui.exportUnsupported,
    )
    fireEvent.click(screen.getByRole('button', { name: ui.download }))
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(2))
  })

  it('blocks repeated submissions while encoding is pending', async () => {
    let finish!: () => void
    const onExport = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    show({ onExport })
    const download = screen.getByRole('button', { name: ui.download })
    fireEvent.click(download)
    fireEvent.click(download)
    expect(onExport).toHaveBeenCalledOnce()
    expect(download).toBeDisabled()
    finish()
    await waitFor(() => expect(download).toBeEnabled())
  })

  it('does not submit retained oversized settings after the canvas grows', () => {
    const onExport = vi.fn()
    show({
      settings: { ...settings, multiplier: 2 },
      documentSize: { width: 8192, height: 8192 },
      onExport,
    })
    expect(screen.getByRole('alert')).toHaveTextContent(ui.exportTooLarge)
    expect(screen.getByRole('button', { name: ui.download })).toBeDisabled()
    expect(onExport).not.toHaveBeenCalled()
  })
})
