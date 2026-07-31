import { describe, expect, it, vi } from 'vitest'
import {
  BackgroundModelCacheError,
  MemoryModelConsentRepository,
  type BackgroundModelDescriptor,
  type ModelCacheDirectory,
  type ModelCacheFileHandle,
  type ModelCacheWritable,
} from './modelCache'
import {
  BackgroundModelDownloadError,
  createBackgroundOnnxModelLoader,
  downloadBackgroundModelBytes,
  type BackgroundModelFetch,
} from './modelLoader'
import type { OnnxSessionFactory, OnnxTensorLike } from './onnxSegmentation'

const abcHash =
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

const abc = (): Uint8Array => new TextEncoder().encode('abc')

const descriptor = (
  downloadUrl = 'https://models.example.test/subject-lite.onnx',
): BackgroundModelDescriptor => ({
  id: 'subject-lite',
  version: '1.0.0',
  sizeBytes: 3,
  sha256: abcHash,
  downloadUrl,
})

const streamingResponse = (
  chunks: readonly Uint8Array[],
  options: { status?: number; contentLength?: string } = {},
): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(chunk))
        controller.close()
      },
    }),
    {
      status: options.status ?? 200,
      headers:
        options.contentLength === undefined
          ? undefined
          : { 'Content-Length': options.contentLength },
    },
  )

const segmentationFactory = (): OnnxSessionFactory => ({
  createTensor: (
    data: Float32Array,
    dims: readonly number[],
  ): OnnxTensorLike => ({ data, dims }),
  createSession: async () => ({
    run: async () => ({
      output: {
        data: new Float32Array([1]),
        dims: [1, 1, 1, 1],
      },
    }),
  }),
})

class FakeOpfsRoot implements ModelCacheDirectory {
  readonly files = new Map<string, Uint8Array>()

  async getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<ModelCacheFileHandle> {
    if (!this.files.has(name) && !options?.create) {
      throw new DOMException('missing', 'NotFoundError')
    }
    return {
      getFile: async () => {
        const value = this.files.get(name)
        if (!value) {
          throw new DOMException('missing', 'NotFoundError')
        }
        return {
          arrayBuffer: async () => new Uint8Array(value).buffer,
        }
      },
      createWritable: async (): Promise<ModelCacheWritable> => {
        let pending = new Uint8Array()
        return {
          write: async (data) => {
            pending = new Uint8Array(data)
          },
          close: async () => {
            this.files.set(name, pending)
          },
        }
      },
    }
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name)) {
      throw new DOMException('missing', 'NotFoundError')
    }
  }
}

describe('background ONNX model loader', () => {
  it('does not fetch or load a runtime until explicit consent and use', async () => {
    const fetcher = vi.fn<BackgroundModelFetch>(async () =>
      streamingResponse([new Uint8Array([97]), new Uint8Array([98, 99])], {
        contentLength: '3',
      }),
    )
    const loadSessionFactory = vi.fn(async () => segmentationFactory())
    const progress = vi.fn()
    const loader = createBackgroundOnnxModelLoader({
      descriptor: descriptor(),
      loadSessionFactory,
      fetcher,
      cache: undefined,
      getOpfsRoot: async () => {
        throw new DOMException('blocked', 'SecurityError')
      },
    })

    expect(fetcher).not.toHaveBeenCalled()
    expect(loadSessionFactory).not.toHaveBeenCalled()
    await expect(loader.load()).rejects.toMatchObject({
      code: 'consent-required',
    })
    expect(fetcher).not.toHaveBeenCalled()

    await loader.grantConsent()
    expect(fetcher).not.toHaveBeenCalled()
    const adapter = await loader.load({ reportProgress: progress })

    expect(adapter.id).toBe('subject-lite@1.0.0')
    expect(fetcher).toHaveBeenCalledOnce()
    expect(loadSessionFactory).not.toHaveBeenCalled()
    expect(progress).toHaveBeenCalledWith(1 / 3, 'prepare')
    expect(progress).toHaveBeenCalledWith(1, 'prepare')

    await expect(
      adapter.segment(
        {
          width: 1,
          height: 1,
          data: new Uint8ClampedArray([1, 2, 3, 255]),
        },
        {},
      ),
    ).resolves.toEqual(new Float32Array([1]))
    expect(loadSessionFactory).toHaveBeenCalledOnce()
  })

  it('persists verified bytes in OPFS and reuses them without a network', async () => {
    const root = new FakeOpfsRoot()
    const consentRepository = new MemoryModelConsentRepository()
    const onlineFetch = vi.fn<BackgroundModelFetch>(async () =>
      streamingResponse([abc()], { contentLength: '3' }),
    )
    const common = {
      descriptor: descriptor(),
      loadSessionFactory: async () => segmentationFactory(),
      getOpfsRoot: async () => root,
      consentRepository,
    }
    const online = createBackgroundOnnxModelLoader({
      ...common,
      fetcher: onlineFetch,
    })
    await online.grantConsent()
    await online.load()
    expect(onlineFetch).toHaveBeenCalledOnce()
    expect(root.files.size).toBe(1)

    const offlineFetch = vi.fn<BackgroundModelFetch>(async () => {
      throw new TypeError('offline')
    })
    const offline = createBackgroundOnnxModelLoader({
      ...common,
      fetcher: offlineFetch,
    })

    await expect(offline.load()).resolves.toMatchObject({
      id: 'subject-lite@1.0.0',
    })
    expect(offlineFetch).not.toHaveBeenCalled()
  })

  it('verifies SHA-256 before committing downloaded bytes', async () => {
    const fetcher = vi.fn<BackgroundModelFetch>(async () =>
      streamingResponse([abc()], { contentLength: '3' }),
    )
    const loader = createBackgroundOnnxModelLoader({
      descriptor: {
        ...descriptor(),
        sha256: '0'.repeat(64),
      },
      loadSessionFactory: async () => segmentationFactory(),
      fetcher,
      getOpfsRoot: async () => {
        throw new DOMException('blocked', 'SecurityError')
      },
    })
    await loader.grantConsent()

    await expect(loader.load()).rejects.toMatchObject({
      code: 'model-checksum-mismatch',
    })
  })
})

