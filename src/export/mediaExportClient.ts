import type {
  MediaExportWorkerJob,
  MediaExportWorkerRequest,
  MediaExportWorkerResponse,
} from './workerProtocol'

export interface MediaExportWorkerLike {
  postMessage(message: MediaExportWorkerRequest): void
  addEventListener(
    type: 'message' | 'error',
    listener: EventListenerOrEventListenerObject,
  ): void
  terminate(): void
}

export interface RunMediaExportOptions {
  signal?: AbortSignal
  onProgress?: (
    response: Extract<MediaExportWorkerResponse, { type: 'progress' }>,
  ) => void
  createWorker?: () => MediaExportWorkerLike
}

const createBrowserWorker = (): MediaExportWorkerLike =>
  new Worker(new URL('./mediaExport.worker.ts', import.meta.url), {
    type: 'module',
  })

export const runMediaExportJob = (
  job: MediaExportWorkerJob,
  options: RunMediaExportOptions = {},
): Promise<{ data: Uint8Array; mimeType: 'application/pdf' | 'image/gif' }> => {
  const worker = (options.createWorker ?? createBrowserWorker)()
  const jobId = `media-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', onAbort)
      worker.terminate()
      action()
    }
    const onAbort = () => {
      worker.postMessage({ type: 'cancel', jobId })
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    worker.addEventListener('message', ((
      event: MessageEvent<MediaExportWorkerResponse>,
    ) => {
      const response = event.data
      if (response.jobId !== jobId) return
      if (response.type === 'progress') {
        options.onProgress?.(response)
      } else if (response.type === 'result') {
        finish(() =>
          resolve({ data: response.data, mimeType: response.mimeType }),
        )
      } else if (response.type === 'cancelled') {
        finish(() =>
          reject(new DOMException('Export cancelled.', 'AbortError')),
        )
      } else {
        finish(() => reject(new Error(response.message)))
      }
    }) as EventListener)
    worker.addEventListener('error', ((event: ErrorEvent) => {
      finish(() => reject(event.error ?? new Error(event.message)))
    }) as EventListener)
    if (options.signal?.aborted) {
      finish(() => reject(new DOMException('Export cancelled.', 'AbortError')))
      return
    }
    worker.postMessage({ type: 'run', jobId, job })
  })
}
