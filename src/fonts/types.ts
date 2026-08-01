export type FontCategory = 'sans-serif' | 'serif' | 'monospace' | 'display'
export type FontScript = 'latin' | 'japanese' | 'cyrillic' | 'greek' | 'symbols'
export type FontStyle = 'normal' | 'italic'

export interface FontLicenseMetadata {
  id: string
  name: string
  sourceUrl?: string
}

export type FontSourceMetadata =
  | {
      type: 'bundled'
      license: FontLicenseMetadata
    }
  | {
      type: 'system'
    }
  | {
      type: 'user'
      metadataId: string
      /** User font bytes live in OPFS and are never embedded in .pwx.json. */
      projectEmbedding: 'reference-only'
    }

export interface FontFamilyDefinition {
  id: string
  family: string
  displayName: string
  localizedName?: string
  category: FontCategory
  scripts: readonly FontScript[]
  weights: readonly number[] | { minimum: number; maximum: number }
  styles: readonly FontStyle[]
  fallbackStack: string
  /** Text used to trigger the relevant unicode-range chunk on first load. */
  sampleText?: string
  variable: boolean
  source: FontSourceMetadata
}

export interface FontRegistration {
  definition: FontFamilyDefinition
  /** Loads a local stylesheet/font chunk. It must not fetch third-party URLs. */
  load?: () => Promise<void>
}

export interface FontLoadRequest {
  weight?: number
  style?: FontStyle
  sample?: string
}

export interface FontLoadResult {
  id: string
  available: boolean
  requests: string[]
  failedRequests: string[]
}

export interface ProjectFontReference {
  family: string
  fallback: string
  sourceId?: string
}
