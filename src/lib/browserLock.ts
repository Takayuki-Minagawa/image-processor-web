export interface BrowserLockManagerLike {
  request<T>(name: string, callback: () => T | PromiseLike<T>): Promise<T>
}

/** Returns Web Locks when the browser exposes them without throwing. */
export const detectBrowserLockManager = (): BrowserLockManagerLike | null => {
  try {
    if (
      typeof navigator === 'undefined' ||
      !navigator.locks ||
      typeof navigator.locks.request !== 'function'
    ) {
      return null
    }
    return navigator.locks as BrowserLockManagerLike
  } catch {
    return null
  }
}

export const runWithOptionalBrowserLock = <T>(
  manager: BrowserLockManagerLike | null,
  name: string,
  operation: () => T | PromiseLike<T>,
): Promise<T> =>
  manager ? manager.request(name, operation) : Promise.resolve().then(operation)
