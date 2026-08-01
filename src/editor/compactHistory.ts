import { History, type HistoryOptions } from './history.ts'

type AssetReference = {
  readonly __pixelweaveAssetRef: string
}

type StoredValue =
  | null
  | boolean
  | number
  | string
  | StoredValue[]
  | AssetReference
  | { [key: string]: StoredValue }

export interface CompactHistoryStats {
  entries: number
  uniqueAssets: number
  assetCharacters: number
  structuralCharacters: number
  estimatedBytes: number
}

export interface CompactHistoryOptions<T> extends HistoryOptions<T> {
  /** Strings below this size are cheaper to keep inline. */
  assetThreshold?: number
}

const ASSET_PREFIX = 'data:'
const DEFAULT_ASSET_THRESHOLD = 1_024

const isAssetString = (value: string, threshold: number): boolean =>
  value.length >= threshold &&
  value.startsWith(ASSET_PREFIX) &&
  value.includes(';base64,')

// Fast deterministic hash. The length and a collision check are also used, so
// this is an interning key rather than a security boundary.
const hashString = (value: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

const isReference = (value: StoredValue): value is AssetReference =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  typeof (value as Record<string, unknown>).__pixelweaveAssetRef === 'string'

/**
 * Snapshot history that content-addresses embedded Data URLs.
 *
 * Fabric snapshots repeat the same image source in every undo entry. A 4K,
 * multi-layer document therefore retained gigabytes even when an operation
 * only moved one object. This adapter preserves the History API while storing
 * each immutable image/font payload once and hydrating it on read.
 */
export class CompactHistory<T> {
  readonly limit: number

  readonly #history: History<StoredValue>
  readonly #assets = new Map<string, string>()
  readonly #assetThreshold: number
  #structuralCharacters = 0

  constructor(options: CompactHistoryOptions<T> = {}) {
    const assetThreshold = options.assetThreshold ?? DEFAULT_ASSET_THRESHOLD
    if (!Number.isSafeInteger(assetThreshold) || assetThreshold < 64) {
      throw new RangeError('Asset threshold must be an integer of at least 64.')
    }
    this.#assetThreshold = assetThreshold
    this.#history = new History<StoredValue>({ limit: options.limit })
    this.limit = this.#history.limit
  }

  get size(): number {
    return this.#history.size
  }

  get index(): number {
    return this.#history.index
  }

  get canUndo(): boolean {
    return this.#history.canUndo
  }

  get canRedo(): boolean {
    return this.#history.canRedo
  }

  current(): T | undefined {
    return this.#hydrate(this.#history.current())
  }

  entries(): readonly T[] {
    return this.#history.entries().map((entry) => this.#hydrate(entry) as T)
  }

  push(snapshot: T): boolean {
    let stored: StoredValue
    try {
      stored = this.#dehydrate(snapshot)
    } catch (error) {
      this.#pruneAssets()
      throw error
    }
    const pushed = this.#history.push(stored)
    this.#pruneAssets()
    if (pushed) this.#refreshStructuralSize()
    return pushed
  }

  replaceCurrent(snapshot: T): boolean {
    let stored: StoredValue
    try {
      stored = this.#dehydrate(snapshot)
    } catch (error) {
      this.#pruneAssets()
      throw error
    }
    const replaced = this.#history.replaceCurrent(stored)
    this.#pruneAssets()
    if (replaced) this.#refreshStructuralSize()
    return replaced
  }

  undo(): T | undefined {
    return this.#hydrate(this.#history.undo())
  }

  redo(): T | undefined {
    return this.#hydrate(this.#history.redo())
  }

  clear(): void {
    this.#history.clear()
    this.#assets.clear()
    this.#structuralCharacters = 0
  }

  reset(): void
  reset(initial: T): void
  reset(initial?: T): void {
    this.clear()
    if (arguments.length > 0) this.push(initial as T)
  }

  stats(): CompactHistoryStats {
    const assetCharacters = [...this.#assets.values()].reduce(
      (total, value) => total + value.length,
      0,
    )
    return {
      entries: this.size,
      uniqueAssets: this.#assets.size,
      assetCharacters,
      structuralCharacters: this.#structuralCharacters,
      // JavaScript strings are conservatively estimated as UTF-16.
      estimatedBytes: (assetCharacters + this.#structuralCharacters) * 2,
    }
  }

  #dehydrate(value: unknown, seen = new WeakSet<object>()): StoredValue {
    if (
      value === null ||
      typeof value === 'boolean' ||
      typeof value === 'number'
    ) {
      return value
    }
    if (typeof value === 'string') {
      return isAssetString(value, this.#assetThreshold)
        ? this.#internAsset(value)
        : value
    }
    if (typeof value !== 'object') {
      throw new TypeError(
        'History snapshots must contain JSON-compatible data.',
      )
    }
    if (seen.has(value)) {
      throw new TypeError('History snapshots must not contain cycles.')
    }
    seen.add(value)
    if (Array.isArray(value)) {
      const result = value.map((item) => this.#dehydrate(item, seen))
      seen.delete(value)
      return result
    }
    const result: Record<string, StoredValue> = {}
    for (const [key, item] of Object.entries(value)) {
      if (typeof item !== 'undefined') result[key] = this.#dehydrate(item, seen)
    }
    seen.delete(value)
    return result
  }

  #hydrate(value: StoredValue | undefined): T | undefined {
    if (typeof value === 'undefined') return undefined
    const visit = (item: StoredValue): unknown => {
      if (isReference(item)) {
        const asset = this.#assets.get(item.__pixelweaveAssetRef)
        if (typeof asset !== 'string') {
          throw new Error('A compact history asset is no longer available.')
        }
        return asset
      }
      if (Array.isArray(item)) return item.map(visit)
      if (typeof item === 'object' && item !== null) {
        return Object.fromEntries(
          Object.entries(item).map(([key, child]) => [key, visit(child)]),
        )
      }
      return item
    }
    return visit(value) as T
  }

  #internAsset(value: string): AssetReference {
    const base = `${hashString(value)}:${value.length}`
    let key = base
    let collision = 0
    while (this.#assets.has(key) && this.#assets.get(key) !== value) {
      collision += 1
      key = `${base}:${collision}`
    }
    if (!this.#assets.has(key)) this.#assets.set(key, value)
    return { __pixelweaveAssetRef: key }
  }

  #pruneAssets(): void {
    if (this.#assets.size === 0) return
    const referenced = new Set<string>()
    const visit = (value: StoredValue): void => {
      if (isReference(value)) {
        referenced.add(value.__pixelweaveAssetRef)
        return
      }
      if (Array.isArray(value)) {
        value.forEach(visit)
        return
      }
      if (typeof value === 'object' && value !== null) {
        Object.values(value).forEach(visit)
      }
    }
    this.#history.entries().forEach(visit)
    for (const key of this.#assets.keys()) {
      if (!referenced.has(key)) this.#assets.delete(key)
    }
  }

  #refreshStructuralSize(): void {
    this.#structuralCharacters = JSON.stringify(this.#history.entries()).length
  }
}
