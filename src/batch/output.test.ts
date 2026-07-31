import { describe, expect, it, vi } from 'vitest'
import {
  chooseBatchOutputDestination,
  writeEntriesToDirectory,
  type FileSystemDirectoryHandleLike,
} from './output'

describe('batch output decisions', () => {
  it('automatically uses ZIP only when directory capability is unavailable', async () => {
    await expect(
      chooseBatchOutputDestination({ mode: 'auto' }),
    ).resolves.toEqual({ kind: 'zip' })
    await expect(
      chooseBatchOutputDestination({ mode: 'directory' }),
    ).rejects.toThrow(/not supported/)

    const abort = new DOMException('declined', 'AbortError')
    await expect(
      chooseBatchOutputDestination({
        mode: 'auto',
        showDirectoryPicker: async () => {
          throw abort
        },
      }),
    ).rejects.toBe(abort)
  })

  it('writes completed entries one by one and reports progress', async () => {
    const writes = new Map<string, ArrayBuffer>()
    const progress = vi.fn()
    const directory: FileSystemDirectoryHandleLike = {
      async getFileHandle(name) {
        return {
          async createWritable() {
            return {
              async write(data) {
                if (!(data instanceof ArrayBuffer)) {
                  throw new TypeError('expected buffer')
                }
                writes.set(name, data)
              },
              async close() {},
            }
          },
        }
      },
    }
    await writeEntriesToDirectory(
      directory,
      [
        { name: 'one.png', data: new Uint8Array([1]).buffer },
        { name: 'two.png', data: new Uint8Array([2]).buffer },
      ],
      { onProgress: progress },
    )

    expect([...writes.keys()]).toEqual(['one.png', 'two.png'])
    expect(progress).toHaveBeenLastCalledWith(2, 2)
  })

  it('rejects duplicate sanitized names and aborts before the next write', async () => {
    const directory: FileSystemDirectoryHandleLike = {
      async getFileHandle() {
        return {
          async createWritable() {
            return {
              async write() {},
              async close() {},
            }
          },
        }
      },
    }
    await expect(
      writeEntriesToDirectory(directory, [
        { name: 'same?.png', data: new ArrayBuffer(1) },
        { name: 'same*.png', data: new ArrayBuffer(1) },
      ]),
    ).rejects.toThrow(/Duplicate/)

    const controller = new AbortController()
    controller.abort()
    await expect(
      writeEntriesToDirectory(
        directory,
        [{ name: 'never.png', data: new ArrayBuffer(1) }],
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('asks an in-progress writable stream to abort when cancellation arrives', async () => {
    let rejectWrite: ((reason?: unknown) => void) | undefined
    let markWriteStarted: (() => void) | undefined
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve
    })
    const abort = vi.fn(async (reason?: unknown) => {
      rejectWrite?.(reason)
    })
    const directory: FileSystemDirectoryHandleLike = {
      async getFileHandle() {
        return {
          async createWritable() {
            return {
              write: () =>
                new Promise<void>((_resolve, reject) => {
                  rejectWrite = reject
                  markWriteStarted?.()
                }),
              async close() {},
              abort,
            }
          },
        }
      },
    }
    const controller = new AbortController()
    const pending = writeEntriesToDirectory(
      directory,
      [{ name: 'large.png', data: new ArrayBuffer(10) }],
      { signal: controller.signal },
    )
    await writeStarted
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(abort).toHaveBeenCalled()
  })
})
