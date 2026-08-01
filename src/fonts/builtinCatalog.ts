import type { FontRegistration } from './types'

const OFL = (sourceUrl: string) => ({
  id: 'OFL-1.1',
  name: 'SIL Open Font License 1.1',
  sourceUrl,
})

export const BUILTIN_FONT_REGISTRATIONS: readonly FontRegistration[] = [
  {
    definition: {
      id: 'inter',
      family: 'Inter',
      displayName: 'Inter',
      category: 'sans-serif',
      scripts: ['latin'],
      weights: { minimum: 100, maximum: 900 },
      styles: ['normal'],
      fallbackStack: 'system-ui, sans-serif',
      variable: true,
      source: {
        type: 'bundled',
        license: OFL('https://fontsource.org/fonts/inter'),
      },
    },
  },
  {
    definition: {
      id: 'space-grotesk',
      family: 'Space Grotesk',
      displayName: 'Space Grotesk',
      category: 'sans-serif',
      scripts: ['latin'],
      weights: { minimum: 300, maximum: 700 },
      styles: ['normal'],
      fallbackStack: 'system-ui, sans-serif',
      variable: true,
      source: {
        type: 'bundled',
        license: OFL('https://fontsource.org/fonts/space-grotesk'),
      },
    },
  },
  {
    definition: {
      id: 'bitter',
      family: 'Bitter',
      displayName: 'Bitter',
      category: 'serif',
      scripts: ['latin'],
      weights: { minimum: 100, maximum: 900 },
      styles: ['normal'],
      fallbackStack: 'Georgia, serif',
      variable: true,
      source: {
        type: 'bundled',
        license: OFL('https://fontsource.org/fonts/bitter'),
      },
    },
  },
  {
    definition: {
      id: 'manrope',
      family: 'Manrope',
      displayName: 'Manrope',
      category: 'sans-serif',
      scripts: ['latin'],
      weights: { minimum: 200, maximum: 800 },
      styles: ['normal'],
      fallbackStack: 'system-ui, sans-serif',
      variable: true,
      source: {
        type: 'bundled',
        license: OFL('https://fontsource.org/fonts/manrope'),
      },
    },
  },
  {
    definition: {
      id: 'noto-sans-jp',
      family: 'Noto Sans JP Variable',
      displayName: 'Noto Sans JP',
      localizedName: 'Noto Sans JP（日本語）',
      category: 'sans-serif',
      scripts: ['latin', 'japanese'],
      weights: { minimum: 100, maximum: 900 },
      styles: ['normal'],
      fallbackStack: '"Hiragino Sans", "Yu Gothic", sans-serif',
      sampleText: '日本語Aa',
      variable: true,
      source: {
        type: 'bundled',
        license: OFL('https://fontsource.org/fonts/noto-sans-jp'),
      },
    },
    load: () => import('./loaders/notoSansJp').then(() => undefined),
  },
  {
    definition: {
      id: 'noto-serif-jp',
      family: 'Noto Serif JP Variable',
      displayName: 'Noto Serif JP',
      localizedName: 'Noto Serif JP（日本語）',
      category: 'serif',
      scripts: ['latin', 'japanese'],
      weights: { minimum: 200, maximum: 900 },
      styles: ['normal'],
      fallbackStack: '"Hiragino Mincho ProN", "Yu Mincho", serif',
      sampleText: '日本語Aa',
      variable: true,
      source: {
        type: 'bundled',
        license: OFL('https://fontsource.org/fonts/noto-serif-jp'),
      },
    },
    load: () => import('./loaders/notoSerifJp').then(() => undefined),
  },
  {
    definition: {
      id: 'system-sans',
      family: 'system-ui',
      displayName: 'System Sans',
      localizedName: 'システムゴシック',
      category: 'sans-serif',
      scripts: ['latin', 'japanese'],
      weights: { minimum: 100, maximum: 900 },
      styles: ['normal', 'italic'],
      fallbackStack: 'sans-serif',
      variable: false,
      source: { type: 'system' },
    },
  },
  {
    definition: {
      id: 'system-serif',
      family: 'serif',
      displayName: 'System Serif',
      localizedName: 'システム明朝',
      category: 'serif',
      scripts: ['latin', 'japanese'],
      weights: { minimum: 100, maximum: 900 },
      styles: ['normal', 'italic'],
      fallbackStack: 'serif',
      variable: false,
      source: { type: 'system' },
    },
  },
] as const
