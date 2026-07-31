import { SelectionMask } from '../selection/mask'
import type { BackgroundRemovalResult } from './segmentation'
import type {
  BackgroundRemovalJob,
  BackgroundWorkerRequest,
  BackgroundWorkerResponse,
} from './workerProtocol'

export interface BackgroundWorkerLike {
  postMessage(message: BackgroundWorkerRequest, transfer?: Transferable[]): void
  addEventListener(
    type: 'message',
    listener: (event: { data: BackgroundWorkerResponse }) => void,
  ): void
  removeEventListener(
    type: 'message',
    listener: (event: { data: BackgroundWorkerResponse }) => void,
  ): void
  terminate?(): void
}

export interface BackgroundWorkerRunOptions {
  signal?: AbortSignal
  onProgress?(progress: number, stage: 'prepare' | 'infer' | 'compose'): void
  transferOwnership?: boolean
}

interface Pending {
  resolve(result: BackgroundRemovalResult): void
  reject(error: Error): void
  options: BackgroundWorkerRunOptions
  abort?: () => void
}

export class BackgroundWorkerClient {
  readonly #worker: BackgroundWorkerLike
  readonly #pending = new Map<number, Pending>()
  #nextId = 1
  #disposed = false

  readonly #onMessage = (event: { data: BackgroundWorkerResponse }): void => {
    const response = event.data
    const pending = this.#pending.get(response.id)
    if (!pending) return
    if (response.type === 'progress') {
      pending.options.onProgress?.(response.progress, response.stage)
      return
    }

    this.#pending.delete(response.id)
    if (pending.options.signal && pending.abort) {
      pending.options.signal.removeEventListener('abort', pending.abort)
    }
    if (!response.ok) {
      const error = new Error(response.error.message)
      error.name = response.error.name
      pending.reject(error)
      return
    }
    try {
      const mask = SelectionMask.fromBytes(
        response.result.width,
        response.result.height,
        response.result.mask,
      )
      pending.resolve({
        width: response.result.width,
        height: response.result.height,
        mask,
        rgba: new Uint8ClampedArray(response.result.rgba),
        source: response.result.source,
        ...(response.result.warning === undefined
          ? {}
          : { warning: response.result.warning }),
      })
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  constructor(worker: BackgroundWorkerLike) {
    this.#worker = worker
    worker.addEventListener('message', this.#onMessage)
  }

  run(
    job: BackgroundRemovalJob,
    options: BackgroundWorkerRunOptions = {},
  ): Promise<BackgroundRemovalResult> {
    if (this.#disposed) {
      return Promise.reject(new Error('Background worker client is disposed.'))
    }
    if (options.signal?.aborted) {
      return Promise.reject(new DOMException('Aborted', 'AbortError'))
    }
    const id = this.#nextId
    this.#nextId += 1
    return new Promise((resolve, reject) => {
      const pending: Pending = { resolve, reject, options }
      if (options.signal) {
        pending.abort = () => {
          if (!this.#pending.delete(id)) return
          this.#worker.postMessage({ type: 'cancel', id })
          reject(new DOMException('Aborted', 'AbortError'))
        }
        options.signal.addEventListener('abort', pending.abort, {
          once: true,
        })
      }
      this.#pending.set(id, pending)
      const transferableJob: BackgroundRemovalJob = options.transferOwnership
        ? job
        : {
            ...job,
            image: {
              ...job.image,
              data: new Uint8ClampedArray(job.image.data),
            },
          }
      this.#worker.postMessage({ type: 'run', id, job: transferableJob }, [
        transferableJob.image.data.buffer,
      ])
    })
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#worker.removeEventListener('message', this.#onMessage)
    this.#worker.terminate?.()
    this.#pending.forEach((pending) => {
      if (pending.options.signal && pending.abort) {
        pending.options.signal.removeEventListener('abort', pending.abort)
      }
      pending.reject(new Error('Background worker client is disposed.'))
    })
    this.#pending.clear()
  }
}