describe('background model HTTP download', () => {
  it('rejects unsafe schemes before fetch', async () => {
    const fetcher = vi.fn<BackgroundModelFetch>()

    await expect(
      downloadBackgroundModelBytes(descriptor('javascript:alert(1)'), {
        fetcher,
      }),
    ).rejects.toMatchObject({
      code: 'unsafe-download-url',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('validates HTTP status and Content-Length', async () => {
    await expect(
      downloadBackgroundModelBytes(descriptor(), {
        fetcher: async () =>
          new Response('unavailable', {
            status: 503,
            statusText: 'Unavailable',
          }),
      }),
    ).rejects.toMatchObject({ code: 'http-error' })

    await expect(
      downloadBackgroundModelBytes(descriptor(), {
        fetcher: async () =>
          streamingResponse([abc()], { contentLength: 'not-a-number' }),
      }),
    ).rejects.toMatchObject({ code: 'invalid-content-length' })

    await expect(
      downloadBackgroundModelBytes(descriptor(), {
        fetcher: async () => streamingResponse([abc()], { contentLength: '2' }),
      }),
    ).rejects.toMatchObject({ code: 'download-size-mismatch' })
  })

  it('enforces configured and streamed byte limits', async () => {
    const fetcher = vi.fn<BackgroundModelFetch>()
    await expect(
      downloadBackgroundModelBytes(descriptor(), {
        fetcher,
        maximumBytes: 2,
      }),
    ).rejects.toMatchObject({ code: 'download-size-limit' })
    expect(fetcher).not.toHaveBeenCalled()

    await expect(
      downloadBackgroundModelBytes(descriptor(), {
        fetcher: async () => streamingResponse([new Uint8Array([1, 2, 3, 4])]),
      }),
    ).rejects.toMatchObject({ code: 'download-size-limit' })
  })

  it('cancels a streaming download through AbortSignal', async () => {
    const controller = new AbortController()
    const progress = vi.fn((loaded: number) => {
      if (loaded === 1) {
        controller.abort()
      }
    })

    await expect(
      downloadBackgroundModelBytes(descriptor(), {
        fetcher: async () =>
          streamingResponse([
            new Uint8Array([97]),
            new Uint8Array([98]),
            new Uint8Array([99]),
          ]),
        signal: controller.signal,
        reportProgress: progress,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(progress).toHaveBeenCalledWith(1, 3)
  })

  it('exposes stable download errors for callers', () => {
    const error = new BackgroundModelDownloadError('http-error', 'failed')
    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe('http-error')
    expect(
      new BackgroundModelCacheError('consent-required', 'consent').code,
    ).toBe('consent-required')
  })
})
