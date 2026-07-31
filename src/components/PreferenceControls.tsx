import { BookOpen, Languages, Moon, Sun } from 'lucide-react'
import type { EditorUiCopy } from '../i18n'
import type { AppLocale, AppTheme } from '../uiPreferences'

interface PreferenceControlsProps {
  locale: AppLocale
  theme: AppTheme
  copy: EditorUiCopy
  onToggleLocale(): void
  onToggleTheme(): void
  onOpenManual(): void
}

export default function PreferenceControls({
  locale,
  theme,
  copy,
  onToggleLocale,
  onToggleTheme,
  onOpenManual,
}: PreferenceControlsProps) {
  const languageLabel =
    locale === 'ja' ? copy.switchToEnglish : copy.switchToJapanese
  const themeLabel = theme === 'dark' ? copy.switchToLight : copy.switchToDark

  return (
    <div className="preference-controls" aria-label={copy.preferences}>
      <button
        className="preference-button language-toggle"
        type="button"
        aria-label={languageLabel}
        aria-pressed={locale === 'en'}
        title={languageLabel}
        onClick={onToggleLocale}
      >
        <Languages aria-hidden="true" />
        <span>{copy.languageButton}</span>
      </button>
      <button
        className="preference-button"
        type="button"
        aria-label={themeLabel}
        aria-pressed={theme === 'light'}
        title={themeLabel}
        onClick={onToggleTheme}
      >
        {theme === 'dark' ? (
          <Sun aria-hidden="true" />
        ) : (
          <Moon aria-hidden="true" />
        )}
      </button>
      <button
        className="preference-button manual-toggle"
        type="button"
        aria-label={copy.manual}
        title={copy.manual}
        aria-haspopup="dialog"
        onClick={onOpenManual}
      >
        <BookOpen aria-hidden="true" />
        <span>{copy.manual}</span>
      </button>
    </div>
  )
}
