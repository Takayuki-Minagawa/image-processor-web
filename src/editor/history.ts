export interface HistoryOptions<T> {
  /**
   * Maximum number of snapshots retained, including the current snapshot.
   */
  limit?: number
  /**
   * Custom equality for snapshots that are not plain structural data.
   */
  equals?: (left: T, right: T) => boolean
}

const structuralEqual = (
  left: unknown,
  right: unknown,
  visited: WeakMap<object, object>,
): boolean => {
  if (Object.is(left, right)) {
    return true
  }

  if (
    typeof left !== 'object' ||
    left === null ||
    typeof right !== 'object' ||
    right === null
  ) {
    return false
  }

  const priorMatch = visited.get(left)
  if (priorMatch !== undefined) {
    return priorMatch === right
  }
  visited.set(left, right)

  if (left instanceof Date || right instanceof Date) {
    return (
      left instanceof Date &&
      right instanceof Date &&
      left.getTime() === right.getTime()
    )
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (
      !Array.isArray(left) ||
      !Array.isArray(right) ||
      left.length !== right.length
    ) {
      return false
    }
    return left.every((item, index) =>
      structuralEqual(item, right[index], visited),
    )
  }

  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord).sort()
  const rightKeys = Object.keys(rightRecord).sort()

  if (
    leftKeys.length !== rightKeys.length ||
    leftKeys.some((key, index) => key !== rightKeys[index])
  ) {
    return false
  }

  return leftKeys.every((key) =>
    structuralEqual(leftRecord[key], rightRecord[key], visited),
  )
}

const defaultEquals = <T>(left: T, right: T): boolean =>
  structuralEqual(left, right, new WeakMap())

/**
 * Bounded, branching snapshot history.
 *
 * Add the initial state first, then call `push` after committed editor
 * transactions. Undo and redo return the state that should become current.
 */
export class History<T> {
  readonly limit: number

  readonly #equals: (left: T, right: T) => boolean
  #entries: T[] = []
  #cursor = -1

  constructor(options: HistoryOptions<T> = {}) {
    const limit = options.limit ?? 100
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError('History limit must be a positive integer.')
    }

    this.limit = limit
    this.#equals = options.equals ?? defaultEquals
  }

  get size(): number {
    return this.#entries.length
  }

  get index(): number {
    return this.#cursor
  }

  get canUndo(): boolean {
    return this.#cursor > 0
  }

  get canRedo(): boolean {
    return this.#cursor >= 0 && this.#cursor < this.#entries.length - 1
  }

  current(): T | undefined {
    return this.#entries[this.#cursor]
  }

  /**
   * Returns a shallow copy so callers cannot change the history structure.
   * Snapshot values themselves remain owned by the caller.
   */
  entries(): readonly T[] {
    return [...this.#entries]
  }

  /**
   * Commits a snapshot. Returns false when it is equal to the current state.
   */
  push(snapshot: T): boolean {
    const current = this.current()
    if (this.#cursor >= 0 && this.#equals(current as T, snapshot)) {
      return false
    }

    if (this.canRedo) {
      this.#entries.splice(this.#cursor + 1)
    }

    this.#entries.push(snapshot)
    this.#cursor = this.#entries.length - 1

    if (this.#entries.length > this.limit) {
      const overflow = this.#entries.length - this.limit
      this.#entries.splice(0, overflow)
      this.#cursor -= overflow
    }

    return true
  }

  undo(): T | undefined {
    if (!this.canUndo) {
      return undefined
    }
    this.#cursor -= 1
    return this.current()
  }

  redo(): T | undefined {
    if (!this.canRedo) {
      return undefined
    }
    this.#cursor += 1
    return this.current()
  }

  clear(): void {
    this.#entries = []
    this.#cursor = -1
  }

  /**
   * Clears history and optionally establishes a new initial state.
   */
  reset(): void
  reset(initial: T): void
  reset(initial?: T): void {
    this.clear()
    if (arguments.length > 0) {
      this.push(initial as T)
    }
  }
}

export { History as BoundedHistory }
