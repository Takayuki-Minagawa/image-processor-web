import type {
  UserBinaryDirectoryHandle,
  UserBinaryFileHandle,
  UserBinaryStorage,
  UserBinaryWritable,
} from '../../lib/userBinaryRepository'

const notFound = (): Error => {
  const error = new Error('File not found.')
  error.name = 'NotFoundError'
  return error
}

const copy = (bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(bytes)

export class MemoryBinaryStorage implements UserBinaryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

export class MemoryBinaryDirectory implements UserBinaryDirectoryHandle {
  readonly files = new Map<string, Uint8Array<ArrayBuffer>>()
  failWrites = false
  failReads = false

  async getFileHandle(
    name: string,
    options: { create?: boolean } = {},
  ): Promise<UserBinaryFileHandle> {
    if (!this.files.has(name) && !options.create) throw notFound()
    if (!this.files.has(name)) this.files.set(name, new Uint8Array())
    return {
      getFile: async () => {
        if (this.failReads) throw new Error('Injected read failure.')
        const bytes = copy(this.files.get(name) ?? new Uint8Array())
        return {
          text: async () => new TextDecoder().decode(bytes),
          arrayBuffer: async () => bytes.buffer.slice(0),
        }
      },
      createWritable: async (): Promise<UserBinaryWritable> => {
        let pending: Uint8Array<ArrayBuffer> | null = null
        return {
          write: async (data) => {
            if (this.failWrites) throw new Error('Injected write failure.')
            pending =
              typeof data === 'string'
                ? new TextEncoder().encode(data)
                : copy(data)
          },
          close: async () => {
            if (this.failWrites) throw new Error('Injected close failure.')
            this.files.set(name, pending ?? new Uint8Array())
          },
          abort: async () => {
            pending = null
          },
        }
      },
    }
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name)) throw notFound()
  }

  corrupt(name: string, replacement: Uint8Array<ArrayBuffer>): void {
    if (!this.files.has(name)) throw notFound()
    this.files.set(name, copy(replacement))
  }

  binaryFileName(extension: string): string {
    const result = [...this.files.keys()].find((name) =>
      name.endsWith(extension),
    )
    if (!result) throw notFound()
    return result
  }
}
