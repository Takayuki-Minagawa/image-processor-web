export class ClipboardImageError extends Error {
  constructor() {
    super('PNG clipboard writing is unavailable.')
    this.name = 'ClipboardImageError'
  }
}

export const canCopyPngToClipboard = (): boolean =>
  typeof navigator !== 'undefined' &&
  typeof navigator.clipboard?.write === 'function' &&
  typeof ClipboardItem !== 'undefined' &&
  (typeof ClipboardItem.supports !== 'function' ||
    ClipboardItem.supports('image/png'))

/** Start the native write in the click task, before asynchronous rendering. */
export function copyPngToClipboard(
  createBlob: () => Promise<Blob>,
): Promise<void> {
  if (!canCopyPngToClipboard()) return Promise.reject(new ClipboardImageError())
  const blob = Promise.resolve()
    .then(createBlob)
    .then((result) => {
      if (result.type !== 'image/png' || result.size === 0) {
        throw new TypeError('Clipboard export must be a nonempty PNG.')
      }
      return result
    })
  // A denied write may never consume the item's data promise.
  void blob.catch(() => undefined)
  let written: Promise<void>
  try {
    written = navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob }),
    ])
  } catch (error) {
    written = Promise.reject(error)
  }
  // Keep the caller's operation lock until rendering settles even if the
  // browser denies the write immediately.
  return written.then(
    async () => {
      await blob
    },
    async (error: unknown) => {
      await blob.catch(() => undefined)
      throw error
    },
  )
}
