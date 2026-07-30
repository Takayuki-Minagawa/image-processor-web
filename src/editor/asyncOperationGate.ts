/**
 * Tracks asynchronous editor work whose mutation may happen after an await.
 *
 * Transitions such as save, restore, new-document, and PWA activation can wait
 * for the gate to become idle before taking their authoritative snapshot.
 */
export class AsyncOperationGate {
  readonly #pending = new Set<Promise<unknown>>()

  get size(): number {
    return this.#pending.size
  }

  track<T>(operation: Promise<T>): Promise<T> {
    const tracked = operation.finally(() => {
      this.#pending.delete(tracked)
    })
    this.#pending.add(tracked)
    return tracked
  }

  async waitForIdle(): Promise<void> {
    while (this.#pending.size > 0) {
      await Promise.allSettled([...this.#pending])
    }
  }
}
