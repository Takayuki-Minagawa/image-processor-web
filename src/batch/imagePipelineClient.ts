import type {
  CreateZipWorkerRequest,
  ImagePipelineWorkerRequest,
  ImagePipelineWorkerResponse,
  PipelineProgressResponse,
  ProcessImageWorkerRequest,
} from './imagePipelineProtocol'

export interface WorkerLike {
  postMessage(
    message: ImagePipelineWorkerRequest,
    transfer?: Transferable[],
  ): void
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<ImagePipelineWorkerResponse>) => void,
  ): void
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent<ImagePipelineWorkerResponse>) => void,
  ): void
  removeEventListener(
    type: 'error',
    listener: (event: ErrorEvent) => void,
  ): void
  terminate?: () => void
}

export interface PipelineClientProcessInput extends Omit<
  ProcessImageWorkerRequest,
  'type'
> {
  signal?: AbortSignal
  onProgress?: (progress: PipelineProgressResponse) => void
}

export interface PipelineClientZipInput extends Omit<
  CreateZipWorkerRequest,
  'type'
> {
  signal?: AbortSignal
  onProgress?: (progress: PipelineProgressResponse) => void
}

export interface PipelineClientProcessResult {
  data: ArrayBuffer
  mimeType: ProcessImageWorkerRequest['output']['mimeType']
  width: number
  height: number
}

interface PendingJob {
  expected: 'processResult' | 'zipResult'
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  onProgress?: (progress: PipelineProgressResponse) => void
  detachAbort?: () => void
}

export interface ImagePipelineClientPort {
  process(
    input: PipelineClientProcessInput,
  ): Promise<PipelineClientProcessResult>
  createZip(input: PipelineClientZipInput): Promise<ArrayBuffer>
  cancel(jobId: string): void
}

const abortError = (): DOMException =>
  new DOMException('The worker job was cancelled.', 'AbortError')

export class ImagePipelineClient implements ImagePipelineClientPort {
  readonly #worker: WorkerLike
  readonly #pending = new Map<string, PendingJob>()
  #disposed = false

  constructor(worker?: WorkerLike) {
    this.#worker =
      worker ??
      (new Worker(new URL('./imagePipeline.worker.ts', import.meta.url), {
        type: 'module',
        name: 'pixelweave-image-pipeline',
      }) as WorkerLike)
    this.#worker.addEventListener('message', this.#onMessage)
    this.#worker.addEventListener('error', this.#onError)
  }

  process(
    input: PipelineClientProcessInput,
  ): Promise<PipelineClientProcessResult> {
    const { signal, onProgress, ...request } = input
    return this.#request<PipelineClientProcessResult>(
      { type: 'process', ...request },
      'processResult',
      [request.input],
      signal,
      onProgress,
    )
  }

  createZip(input: PipelineClientZipInput): Promise<ArrayBuffer> {
    const { signal, onProgress, ...request } = input
    const transfers = request.entries.map(({ data }) => data)
    return this.#request<ArrayBuffer>(
      { type: 'zip', ...request },
      'zipResult',
      transfers,
      signal,
      onProgress,
    )
  }

  cancel(jobId: string): void {
    if (!this.#disposed) {
      this.#worker.postMessage({ type: 'cancel', jobId })
    }
  }

  dispose(): void {
    if (this.#disposed) {
      return
    }
    this.#disposed = true
    this.#worker.removeEventListener('message', this.#onMessage)
    this.#worker.removeEventListener('error', this.#onError)
    this.#worker.terminate?.()
    this.#rejectAll(new Error('The image pipeline worker was disposed.'))
  }

  #request<T>(
    request: ProcessImageWorkerRequest | CreateZipWorkerRequest,
    expected: PendingJob['expected'],
    transfer: Transferable[],
    signal?: AbortSignal,
    onProgress?: (progress: PipelineProgressResponse) => void,
  ): Promise<T> {
    if (this.#disposed) {
      return Promise.reject(
        new Error('The image pipeline worker has been disposed.'),
      )
    }
    if (this.#pending.has(request.jobId)) {
      return Promise.reject(
        new Error(`Duplicate worker job "${request.jobId}".`),
      )
    }
    if (signal?.aborted) {
      return Promise.reject(abortError())
    }
    return new Promise<T>((resolve, reject) => {
      const pending: PendingJob = {
        expected,
        resolve: (value) => resolve(value as T),
        reject,
        onProgress,
      }
      if (signal) {
        const onAbort = (): void => {
          this.cancel(request.jobId)
          this.#settle(request.jobId, 'reject', abortError())
        }
        signal.addEventListener('abort', onAbort, { once: true })
        pending.detachAbort = () => signal.removeEventListener('abort', onAbort)
      }
      this.#pending.set(request.jobId, pending)
      try {
        this.#worker.postMessage(request, transfer)
      } catch (error) {
        this.#settle(request.jobId, 'reject', error)
      }
    })
  }

  readonly #onMessage = (
    event: MessageEvent<ImagePipelineWorkerResponse>,
  ): void => {
    const response = event.data
    const pending = this.#pending.get(response.jobId)
    if (!pending) {
      return
    }
    if (response.type === 'progress') {
      pending.onProgress?.(response)
      return
    }
    if (response.type === 'cancelled') {
      this.#settle(response.jobId, 'reject', abortError())
      return
    }
    if (response.type === 'error') {
      this.#settle(
        response.jobId,
        'reject',
        Object.assign(new Error(response.message), { code: response.code }),
      )
      return
    }
    if (response.type !== pending.expected) {
      this.#settle(
        response.jobId,
        'reject',
        new Error(
          `Worker returned ${response.type}; expected ${pending.expected}.`,
        ),
      )
      return
    }
    if (response.type === 'processResult') {
      this.#settle(response.jobId, 'resolve', {
        data: response.data,
        mimeType: response.mimeType,
        width: response.width,
        height: response.height,
      })
    } else {
      this.#settle(response.jobId, 'resolve', response.data)
    }
  }

  readonly #onError = (event: ErrorEvent): void => {
    this.#rejectAll(event.error ?? new Error(event.message || 'Worker failed.'))
  }

  #settle(jobId: string, action: 'resolve' | 'reject', value: unknown): void {
    const pending = this.#pending.get(jobId)
    if (!pending) {
      return
    }
    this.#pending.delete(jobId)
    pending.detachAbort?.()
    pending[action](value)
  }

  #rejectAll(error: unknown): void {
    for (const jobId of [...this.#pending.keys()]) {
      this.#settle(jobId, 'reject', error)
    }
  }
}
