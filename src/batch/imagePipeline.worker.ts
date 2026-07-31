import { processImageBuffer } from './imagePipeline'
import type {
  ImagePipelineWorkerRequest,
  ImagePipelineWorkerResponse,
} from './imagePipelineProtocol'
import { createStoredZipAsync } from './zip'

interface WorkerMessageEvent {
  data: ImagePipelineWorkerRequest
}

export interface ImagePipelineWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: WorkerMessageEvent) => void,
  ): void
  postMessage(
    message: ImagePipelineWorkerResponse,
    transfer?: Transferable[],
  ): void
}

const errorDetails = (error: unknown): { code: string; message: string } => {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { code: 'cancelled', message: error.message }
  }
  if (error instanceof Error) {
    return { code: error.name || 'processing-error', message: error.message }
  }
  return { code: 'processing-error', message: 'Image processing failed.' }
}

export const installImagePipelineWorker = (
  scope: ImagePipelineWorkerScope,
): void => {
  const cancelledJobs = new Set<string>()
  const activeJobs = new Set<string>()
  scope.addEventListener('message', (event) => {
    const request = event.data
    if (request.type === 'cancel') {
      if (activeJobs.has(request.jobId)) {
        cancelledJobs.add(request.jobId)
      }
      return
    }
    if (activeJobs.has(request.jobId)) {
      scope.postMessage({
        type: 'error',
        jobId: request.jobId,
        code: 'duplicate-job',
        message: `Worker job "${request.jobId}" is already active.`,
      })
      return
    }
    activeJobs.add(request.jobId)

    void (async () => {
      try {
        if (request.type === 'process') {
          const result = await processImageBuffer(
            {
              input: request.input,
              inputMimeType: request.inputMimeType,
              commands: request.commands,
              output: request.output,
            },
            {
              isCancelled: () => cancelledJobs.has(request.jobId),
              onProgress: ({ phase, progress }) => {
                scope.postMessage({
                  type: 'progress',
                  jobId: request.jobId,
                  phase,
                  progress,
                })
              },
            },
          )
          scope.postMessage(
            {
              type: 'processResult',
              jobId: request.jobId,
              ...result,
            },
            [result.data],
          )
        } else {
          if (cancelledJobs.has(request.jobId)) {
            throw new DOMException('ZIP creation was cancelled.', 'AbortError')
          }
          scope.postMessage({
            type: 'progress',
            jobId: request.jobId,
            phase: 'zip',
            progress: 0,
          })
          const data = await createStoredZipAsync(request.entries, {
            isCancelled: () => cancelledJobs.has(request.jobId),
            onProgress: (progress) => {
              scope.postMessage({
                type: 'progress',
                jobId: request.jobId,
                phase: 'zip',
                progress,
              })
            },
          })
          scope.postMessage({ type: 'zipResult', jobId: request.jobId, data }, [
            data,
          ])
        }
      } catch (error) {
        const details = errorDetails(error)
        if (details.code === 'cancelled') {
          scope.postMessage({ type: 'cancelled', jobId: request.jobId })
        } else {
          scope.postMessage({
            type: 'error',
            jobId: request.jobId,
            ...details,
          })
        }
      } finally {
        cancelledJobs.delete(request.jobId)
        activeJobs.delete(request.jobId)
      }
    })()
  })
}

const possibleWorkerScope =
  globalThis as unknown as Partial<ImagePipelineWorkerScope>
if (
  typeof document === 'undefined' &&
  typeof possibleWorkerScope.addEventListener === 'function' &&
  typeof possibleWorkerScope.postMessage === 'function'
) {
  installImagePipelineWorker(possibleWorkerScope as ImagePipelineWorkerScope)
}
