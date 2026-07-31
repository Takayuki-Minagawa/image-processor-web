import type { StoredZipEntry } from './zip'
import { stripControlCharacters } from './safety'

export interface WritableFileStreamLike {
  write(data: ArrayBuffer | Blob): Promise<void>
  close(): Promise<void>
  abort?: (reason?: unknown) => Promise<void>
}

export interface FileSystemFileHandleLike {
  createWritable(): Promise<WritableFileStreamLike>
}

export interface FileSystemDirectoryHandleLike {
  getFileHandle(
    name: string,
    options: { create: true },
  ): Promise<FileSystemFileHandleLike>
}

export type DirectoryPicker = () => Promise<FileSystemDirectoryHandleLike>

export type BatchOutputDestination =
  { kind: 'directory'; handle: FileSystemDirectoryHandleLike } | { kind: 'zip' }

export const chooseBatchOutputDestination = async (options: {
  mode?: 'auto' | 'directory' | 'zip'
  showDirectoryPicker?: DirectoryPicker
}): Promise<BatchOutputDestination> => {
  const mode = options.mode ?? 'auto'
  if (mode === 'zip') {
    return { kind: 'zip' }
  }
  if (!options.showDirectoryPicker) {
    if (mode === 'directory') {
      throw new Error('Direct folder output is not supported in this browser.')
    }
    return { kind: 'zip' }
  }
  // Abort and permission errors intentionally propagate. ZIP is an automatic
  // fallback only when the capability is unavailable, not when a user declines.
  return {
    kind: 'directory',
    handle: await options.showDirectoryPicker(),
  }
}

const safeFlatFileName = (name: string): string => {
  const normalized = name.normalize('NFKC')
  const safe = stripControlCharacters(normalized)
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 160)
  if (!safe) {
    throw new TypeError('Output file names must not be empty.')
  }
  return safe
}

export const writeEntriesToDirectory = async (
  directory: FileSystemDirectoryHandleLike,
  entries: readonly StoredZipEntry[],
  options: {
    signal?: AbortSignal
    onProgress?: (completed: number, total: number) => void
  } = {},
): Promise<void> => {
  const names = new Set<string>()
  for (let index = 0; index < entries.length; index += 1) {
    if (options.signal?.aborted) {
      throw new DOMException('Folder output was cancelled.', 'AbortError')
    }
    const entry = entries[index]
    const name = safeFlatFileName(entry.name)
    if (names.has(name)) {
      throw new TypeError(`Duplicate output file "${name}".`)
    }
    names.add(name)
    const file = await directory.getFileHandle(name, { create: true })
    const writable = await file.createWritable()
    const abortReason = new DOMException(
      'Folder output was cancelled.',
      'AbortError',
    )
    const onAbort = (): void => {
      void writable.abort?.(abortReason).catch(() => undefined)
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      await writable.write(entry.data)
      if (options.signal?.aborted) {
        throw abortReason
      }
      await writable.close()
    } catch (error) {
      await writable.abort?.(error).catch(() => undefined)
      throw error
    } finally {
      options.signal?.removeEventListener('abort', onAbort)
    }
    options.onProgress?.(index + 1, entries.length)
  }
}
