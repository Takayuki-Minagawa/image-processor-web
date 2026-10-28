import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ExportPresetControls from './ExportPresetControls'
import {
  LocalExportPresetRepository,
  EXPORT_PRESET_STORAGE_KEY,
} from '../export/presetRepository'
import { ExportPresetError, type ExportPresetSettings } from '../export/presets'

const imageSettings: ExportPresetSettings = {
  kind: 'image',
  format: 'png',
  quality: 0.92,
  multiplier: 1,
}
const otherSettings: ExportPresetSettings = {
  kind: 'image',
  format: 'jpeg',
  quality: 0.7,
  multiplier: 2,
}
const repository = () =>
  new LocalExportPresetRepository({ storage: null, lockManager: null })
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function show(repo = repository(), settings = imageSettings) {
  const onApply = vi.fn()
  const view = render(
    <ExportPresetControls
      locale="en"
      repository={repo}
      settings={settings}
      onApply={onApply}
    />,
  )
  fireEvent.click(view.container.querySelector('summary')!)
  await waitFor(() =>
    expect(screen.getByLabelText('Preset name')).toBeEnabled(),
  )
  return { ...view, repo, onApply }
}

describe('named output preset controls', () => {
  it('applies only on explicit request and filters out the other output kind', async () => {
    const repo = repository()
    const saved = await repo.save({ name: 'Web JPEG', settings: otherSettings })
    await repo.save({
      name: 'Print',
      settings: {
        kind: 'pdf',
        dpi: 300,
        bleedMm: 0,
        cropMarks: false,
        pdfCompression: 'lossless',
        jpegQuality: 0.94,
      },
    })
    const { onApply } = await show(repo)
    expect(
      screen.queryByRole('option', { name: 'Print' }),
    ).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Saved presets'), {
      target: { value: saved.preset.id },
    })
    expect(onApply).not.toHaveBeenCalled()
    expect(
      screen.getByText('Current settings differ from the selected preset.'),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).toHaveBeenCalledWith(otherSettings)
  })

  it('creates, renames and updates settings; confirms deletion and keeps session changes across remount', async () => {
    const { repo, rerender, unmount, onApply } = await show()
    fireEvent.change(screen.getByLabelText('Preset name'), {
      target: { value: 'Draft' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save new' }))
    await screen.findByRole('option', { name: 'Draft' })
    expect(
      await screen.findByText('Preset saved for this session only.'),
    ).toBeVisible()
    rerender(
      <ExportPresetControls
        locale="en"
        repository={repo}
        settings={otherSettings}
        onApply={onApply}
      />,
    )
    fireEvent.change(screen.getByLabelText('Preset name'), {
      target: { value: 'Final' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }))
    await screen.findByRole('option', { name: 'Final' })
    const stored = await repo.list()
    expect(stored.presets).toHaveLength(1)
    expect(stored.presets[0].settings).toEqual(otherSettings)
    unmount()
    await show(repo)
    fireEvent.change(screen.getByLabelText('Saved presets'), {
      target: { value: stored.presets[0].id },
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect((await repo.list()).presets).toHaveLength(1)
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('option', { name: 'Final' }),
      ).not.toBeInTheDocument(),
    )
    expect((await repo.list()).presets).toEqual([])
  })

  it('blocks saving invalid drafts while still allowing a valid preset to repair them', async () => {
    const repo = repository()
    const saved = await repo.save({ name: 'Valid', settings: imageSettings })
    const { onApply } = await show(repo, {
      ...imageSettings,
      quality: Number.NaN,
    })
    fireEvent.change(screen.getByLabelText('Saved presets'), {
      target: { value: saved.preset.id },
    })
    expect(screen.getByRole('button', { name: 'Save new' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Overwrite' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).toHaveBeenCalledWith(imageSettings)
  })

  it('never submits the enclosing export form when Enter is pressed in the name field', async () => {
    const submit = vi.fn((event) => event.preventDefault())
    const view = render(
      <form onSubmit={submit}>
        <ExportPresetControls
          locale="en"
          repository={repository()}
          settings={imageSettings}
          onApply={vi.fn()}
        />
      </form>,
    )
    fireEvent.click(view.container.querySelector('summary')!)
    await waitFor(() =>
      expect(screen.getByLabelText('Preset name')).toBeEnabled(),
    )
    const input = screen.getByLabelText('Preset name')
    fireEvent.change(input, { target: { value: 'No download' } })
    expect(fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })).toBe(
      false,
    )
    expect(submit).not.toHaveBeenCalled()
  })

  it('shows a failed update without discarding the selected preset', async () => {
    const repo = repository()
    const saved = await repo.save({ name: 'Existing', settings: imageSettings })
    await show(repo)
    fireEvent.change(screen.getByLabelText('Saved presets'), {
      target: { value: saved.preset.id },
    })
    vi.spyOn(repo, 'save').mockRejectedValue(
      new ExportPresetError('duplicate-name', 'duplicate'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'already has this name',
    )
    expect(screen.getByRole('option', { name: 'Existing' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Overwrite' })).toBeEnabled()
  })

  it('reloads external changes without applying them to the active document', async () => {
    const data = new Map<string, string>()
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value)
      },
    }
    const first = new LocalExportPresetRepository({
      storage,
      lockManager: null,
    })
    const second = new LocalExportPresetRepository({
      storage,
      lockManager: null,
    })
    const { onApply } = await show(first)
    const created = await second.save({
      name: 'Another tab',
      settings: otherSettings,
    })
    window.dispatchEvent(
      new StorageEvent('storage', { key: EXPORT_PRESET_STORAGE_KEY }),
    )
    await screen.findByRole('option', { name: 'Another tab' })
    fireEvent.change(screen.getByLabelText('Saved presets'), {
      target: { value: created.preset.id },
    })
    await second.remove(created.preset.id)
    window.dispatchEvent(new StorageEvent('storage', { key: null }))
    await waitFor(() =>
      expect(
        screen.queryByRole('option', { name: 'Another tab' }),
      ).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    expect(onApply).not.toHaveBeenCalled()
  })

  it.each(['addition', 'deletion'] as const)(
    'refreshes an external %s received while a save response is pending',
    async (change) => {
      const data = new Map<string, string>()
      const storage = {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => {
          data.set(key, value)
        },
      }
      const first = new LocalExportPresetRepository({
        storage,
        lockManager: null,
      })
      const second = new LocalExportPresetRepository({
        storage,
        lockManager: null,
      })
      const saved = await first.save({
        name: 'Existing',
        settings: imageSettings,
      })
      const { onApply } = await show(first)
      fireEvent.change(screen.getByLabelText('Saved presets'), {
        target: { value: saved.preset.id },
      })

      let finishResponse!: () => void
      const responseGate = new Promise<void>((resolve) => {
        finishResponse = resolve
      })
      let didCommit!: () => void
      const committed = new Promise<void>((resolve) => {
        didCommit = resolve
      })
      const save = first.save.bind(first)
      vi.spyOn(first, 'save').mockImplementation(async (input) => {
        const snapshot = await save(input)
        didCommit()
        await responseGate
        return snapshot
      })
      fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }))
      await committed
      expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()

      if (change === 'addition') {
        await second.save({ name: 'Another tab', settings: otherSettings })
      } else {
        await second.remove(saved.preset.id)
      }
      await act(async () => {
        window.dispatchEvent(
          new StorageEvent('storage', { key: EXPORT_PRESET_STORAGE_KEY }),
        )
        finishResponse()
      })

      if (change === 'addition') {
        expect(
          await screen.findByRole('option', { name: 'Another tab' }),
        ).toBeInTheDocument()
        expect(screen.getByLabelText('Saved presets')).toHaveValue(
          saved.preset.id,
        )
      } else {
        await waitFor(() =>
          expect(
            screen.queryByRole('option', { name: 'Existing' }),
          ).not.toBeInTheDocument(),
        )
        expect(screen.getByLabelText('Saved presets')).toHaveValue('')
        expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
      }
      expect(onApply).not.toHaveBeenCalled()
    },
  )
})
