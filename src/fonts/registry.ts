import type {
  FontFamilyDefinition,
  FontLoadRequest,
  FontLoadResult,
  FontRegistration,
} from './types'

export type FontRegistryErrorCode =
  'invalid-font' | 'duplicate-font' | 'font-not-found'

export class FontRegistryError extends Error {
  readonly code: FontRegistryErrorCode

  constructor(code: FontRegistryErrorCode, message: string) {
    super(message)
    this.name = 'FontRegistryError'
    this.code = code
  }
}

const isSlug = (value: string): boolean =>
  /^[a-z0-9][a-z0-9-]{0,79}$/u.test(value)

const hasControlCharacters = (value: string): boolean =>
  Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code <= 0x1f || code === 0x7f
  })

const isSafeFamily = (value: string): boolean =>
  value.trim().length > 0 && value.length <= 120 && !hasControlCharacters(value)

const allowedCategories = new Set([
  'sans-serif',
  'serif',
  'monospace',
  'display',
])
const allowedScripts = new Set([
  'latin',
  'japanese',
  'cyrillic',
  'greek',
  'symbols',
])
const allowedStyles = new Set(['normal', 'italic'])

const hasDiscreteWeights = (
  weights: FontFamilyDefinition['weights'],
): weights is readonly number[] => Array.isArray(weights)

const validateDefinition = (
  definition: FontFamilyDefinition,
): FontFamilyDefinition => {
  if (!isSlug(definition.id)) {
    throw new FontRegistryError(
      'invalid-font',
      `Font id must be a lowercase slug: ${definition.id}`,
    )
  }
  if (
    !isSafeFamily(definition.family) ||
    !isSafeFamily(definition.displayName) ||
    !isSafeFamily(definition.fallbackStack) ||
    (definition.sampleText !== undefined &&
      (definition.sampleText.length === 0 ||
        definition.sampleText.length > 128))
  ) {
    throw new FontRegistryError(
      'invalid-font',
      `${definition.id} contains invalid font names.`,
    )
  }
  if (
    !allowedCategories.has(definition.category) ||
    definition.scripts.length === 0 ||
    definition.scripts.some((script) => !allowedScripts.has(script)) ||
    definition.styles.length === 0 ||
    definition.styles.some((style) => !allowedStyles.has(style))
  ) {
    throw new FontRegistryError(
      'invalid-font',
      `${definition.id} has invalid classification metadata.`,
    )
  }
  const weights = hasDiscreteWeights(definition.weights)
    ? definition.weights
    : [definition.weights.minimum, definition.weights.maximum]
  if (
    weights.length === 0 ||
    weights.some(
      (weight) => !Number.isInteger(weight) || weight < 1 || weight > 1_000,
    )
  ) {
    throw new FontRegistryError(
      'invalid-font',
      `${definition.id} has invalid weight metadata.`,
    )
  }
  return {
    ...definition,
    family: definition.family.trim(),
    displayName: definition.displayName.trim(),
    fallbackStack: definition.fallbackStack.trim(),
  }
}

const defaultWeight = (definition: FontFamilyDefinition): number => {
  if (hasDiscreteWeights(definition.weights)) {
    return definition.weights.includes(400)
      ? 400
      : (definition.weights[0] ?? 400)
  }
  return Math.min(
    definition.weights.maximum,
    Math.max(definition.weights.minimum, 400),
  )
}

const fontShorthand = (
  definition: FontFamilyDefinition,
  request: FontLoadRequest,
): string => {
  const style = request.style ?? 'normal'
  const weight = request.weight ?? defaultWeight(definition)
  if (!definition.styles.includes(style)) {
    throw new FontRegistryError(
      'invalid-font',
      `${definition.id} does not provide style ${style}.`,
    )
  }
  if (!Number.isInteger(weight) || weight < 1 || weight > 1_000) {
    throw new FontRegistryError(
      'invalid-font',
      'Font weight must be 1 to 1000.',
    )
  }
  return `${style} ${weight} 16px ${JSON.stringify(definition.family)}`
}

export class FontRegistry {
  readonly #definitions = new Map<string, FontFamilyDefinition>()
  readonly #loaders = new Map<string, () => Promise<void>>()
  readonly #chunkPromises = new Map<string, Promise<void>>()

  constructor(registrations: readonly FontRegistration[] = []) {
    registrations.forEach((registration) => this.register(registration))
  }

  register(registration: FontRegistration): void {
    const definition = validateDefinition(registration.definition)
    if (this.#definitions.has(definition.id)) {
      throw new FontRegistryError(
        'duplicate-font',
        `Font id is already registered: ${definition.id}`,
      )
    }
    this.#definitions.set(definition.id, definition)
    if (registration.load) this.#loaders.set(definition.id, registration.load)
  }

  unregisterUserFont(id: string): boolean {
    const definition = this.#definitions.get(id)
    if (!definition || definition.source.type !== 'user') return false
    this.#loaders.delete(id)
    this.#chunkPromises.delete(id)
    return this.#definitions.delete(id)
  }

  get(id: string): FontFamilyDefinition | undefined {
    return this.#definitions.get(id)
  }

  list(): FontFamilyDefinition[] {
    return [...this.#definitions.values()]
  }

  search(query: string): FontFamilyDefinition[] {
    const normalized = query.normalize('NFKC').trim().toLocaleLowerCase()
    if (!normalized) return this.list()
    return this.list().filter((definition) =>
      [
        definition.family,
        definition.displayName,
        definition.localizedName ?? '',
        definition.category,
        ...definition.scripts,
      ]
        .join(' ')
        .normalize('NFKC')
        .toLocaleLowerCase()
        .includes(normalized),
    )
  }

  resolveStack(id: string): string {
    const definition = this.#required(id)
    return `${JSON.stringify(definition.family)}, ${definition.fallbackStack}`
  }

  async ensureLoaded(
    id: string,
    requests: readonly FontLoadRequest[] = [{}],
  ): Promise<FontLoadResult> {
    const definition = this.#required(id)
    let chunk = this.#chunkPromises.get(id)
    if (!chunk) {
      chunk = Promise.resolve(this.#loaders.get(id)?.())
      this.#chunkPromises.set(id, chunk)
    }
    const shorthands = requests.map((request) =>
      fontShorthand(definition, request),
    )
    const failedRequests: string[] = []
    try {
      await chunk
    } catch {
      failedRequests.push(...shorthands)
      return { id, available: false, requests: shorthands, failedRequests }
    }

    const fontSet = globalThis.document?.fonts
    if (!fontSet || typeof fontSet.load !== 'function') {
      return { id, available: true, requests: shorthands, failedRequests }
    }
    await Promise.all(
      shorthands.map(async (shorthand, index) => {
        try {
          await fontSet.load(
            shorthand,
            requests[index]?.sample ?? definition.sampleText,
          )
        } catch {
          failedRequests.push(shorthand)
        }
      }),
    )
    return {
      id,
      available: failedRequests.length === 0,
      requests: shorthands,
      failedRequests,
    }
  }

  #required(id: string): FontFamilyDefinition {
    const definition = this.#definitions.get(id)
    if (!definition) {
      throw new FontRegistryError('font-not-found', `Unknown font id: ${id}`)
    }
    return definition
  }
}
