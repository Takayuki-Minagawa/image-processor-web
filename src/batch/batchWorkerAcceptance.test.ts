import { describe, expect, it } from 'vitest'
import type {
  ImagePipelineWorkerRequest,
  ImagePipelineWorkerResponse,
} from './imagePipelineProtocol'
import {
  BatchController,
  type BatchItem,
  type BatchProgress,
  type BatchSource,
} from './batchController'
import {
  ImagePipelineClient,
  type ImagePipelineClientPort,
  type PipelineClientProcessInput,
  type PipelineClientProcessResult,
  type WorkerLike,
} from './imagePipelineClient'

const source = (index: number): BatchSource => ({
  name: `photo-${index.toString().padStart(2, '0')}.png`,
  type: 'image/png',
  size: 1,
  arrayBuffer: async () => new Uint8Array([index]).buffer,
})

const fiftyItems = (): BatchItem[] =>
  Array.from({ length: 50 }, (_, index) => ({
    id: `item-${index}`,
    source: source(index),
  }))

class CooperativeWorker implements WorkerLike {
  readonly processTransfers: Transferable[][] = []
  readonly processIds: string[] = []
  readonly #messageListeners = new Set<
    (event: MessageEvent<ImagePipelineWorkerResponse>) => void
  >()
  readonly #errorListeners = new Set<(event: ErrorEvent) => void>()
  readonly #active = new Set<string>()
  maximumActive = 0
  terminated = false

  postMessage(
    message: ImagePipelineWorkerRequest,
    transfer: Transferable[] = [],
  ): void {
    if (message.type === 'cancel') {
      if (this.#active.delete(message.jobId)) {
        queueMicrotask(() => {
          this.#emit({ type: 'cancelled', jobId: message.jobId })
        })
      }
      return
    }
    if (message.type !== 'process') {
      throw new Error('This acceptance worker only handles image jobs.')
    }

    this.processIds.push(message.jobId)
    this.processTransfers.push(transfer)
    this.#active.add(message.jobId)
    this.maximumActive = Math.max(this.maximumActive, this.#active.size)

    // A real Worker replies on a later event-loop turn. Modeling that boundary
    // verifies that a 50-file run does not become one synchronous main-thread
    // loop without relying on a machine-specific duration threshold.
    globalThis.setTimeout(() => {
      if (!this.#active.has(message.jobId)) return
      this.#emit({
        type: 'progress',
        jobId: message.jobId,
        phase: 'commands',
        progress: 0.5,
      })
      this.#active.delete(message.jobId)
      this.#emit({
        type: 'processResult',
        jobId: message.jobId,
        data: new Uint8Array([9]).buffer,
        mimeType: message.output.mimeType,
        width: 16,
        height: 16,
      })
    }, 0)
  }

  addEventListener(
    type: 'message' | 'error',
    listener:
      | ((event: MessageEvent<ImagePipelineWorkerResponse>) => void)
      | ((event: ErrorEvent) => void),
  ): void {
    if (type === 'message') {
      this.#messageListeners.add(
        listener as (event: MessageEvent<ImagePipelineWorkerResponse>) => void,
      )
    } else {
      this.#errorListeners.add(listener as (event: ErrorEvent) => void)
    }
  }

  removeEventListener(
    type: 'message' | 'error',
    listener:
      | ((event: MessageEvent<ImagePipelineWorkerResponse>) => void)
      | ((event: ErrorEvent) => void),
  ): void {
    if (type === 'message') {
      this.#messageListeners.delete(
        listener as (event: MessageEvent<ImagePipelineWorkerResponse>) => void,
      )
    } else {
      this.#errorListeners.delete(listener as (event: ErrorEvent) => void)
    }
  }

  terminate(): void {
    this.terminated = true
  }

  #emit(response: ImagePipelineWorkerResponse): void {
    const event = {
      data: response,
    } as MessageEvent<ImagePipelineWorkerResponse>
    this.#messageListeners.forEach((listener) => listener(event))
  }
}

interface PendingProcess {
  input: PipelineClientProcessInput
  resolve(result: PipelineClientProcessResult): void
  reject(error: unknown): void
}

class ControllableClient implements ImagePipelineClientPort {
  readonly started: PipelineClientProcessInput[] = []
  readonly cancelled: string[] = []
  readonly pending = new Map<string, PendingProcess>()

