import { loadUserFontFace, type UserFontMetadata } from './userFontMetadata'
import type {
  FontFamilyDefinition,
  FontLoadRequest,
  FontLoadResult,
} from './types'

const GENERIC_FONT_FAMILIES = new Set([
  'cursive',
  'fantasy',
  'monospace',
  'sans-serif',
  'serif',
  'system-ui',
  'ui-monospace',
  'ui-rounded',
  'ui-sans-serif',
  'ui-serif',
])

const primaryFontFamily = (stack: string): string =>
  (stack.split(',')[0] ?? '')
    .trim()
    .replace(/^(?:"([^"]+)"|'([^']+)')$/u, '$1$2')

/** Collects renderer font references without interpreting unrelated strings. */
export function collectProjectFontFamilies(value: unknown): string[] {
  const families = new Set<string>()
  const visited = new Set<object>()
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > 100 || typeof candidate !== 'object' || candidate === null) {
      return
    }
    if (visited.has(candidate)) return
    visited.add(candidate)
    if (Array.isArray(candidate)) {
      candidate.forEach((entry) => visit(entry, depth + 1))
      return
    }
    Object.entries(candidate).forEach(([key, entry]) => {
      if (key === 'fontFamily' && typeof entry === 'string') {
        const family = primaryFontFamily(entry)
        if (family && !GENERIC_FONT_FAMILIES.has(family.toLowerCase())) {
          families.add(family)
        }
      } else {
        visit(entry, depth + 1)
      }
    })
  }
  visit(value, 0)
  return [...families].sort((left, right) => left.localeCompare(right))
}

export function findMissingProjectFontFamilies(
  value: unknown,
  knownFamilies: Iterable<string>,
  isLocallyAvailable: (family: string) => boolean = () => false,
): string[] {
  const known = new Set(
    [...knownFamilies].map((family) => family.trim().toLowerCase()),
  )
  return collectProjectFontFamilies(value).filter(
    (family) => !known.has(family.toLowerCase()) && !isLocallyAvailable(family),
  )
}

const LOCAL_FONT_PROBE_TEXT = 'mmmmmmmmmmWWWW漢字0123456789'
const LOCAL_FONT_PROBE_FALLBACKS = ['monospace', 'serif', 'sans-serif'] as const

/**
 * `FontFaceSet.check()` can report true for a nonexistent family rendered by
 * fallback. Confirm it with width comparisons against several generic faces.
 */
export function isFontFamilyLocallyAvailable(
  family: string,
  dependencies: {
    check?: (font: string, text: string) => boolean
    measureText?: (font: string, text: string) => number
  } = {},
): boolean {
  const normalizedFamily = family.trim()
  if (
    !normalizedFamily ||
    Array.from(normalizedFamily).some((character) => {
      const code = character.codePointAt(0) ?? 0
      return code <= 0x1f || code === 0x7f
    })
  ) {
    return false
  }
  const quotedFamily = JSON.stringify(normalizedFamily)
  const check =
    dependencies.check ??
    ((font: string, text: string) => {
      try {
        return globalThis.document?.fonts?.check(font, text) ?? false
      } catch {
        return false
      }
    })
  if (!check(`72px ${quotedFamily}`, LOCAL_FONT_PROBE_TEXT)) return false

  let measureText = dependencies.measureText
  if (!measureText) {
    try {
      const context = globalThis.document
        ?.createElement('canvas')
        .getContext('2d')
      if (!context) return false
      measureText = (font, text) => {
        context.font = font
        return context.measureText(text).width
      }
    } catch {
      return false
    }
  }

  return LOCAL_FONT_PROBE_FALLBACKS.some((fallback) => {
    const baseline = measureText(`72px ${fallback}`, LOCAL_FONT_PROBE_TEXT)
    const candidate = measureText(
      `72px ${quotedFamily}, ${fallback}`,
      LOCAL_FONT_PROBE_TEXT,
    )
    return (
      Number.isFinite(baseline) &&
      Number.isFinite(candidate) &&
      Math.abs(candidate - baseline) > 0.01
    )
  })
}

export interface ProjectBuiltinFontLoader {
  list(): FontFamilyDefinition[]
  ensureLoaded(
    id: string,
    requests?: readonly FontLoadRequest[],
  ): Promise<FontLoadResult>
}

export interface ProjectUserFontRecord {
  metadata: UserFontMetadata
  bytes: ArrayBuffer
}

export interface ProjectUserFontLoader {
  list(): Promise<UserFontMetadata[]>
  get(id: string): Promise<ProjectUserFontRecord | null>
}

export interface ProjectFontPreparationResult {
  referencedFamilies: string[]
  loadedFamilies: string[]
  missingFamilies: string[]
}

/**
 * Loads every referenced bundled or persisted user font before deciding
 * whether a project needs a fallback warning. Metadata alone never counts as
 * availability: a failed CSS chunk, FontFace load, or OPFS read stays missing.
 */
export async function prepareProjectFonts(
  value: unknown,
  dependencies: {
    builtinFonts: ProjectBuiltinFontLoader
    userFonts: ProjectUserFontLoader
    loadUserFont?: (
      metadata: UserFontMetadata,
      bytes: ArrayBuffer,
    ) => Promise<unknown>
    isLocallyAvailable?: (family: string) => boolean
  },
): Promise<ProjectFontPreparationResult> {
  const referencedFamilies = collectProjectFontFamilies(value)
  const referenced = new Set(
    referencedFamilies.map((family) => family.toLocaleLowerCase()),
  )
  const loadedFamilies = new Set<string>()
  const managedFamilies = new Set<string>()
  const rememberLoaded = (family: string): void => {
    loadedFamilies.add(family)
  }

  const builtinFontDefinitions = dependencies.builtinFonts.list()
  builtinFontDefinitions.forEach(({ family }) =>
    managedFamilies.add(family.toLocaleLowerCase()),
  )
  await Promise.all(
    builtinFontDefinitions
      .filter(({ family }) => referenced.has(family.toLocaleLowerCase()))
      .map(async ({ id, family }) => {
        try {
          const result = await dependencies.builtinFonts.ensureLoaded(id)
          if (result.available) rememberLoaded(family)
        } catch {
          // A loader failure is represented by the final missing-font warning.
        }
      }),
  )

  let userFontStorageAvailable = true
  const userFontMetadata = await dependencies.userFonts.list().catch(() => {
    userFontStorageAvailable = false
    return []
  })
  userFontMetadata.forEach(({ family }) =>
    managedFamilies.add(family.toLocaleLowerCase()),
  )
  const loadUserFont = dependencies.loadUserFont ?? loadUserFontFace
  await Promise.all(
    userFontMetadata
      .filter(({ family }) => referenced.has(family.toLocaleLowerCase()))
      .map(async ({ id }) => {
        try {
          const stored = await dependencies.userFonts.get(id)
          if (!stored) return
          await loadUserFont(stored.metadata, stored.bytes)
          rememberLoaded(stored.metadata.family)
        } catch {
          // Missing/corrupt OPFS bytes must not be declared available.
        }
      }),
  )

  const loaded = [...loadedFamilies].sort((left, right) =>
    left.localeCompare(right),
  )
  return {
    referencedFamilies,
    loadedFamilies: loaded,
    missingFamilies: findMissingProjectFontFamilies(
      value,
      loaded,
      (family) =>
        userFontStorageAvailable &&
        !managedFamilies.has(family.toLocaleLowerCase()) &&
        (dependencies.isLocallyAvailable?.(family) ?? false),
    ),
  }
}
