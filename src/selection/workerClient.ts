import {
  payloadToMask,
  type SelectionWorkerJob,
  type SelectionWorkerRequest,
  type SelectionWorkerResponse,
} from './workerProtocol'
import type { SelectionMask } from './mask'

export interface SelectionWorkerLike {
  postMessage(message: SelectionWorkerRequest, transfer?: Transferable[]): void
  addEventListener(
    type: 'message',
    listener: (event: { data: SelectionWorkerResponse }) => void,
  ): void
  removeEventListener(
    type: 'message',
    listener: (event: { data: SelectionWorkerResponse }) => void,
  ): void
  terminate?(): void
}

interface PendingRequest {
  resolve(mask: SelectionMask): void
  reject(error: Error): void
  signal?: AbortSignal
  abort?: () => void
}

const cloneWorkerJob = (job: SelectionWorkerJob): SelectionWorkerJob => {
  switch (job.kind) {
    case 'polygon':
      return {
        ...job,
        points: job.points.map((point) => ({ ...point })),
      }
    case 'flood-fill':
      return {
        ...job,
        image: {
          ...job.image,
          data: new Uint8ClampedArray(job.image.data),
        },
      }
    case 'combine':
      return {
        ...job,
        base: {
          ...job.base,
          data: new Uint8Array(job.base.data),
        },
        incoming: {
          ...job.incoming,
          data: new Uint8Array(job.incoming.data),
        },
      }
    case 'transform':
      return {
        ...job,
        mask: {
          ...job.mask,
          data: new Uint8Array(job.mask.data),
        },
      }
  }
}

export class SelectionWorkerClient {
  readonly #worker: SelectionWorkerLike
  readonly #pending = new Map<number, PendingRequest>()
  #nextId = 1
  #disposed = false

  readonly #onMessage = (event: { data: SelectionWorkerResponse }): void => {
    const response = event.data
    const pending = this.#pending.get(response.id)
    if (!pending) return
    this.#pending.delete(response.id)
    if (pending.signal && pending.abort) {
      pending.signal.removeEventListener('abort', pending.abort)
    }
    if (response.ok) {
      try {
        pending.resolve(payloadToMask(response.mask))
      } catch (error) {
        pending.reject(
          error instanceof Error ? error : new Error(String(error)),
        )
      }
    } else {
      const error = new Error(response.error.message)
      error.name = response.error.name
      pending.reject(error)
    }
  }

  constructor(worker: SelectionWorkerLike) {
    this.#worker = worker
    worker.addEventListener('message', this.#onMessage)
  }

  run(
    job: SelectionWorkerJob,
    signal?: AbortSignal,
    options: { transferOwnership?: boolean } = {},
  ): Promise<SelectionMask> {
    if (this.#disposed) {
      return Promise.reject(new Error('Selection worker client is disposed.'))
    }
    if (signal?.aborted) {
      return Promise.reject(new DOMException('Aborted', 'AbortError'))
    }
    const id = this.#nextId
    this.#nextId += 1
    return new Promise((resolve, reject) => {
      const pending: PendingRequest = { resolve, reject, signal }
      if (signal) {
        pending.abort = () => {
          if (!this.#pending.delete(id)) return
          this.#worker.postMessage({ type: 'cancel', id })
          reject(new DOMException('Aborted', 'AbortError'))
        }
        signal.addEventListener('abort', pending.abort, { once: true })
      }
      this.#pending.set(id, pending)
      const transferableJob = options.transferOwnership
        ? job
        : cloneWorkerJob(job)
      const transfer: Transferable[] = []
      if (transferableJob.kind === 'flood-fill') {
        transfer.push(transferableJob.image.data.buffer)
      } else if (transferableJob.kind === 'combine') {
        transfer.push(
          transferableJob.base.data.buffer,
          transferableJob.incoming.data.buffer,
        )
      } else if (transferableJob.kind === 'transform') {
        transfer.push(transferableJob.mask.data.buffer)
      }
      this.#worker.postMessage(
        { type: 'run', id, job: transferableJob },
        transfer,
      )
    })
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#worker.removeEventListener('message', this.#onMessage)
    this.#worker.terminate?.()
    this.#pending.forEach((pending) => {
      if (pending.signal && pending.abort) {
        pending.signal.removeEventListener('abort', pending.abort)
      }
      pending.reject(new Error('Selection worker client is disposed.'))
    })
    this.#pending.clear()
  }
}
