import {
  CompactHistory,
  type CompactHistoryOptions,
  type CompactHistoryStats,
} from './compactHistory'

export interface HistoryLabel {
  readonly id: number
  readonly label: string
  readonly time: string
}

/**
 * Keeps display metadata on the same bounded, branching timeline as snapshots.
 * Labels are added only when the compact history accepts a new checkpoint.
 */
export class LabeledHistory<T> {
  readonly #history: CompactHistory<T>
  #labels: HistoryLabel[] = []
  #nextId = 0

  constructor(options: CompactHistoryOptions<T> = {}) {
    this.#history = new CompactHistory<T>(options)
  }

  get limit(): number {
    return this.#history.limit
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

  get labels(): readonly HistoryLabel[] {
    return [...this.#labels]
  }

  get currentLabel(): HistoryLabel | undefined {
    return this.#labels[this.index]
  }

  current(): T | undefined {
    return this.#history.current()
  }

  entries(): readonly T[] {
    return this.#history.entries()
  }

  push(snapshot: T, label: string, time: string): boolean {
    const previousIndex = this.index
    if (!this.#history.push(snapshot)) return false

    this.#labels = [
      ...this.#labels.slice(0, previousIndex + 1),
      Object.freeze({ id: this.#nextId++, label, time }),
    ].slice(-this.limit)
    return true
  }

  /** Navigation changes the current snapshot without relabeling the edit. */
  replaceCurrent(snapshot: T, label = '', time = ''): boolean {
    if (this.size === 0) return this.push(snapshot, label, time)
    return this.#history.replaceCurrent(snapshot)
  }

  undo(): T | undefined {
    return this.#history.undo()
  }

  redo(): T | undefined {
    return this.#history.redo()
  }

  clear(): void {
    this.#history.clear()
    this.#labels = []
  }

  reset(): void
  reset(initial: T, label: string, time: string): void
  reset(initial?: T, label = '', time = ''): void {
    this.clear()
    if (arguments.length > 0) this.push(initial as T, label, time)
  }

  stats(): CompactHistoryStats {
    return this.#history.stats()
  }
}
