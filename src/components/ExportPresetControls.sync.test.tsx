import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ExportPresetControls from './ExportPresetControls'
import {
  EXPORT_PRESET_STORAGE_KEY,
  LocalExportPresetRepository,
} from '../export/presetRepository'
import type { ImagePresetSettings } from '../export/presets'

const savedSettings: ImagePresetSettings = {
  kind: 'image',
  format: 'png',
  quality: 0.92,
  multiplier: 1,
}
const currentSettings: ImagePresetSettings = {
  kind: 'image',
  format: 'jpeg',
  quality: 0.7,
  multiplier: 0.5,
}

afterEach(cleanup)

async function showSelectedPreset() {
  const data = new Map<string, string>()
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
  }
  const local = new LocalExportPresetRepository({
    storage,
    lockManager: null,
  })
  const external = new LocalExportPresetRepository({
    storage,
    lockManager: null,
  })
  const { preset } = await local.save({
    name: 'Original name',
    settings: savedSettings,
  })
  const onApply = vi.fn()
  const view = render(
    <ExportPresetControls
      locale="en"
      repository={local}
      settings={currentSettings}
      onApply={onApply}
    />,
  )
  fireEvent.click(view.container.querySelector('summary')!)
  await waitFor(() =>
    expect(screen.getByLabelText('Saved presets')).toBeEnabled(),
  )
  fireEvent.change(screen.getByLabelText('Saved presets'), {
    target: { value: preset.id },
  })
  return { external, preset, onApply }
}

function notifyStorageChange(key: string | null = EXPORT_PRESET_STORAGE_KEY) {
  window.dispatchEvent(new StorageEvent('storage', { key }))
}

describe('output preset name synchronization across tabs', () => {
  it('refreshes an untouched name and preserves the external rename when overwriting settings', async () => {
    const { external, preset, onApply } = await showSelectedPreset()
    await external.save({
      ...preset,
      name: 'Renamed elsewhere',
    })
    notifyStorageChange()
    await screen.findByRole('option', { name: 'Renamed elsewhere' })
    expect(screen.getByLabelText('Preset name')).toHaveValue(
      'Renamed elsewhere',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }))
    await screen.findByText('Preset updated.')
    expect((await external.list()).presets).toEqual([
      {
        id: preset.id,
        name: 'Renamed elsewhere',
        settings: currentSettings,
      },
    ])
    expect(onApply).not.toHaveBeenCalled()
  })

  it('preserves an intentional name draft while refreshing the selected preset', async () => {
    const { external, preset } = await showSelectedPreset()
    fireEvent.change(screen.getByLabelText('Preset name'), {
      target: { value: 'My draft name' },
    })
    await external.save({ ...preset, name: 'Renamed elsewhere' })
    notifyStorageChange()
    await screen.findByRole('option', { name: 'Renamed elsewhere' })
    expect(screen.getByLabelText('Preset name')).toHaveValue('My draft name')
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }))
    await screen.findByText('Preset updated.')
    expect((await external.list()).presets[0]).toEqual({
      id: preset.id,
      name: 'My draft name',
      settings: currentSettings,
    })
  })

  it('clears an untouched name when the selected preset is deleted elsewhere', async () => {
    const { external, preset, onApply } = await showSelectedPreset()
    await external.remove(preset.id)
    notifyStorageChange(null)
    await waitFor(() =>
      expect(screen.getByLabelText('Saved presets')).toHaveValue(''),
    )
    expect(screen.getByLabelText('Preset name')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Overwrite' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save new' })).toBeDisabled()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('retains an intentional name draft after external deletion so it can be saved as a new preset', async () => {
    const { external, preset } = await showSelectedPreset()
    fireEvent.change(screen.getByLabelText('Preset name'), {
      target: { value: 'Keep my draft' },
    })
    await external.remove(preset.id)
    notifyStorageChange()
    await waitFor(() =>
      expect(screen.getByLabelText('Saved presets')).toHaveValue(''),
    )
    expect(screen.getByLabelText('Preset name')).toHaveValue('Keep my draft')
    expect(screen.getByRole('button', { name: 'Overwrite' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Save new' }))
    await screen.findByText('Preset saved.')
    const { presets } = await external.list()
    expect(presets).toHaveLength(1)
    expect(presets[0]).toMatchObject({
      name: 'Keep my draft',
      settings: currentSettings,
    })
    expect(presets[0].id).not.toBe(preset.id)
  })
})
