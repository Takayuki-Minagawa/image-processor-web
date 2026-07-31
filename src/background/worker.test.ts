import { describe, expect, it, vi } from 'vitest'
import {
  BackgroundWorkerClient,
  type BackgroundWorkerLike,
} from './workerClient'
import {
  createBackgroundWorkerMessageHandler,
  type BackgroundWorkerAdapterResolver,
} from './workerHandler'
import type {
  BackgroundWorkerRequest,
  BackgroundWorkerResponse,
} from './workerProtocol'

class LoopbackBackgroundWorker implements BackgroundWorkerLike {
  readonly listeners = new Set<
    (event: { data: BackgroundWorkerResponse }) => void
  >()
  readonly requests: BackgroundWorkerRequest[] = []
  readonly transfers: Transferable[][] = []
  terminated = false

  readonly handle: ReturnType<typeof createBackgroundWorkerMessageHandler>

  constructor(resolveAdapter?: BackgroundWorkerAdapterResolver) {
    this.handle = createBackgroundWorkerMessageHandler(
      (response) => {
        this.listeners.forEach((listener) => listener({ data: response }))
      },
      undefined,
      resolveAdapter,
    )
  }

  postMessage(
    message: BackgroundWorkerRequest,
    transfer: Transferable[] = [],
  ): void {
    this.requests.push(message)
    this.transfers.push(transfer)
    queueMicrotask(() => this.handle(message))
  }

  addEventListener(
    _type: 'message',
    listener: (event: { data: BackgroundWorkerResponse }) => void,
  ): void {
    this.listeners.add(listener)
  }

  removeEventListener(
    _type: 'message',
    listener: (event: { data: BackgroundWorkerResponse }) => void,
  ): void {
    this.listeners.delete(listener)
  }

  terminate(): void {
    this.terminated = true
  }
}

describe('background worker client', () => {
  it('returns a local result and forwards progress', async () => {
    const worker = new LoopbackBackgroundWorker()
    const client = new BackgroundWorkerClient(worker)
    const progress: number[] = []
    const result = await client.run(
      {
        image: {
          width: 2,
          height: 1,
          data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]),
        },
        options: { backgroundTolerance: 4, edgeSoftness: 8 },
      },
      { onProgress: (value) => progress.push(value) },
    )

    expect(result.source).toBe('deterministic-fallback')
    expect(result.mask.width).toBe(2)
    expect(progress.at(-1)).toBe(1)
    client.dispose()
    expect(worker.terminated).toBe(true)
  })

  it('rejects an aborted pending request and sends cancellation', async () => {
    const worker = new LoopbackBackgroundWorker()
    const client = new BackgroundWorkerClient(worker)
    const controller = new AbortController()
    const pending = client.run(
      {
        image: {
          width: 1,
          height: 1,
          data: new Uint8ClampedArray([0, 0, 0, 255]),
        },
      },
      { signal: controller.signal },
    )
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.requests).toContainEqual({ type: 'cancel', id: 1 })
    client.dispose()
  })

  it('passes an explicitly consented model request to an async Worker adapter', async () => {
    const resolveAdapter = vi.fn<BackgroundWorkerAdapterResolver>(
      async (job) => ({
        id: job.model?.descriptor.id ?? 'missing',
        async segment() {
          return new Float32Array([1, 0])
        },
      }),
    )
    const worker = new LoopbackBackgroundWorker(resolveAdapter)
    const client = new BackgroundWorkerClient(worker)
    const result = await client.run({
      image: {
        width: 2,
        height: 1,
        data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 255]),
      },
      model: {
        descriptor: {
          id: 'u2netp',
          version: 'test',
          sizeBytes: 4,
          sha256: 'a'.repeat(64),
          downloadUrl: 'https://example.test/u2netp.onnx',
        },
        consentGranted: true,
      },
    })

    expect(resolveAdapter).toHaveBeenCalledOnce()
    expect(result.source).toBe('model')
    expect([...result.mask.toBytes()]).toEqual([255, 0])
    client.dispose()
  })

  it('can transfer ownership of a freshly captured RGBA buffer', async () => {
    const worker = new LoopbackBackgroundWorker()
    const client = new BackgroundWorkerClient(worker)
    const data = new Uint8ClampedArray([255, 255, 255, 255])
    const pending = client.run(
      {
        image: { width: 1, height: 1, data },
      },
      { transferOwnership: true },
    )

    const request = worker.requests[0]
    expect(request.type).toBe('run')
    if (request.type !== 'run') {
      throw new Error('Expected a run request.')
    }
    expect(request.job.image.data).toBe(data)
    expect(worker.transfers[0]).toContain(data.buffer)
    await pending
    client.dispose()
  })
})