  process(
    input: PipelineClientProcessInput,
  ): Promise<PipelineClientProcessResult> {
    this.started.push(input)
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        this.pending.delete(input.jobId)
        reject(new DOMException('cancelled', 'AbortError'))
      }
      input.signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(input.jobId, {
        input,
        resolve: (result) => {
          input.signal?.removeEventListener('abort', onAbort)
          this.pending.delete(input.jobId)
          resolve(result)
        },
        reject,
      })
    })
  }

  async createZip(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0)
  }

  cancel(jobId: string): void {
    this.cancelled.push(jobId)
  }

  complete(jobId: string): void {
    const pending = this.pending.get(jobId)
    if (!pending) {
      throw new Error(`No pending process for ${jobId}.`)
    }
    pending.resolve({
      data: new Uint8Array([9]).buffer,
      mimeType: pending.input.output.mimeType,
      width: 16,
      height: 16,
    })
  }
}

const waitForStarted = async (
  client: ControllableClient,
  expected: number,
): Promise<void> => {
  for (let turn = 0; turn < 20; turn += 1) {
    if (client.started.length === expected) return
    await Promise.resolve()
  }
  throw new Error(
    `Expected ${expected} jobs to start, received ${client.started.length}.`,
  )
}

describe('50-file Worker batch acceptance', () => {
  it('keeps work behind the Worker boundary and reports bounded monotonic progress', async () => {
    const worker = new CooperativeWorker()
    const client = new ImagePipelineClient(worker)
    const controller = new BatchController(client)
    const progress: BatchProgress[] = []
    let mainThreadTurnObserved = false
    const mainThreadTurn = new Promise<void>((resolve) => {
      globalThis.setTimeout(() => {
        mainThreadTurnObserved = true
        resolve()
      }, 0)
    })

    const result = await controller.run(fiftyItems(), {
      commands: [],
      output: { mimeType: 'image/png' },
      concurrency: 4,
      onProgress: (snapshot) => progress.push(snapshot),
    })
    await mainThreadTurn

    expect(result.status).toBe('completed')
    expect(result.completed).toHaveLength(50)
    expect(result.failed).toEqual([])
    expect(result.completed.map(({ id }) => id)).toEqual(
      fiftyItems().map(({ id }) => id),
    )
    expect(worker.processIds).toHaveLength(50)
    expect(worker.maximumActive).toBeLessThanOrEqual(4)
    expect(
      worker.processTransfers.every(
        (transfer) =>
          transfer.length === 1 && transfer[0] instanceof ArrayBuffer,
      ),
    ).toBe(true)
    expect(mainThreadTurnObserved).toBe(true)
    expect(progress.filter(({ current }) => current).length).toBe(50)
    expect(progress.at(-1)).toMatchObject({
      completed: 50,
      failed: 0,
      total: 50,
      active: 0,
    })
    expect(progress.map(({ completed }) => completed)).toEqual(
      [...progress]
        .map(({ completed }) => completed)
        .sort((left, right) => left - right),
    )

    client.dispose()
    expect(worker.terminated).toBe(true)
  })

  it('cancels the remaining 49 files after one completion and returns only that output', async () => {
    const client = new ControllableClient()
    const controller = new BatchController(client)
    const progress: BatchProgress[] = []
    let cancellationRequested = false
    const pendingRun = controller.run(fiftyItems(), {
      commands: [],
      output: { mimeType: 'image/png' },
      concurrency: 4,
      onProgress: (snapshot) => {
        progress.push(snapshot)
        if (snapshot.completed === 1 && !cancellationRequested) {
          cancellationRequested = controller.cancel()
        }
      },
    })

    await waitForStarted(client, 4)
    const completedJobId = client.started[0].jobId
    client.complete(completedJobId)
    const result = await pendingRun

    expect(cancellationRequested).toBe(true)
    expect(result).toMatchObject({
      status: 'cancelled',
      failed: [],
    })
    expect(result.completed.map(({ id }) => id)).toEqual(['item-0'])
    expect(client.started).toHaveLength(4)
    expect(client.cancelled).toHaveLength(3)
    expect(client.cancelled).not.toContain(completedJobId)
    expect(progress.at(-1)).toMatchObject({
      completed: 1,
      failed: 0,
      total: 50,
      active: 0,
    })
  })
})
