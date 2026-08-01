import { encodeGifSlideshow } from './gif'
import { buildRasterPdf } from './pdf'
import type {
  MediaExportProgressStage,
  MediaExportWorkerRequest,
  MediaExportWorkerResponse,
} from './workerProtocol'

export interface MediaExportWorkerDependencies {
  buildPdf?: typeof buildRasterPdf
  encodeGif?: typeof encodeGifSlideshow
}

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError'

/**
 * Worker-safe request handler. The caller owns `postMessage` and can transfer
 * the returned Uint8Array buffer after receiving a result.
 */
export const createMediaExportWorkerMessageHandler = (
  post: (response: MediaExportWorkerResponse) => void,
  dependencies: MediaExportWorkerDependencies = {},
): ((request: MediaExportWorkerRequest) => void) => {
  const active = new Map<string, AbortController>()
  const buildPdf = dependencies.buildPdf ?? buildRasterPdf
  const encodeGif = dependencies.encodeGif ?? encodeGifSlideshow

  return (request) => {
    if (request.type === 'cancel') {
      active.get(request.jobId)?.abort()
      return
    }

    active.get(request.jobId)?.abort()
    const controller = new AbortController()
    active.set(request.jobId, controller)
    const sendProgress = (
      stage: MediaExportProgressStage,
      progress: number,
      completed: number,
      total: number,
    ): void => {
      if (
        active.get(request.jobId) === controller &&
        !controller.signal.aborted
      ) {
        post({
          type: 'progress',
          jobId: request.jobId,
          stage,
          progress,
          completed,
          total,
        })
      }
    }

    const operation =
      request.job.kind === 'pdf'
        ? buildPdf(request.job.pages, request.job.geometries, {
            signal: controller.signal,
            onProgress: (update) =>
              sendProgress(
                update.phase === 'pages'
                  ? 'pdf-pages'
                  : update.phase === 'finalize'
                    ? 'finalize'
                    : 'prepare',
                update.progress,
                update.completedPages,
                update.totalPages,
              ),
          }).then((data) => ({
            data,
            mimeType: 'application/pdf' as const,
          }))
        : encodeGif(request.job.slideshow, {
            signal: controller.signal,
            onProgress: (update) =>
              sendProgress(
                update.phase === 'frames'
                  ? 'gif-frames'
                  : update.phase === 'finalize'
                    ? 'finalize'
                    : 'prepare',
                update.progress,
                update.completedFrames,
                update.totalFrames,
              ),
          }).then((data) => ({ data, mimeType: 'image/gif' as const }))

    void operation
      .then(({ data, mimeType }) => {
        if (active.get(request.jobId) !== controller) return
        active.delete(request.jobId)
        post({
          type: 'result',
          jobId: request.jobId,
          mimeType,
          data,
        })
      })
      .catch((error: unknown) => {
        if (active.get(request.jobId) !== controller) return
        active.delete(request.jobId)
        if (isAbortError(error) || controller.signal.aborted) {
          post({ type: 'cancelled', jobId: request.jobId })
          return
        }
        post({
          type: 'error',
          jobId: request.jobId,
          code: 'EXPORT_FAILED',
          message: error instanceof Error ? error.message : 'Export failed.',
        })
      })
  }
}
