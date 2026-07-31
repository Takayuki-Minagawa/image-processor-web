import { describe, expect, it, vi } from 'vitest'
import { createSelectionWorkerMessageHandler } from './workerHandler'
import { SelectionWorkerClient, type SelectionWorkerLike } from './workerClient'
import type {
  SelectionWorkerRequest,
  SelectionWorkerResponse,
} from './workerProtocol'

class LoopbackWorker implements SelectionWorkerLike {
  readonly listeners = new Set<
    (event: { data: SelectionWorkerResponse }) => void
  >()
  readonly requests: SelectionWorkerRequest[] = []
  readonly transfers: Transferable[][] = []
  terminated = false

  readonly handle = createSelectionWorkerMessageHandler((response) => {
    this.listeners.forEach((listener) => listener({ data: response }))
  })

  postMessage(
    message: SelectionWorkerRequest,
    transfer: Transferable[] = [],
  ): void {
    this.requests.push(message)
    this.transfers.push(transfer)
    queueMicrotask(() => this.handle(message))
  }

  addEventListener(
    _type: 'message',
    listener: (event: { data: SelectionWorkerResponse }) => void,
  ): void {
    this.listeners.add(listener)
  }

  removeEventListener(
    _type: 'message',
    listener: (event: { data: SelectionWorkerResponse }) => void,
  ): void {
    this.listeners.delete(listener)
  }

  terminate(): void {
    this.terminated = true
  }
}

describe('selection worker protocol', () => {
  it('executes polygon and transform jobs through the client', async () => {
    const worker = new LoopbackWorker()
    const client = new SelectionWorkerClient(worker)

    const polygon = await client.run({
      kind: 'polygon',
      width: 2,
      height: 2,
      points: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 2 },
      ],
    })
    expect([...polygon.toBytes()]).toEqual([255, 255, 255, 255])

    const inverted = await client.run({
      kind: 'transform',
      operation: 'invert',
      mask: {
        width: 2,
        height: 2,
        data: polygon.toBytes(),
      },
    })
    expect([...inverted.toBytes()]).toEqual([0, 0, 0, 0])

    client.dispose()
    expect(worker.terminated).toBe(true)
  })

  it('cancels pending work and ignores a late result', async () => {
    const worker = new LoopbackWorker()
    const client = new SelectionWorkerClient(worker)
    const controller = new AbortController()
    const pending = client.run(
      {
        kind: 'polygon',
        width: 2,
        height: 2,
        points: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 0, y: 2 },
        ],
      },
      controller.signal,
    )
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.requests).toContainEqual({ type: 'cancel', id: 1 })
    client.dispose()
  })

  it('serializes worker errors without throwing from the message handler', () => {
    const post = vi.fn<(response: SelectionWorkerResponse) => void>()
    const handle = createSelectionWorkerMessageHandler(post)
    handle({
      type: 'run',
      id: 9,
      job: {
        kind: 'polygon',
        width: 1,
        height: 1,
        points: [],
      },
    })

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'result',
        id: 9,
        ok: false,
      }),
    )
  })

  it('can transfer ownership of a freshly captured image without cloning it', async () => {
    const worker = new LoopbackWorker()
    const client = new SelectionWorkerClient(worker)
    const data = new Uint8ClampedArray([10, 20, 30, 255])
    const result = client.run(
      {
        kind: 'flood-fill',
        image: { width: 1, height: 1, data },
        seedX: 0,
        seedY: 0,
      },
      undefined,
      { transferOwnership: true },
    )

    const request = worker.requests[0]
    expect(request.type).toBe('run')
    if (request.type !== 'run' || request.job.kind !== 'flood-fill') {
      throw new Error('Expected a flood-fill request.')
    }
    expect(request.job.image.data).toBe(data)
    expect(worker.transfers[0]).toContain(data.buffer)
    await expect(result).resolves.toBeInstanceOf(Object)
    client.dispose()
  })
})
