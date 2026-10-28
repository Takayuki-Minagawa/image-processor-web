import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppLocale } from '../uiPreferences'
import {
  exportPresetCopy,
  exportPresetErrorMessage,
} from '../i18n.export-presets'
import {
  validateExportPresetSettings,
  type ExportPreset,
  type ExportPresetSettings,
} from '../export/presets'
import {
  EXPORT_PRESET_STORAGE_KEY,
  getExportPresetRepository,
} from '../export/presetRepository'
import './ExportPresetControls.css'

type Repository = ReturnType<typeof getExportPresetRepository>
interface Props {
  locale: AppLocale
  settings: ExportPresetSettings
  onApply: (settings: ExportPresetSettings) => void
  disabled?: boolean
  repository?: Pick<Repository, 'list' | 'save' | 'remove'>
}

export default function ExportPresetControls({
  locale,
  settings,
  onApply,
  disabled = false,
  repository: suppliedRepository,
}: Props) {
  const copy = exportPresetCopy(locale)
  const repository = useMemo(
    () => suppliedRepository ?? getExportPresetRepository(),
    [suppliedRepository],
  )
  const [presets, setPresets] = useState<ExportPreset[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [name, setName] = useState('')
  const [persisted, setPersisted] = useState(true)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<{
    error: boolean
    message: string
  } | null>(null)
  const pendingRef = useRef(false)
  const activeRef = useRef(true)
  const readGenerationRef = useRef(0)
  const selectedIdRef = useRef('')
  const nameEditedRef = useRef(false)

  const refresh = useCallback(async () => {
    if (pendingRef.current) return
    const generation = ++readGenerationRef.current
    try {
      const snapshot = await repository.list()
      if (!activeRef.current || generation !== readGenerationRef.current) return
      setPresets(snapshot.presets)
      setPersisted(snapshot.persisted)
      const current = snapshot.presets.find(
        (preset) =>
          preset.id === selectedIdRef.current &&
          preset.settings.kind === settings.kind,
      )
      selectedIdRef.current = current?.id ?? ''
      setSelectedId(selectedIdRef.current)
      // Follow another tab's rename only while the name field is untouched.
      // An intentional draft belongs to this tab and must not be replaced.
      if (!nameEditedRef.current) setName(current?.name ?? '')
    } catch (error) {
      if (activeRef.current && generation === readGenerationRef.current)
        setFeedback({
          error: true,
          message: exportPresetErrorMessage(error, locale),
        })
    } finally {
      if (activeRef.current && generation === readGenerationRef.current)
        setLoading(false)
    }
  }, [repository, locale, settings.kind])

  useEffect(() => {
    activeRef.current = true
    void refresh()
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === EXPORT_PRESET_STORAGE_KEY)
        void refresh()
    }
    window.addEventListener('storage', onStorage)
    return () => {
      activeRef.current = false
      readGenerationRef.current += 1
      window.removeEventListener('storage', onStorage)
    }
  }, [refresh])

  const available = presets.filter(
    (preset) => preset.settings.kind === settings.kind,
  )
  const selected = available.find((preset) => preset.id === selectedId)
  let validSettings: ExportPresetSettings | undefined
  try {
    validSettings = validateExportPresetSettings(settings)
  } catch {
    /* Draft form values may be temporarily invalid. */
  }
  const changed =
    selected &&
    JSON.stringify(selected.settings) !== JSON.stringify(validSettings)
  const blocked = disabled || pending || loading

  const mutate = async (operation: 'create' | 'update' | 'remove') => {
    if (blocked || pendingRef.current || (operation !== 'create' && !selected))
      return
    if (operation !== 'remove' && !validSettings) return
    if (
      operation === 'remove' &&
      !window.confirm(copy.confirmRemove(selected!.name))
    )
      return
    pendingRef.current = true
    readGenerationRef.current += 1
    setPending(true)
    setFeedback(null)
    try {
      if (operation === 'remove') {
        const snapshot = await repository.remove(selected!.id)
        if (!activeRef.current) return
        setPresets(snapshot.presets)
        setPersisted(snapshot.persisted)
        selectedIdRef.current = ''
        nameEditedRef.current = false
        setSelectedId('')
        setName('')
        setFeedback({
          error: false,
          message: snapshot.persisted ? copy.removed : copy.sessionRemoved,
        })
      } else {
        const result = await repository.save({
          ...(operation === 'update' ? { id: selected!.id } : {}),
          name,
          settings: validSettings!,
        })
        if (!activeRef.current) return
        setPresets(result.presets)
        setPersisted(result.persisted)
        selectedIdRef.current = result.preset.id
        nameEditedRef.current = false
        setSelectedId(result.preset.id)
        setName(result.preset.name)
        setFeedback({
          error: false,
          message: !result.persisted
            ? copy.sessionSaved
            : operation === 'create'
              ? copy.saved
              : copy.updated,
        })
      }
    } catch (error) {
      if (activeRef.current)
        setFeedback({
          error: true,
          message: exportPresetErrorMessage(error, locale),
        })
    } finally {
      pendingRef.current = false
      if (activeRef.current) {
        setPending(false)
        // A storage event may have arrived while this mutation was pending,
        // or a rejected stale update may have read newer data. Reconcile both.
        void refresh()
      }
    }
  }

  return (
    <details className="export-preset-section">
      <summary>{copy.heading}</summary>
      <fieldset className="export-preset-controls" disabled={blocked}>
        <legend>{copy.heading}</legend>
        <label>
          {copy.select}
          <select
            value={selected?.id ?? ''}
            onChange={(event) => {
              const preset = available.find(
                ({ id }) => id === event.target.value,
              )
              selectedIdRef.current = preset?.id ?? ''
              nameEditedRef.current = false
              setSelectedId(selectedIdRef.current)
              setName(preset?.name ?? '')
              setFeedback(null)
            }}
          >
            <option value="">{copy.placeholder}</option>
            {available.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
        <div className="export-preset-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={!selected || blocked}
            onClick={() => {
              if (!selected || blocked) return
              onApply(validateExportPresetSettings(selected.settings))
              setFeedback({ error: false, message: copy.applied })
            }}
          >
            {copy.apply}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={!selected || blocked}
            onClick={() => void mutate('remove')}
          >
            {copy.remove}
          </button>
        </div>
        <label>
          {copy.name}
          <input
            value={name}
            maxLength={80}
            onChange={(event) => {
              nameEditedRef.current = true
              setName(event.target.value)
            }}
            onKeyDown={(event) => {
              // This control can live inside an export form. Naming a preset must not
              // implicitly submit that form and start downloading the document.
              if (event.key === 'Enter') {
                event.preventDefault()
                event.stopPropagation()
              }
            }}
          />
        </label>
        <div className="export-preset-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={blocked || !name.trim() || !validSettings}
            onClick={() => void mutate('create')}
          >
            {copy.save}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={blocked || !selected || !name.trim() || !validSettings}
            onClick={() => void mutate('update')}
          >
            {copy.update}
          </button>
        </div>
        <p className="export-preset-note">{copy.note}</p>
        {!persisted ? (
          <p className="export-preset-warning" role="status">
            {copy.session}
          </p>
        ) : null}
        {changed ? <p className="export-preset-note">{copy.modified}</p> : null}
        {!validSettings ? (
          <p className="export-preset-warning">{copy.invalidCurrent}</p>
        ) : null}
        {loading || pending ? (
          <p role="status">{loading ? copy.loading : copy.working}</p>
        ) : null}
        {feedback ? (
          <p role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>
        ) : null}
      </fieldset>
    </details>
  )
}
