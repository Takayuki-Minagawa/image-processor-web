import {
  removeBackground,
  type BackgroundSegmentationAdapter,
  type SegmentationContext,
} from './segmentation'
import type {
  BackgroundRemovalJob,
  BackgroundWorkerRequest,
  BackgroundWorkerResponse,
} from './workerProtocol'

export type BackgroundWorkerAdapterResolver = (
  job: BackgroundRemovalJob,
  context: SegmentationContext,
) =>
  | BackgroundSegmentationAdapter
  | undefined
  | Promise<BackgroundSegmentationAdapter | undefined>

export const createBackgroundWorkerMessageHandler = (
  post: (response: BackgroundWorkerResponse) => void,
  adapter?: BackgroundSegmentationAdapter,
  resolveAdapter?: BackgroundWorkerAdapterResolver,
): ((request: BackgroundWorkerRequest) => void) => {
  const active = new Map<number, AbortController>()
  return (request) => {
    if (request.type === 'cancel') {
      active.get(request.id)?.abort()
      active.delete(request.id)
      return
    }
    const controller = new AbortController()
    active.set(request.id, controller)
    const context: SegmentationContext = {
      signal: controller.signal,
      reportProgress: (progress, stage) => {
        if (active.get(request.id) === controller) {
          post({
            type: 'progress',
            id: request.id,
            progress,
            stage,
          })
        }
      },
    }
    void Promise.resolve(
      resolveAdapter ? resolveAdapter(request.job, context) : adapter,
    )
      .then((resolvedAdapter) =>
        removeBackground(
          request.job.image,
          request.job.options,
          context,
          resolvedAdapter,
        ),
      )
      .then((result) => {
        if (active.get(request.id) !== controller) return
        active.delete(request.id)
        post({
          type: 'result',
          id: request.id,
          ok: true,
          result: {
            width: result.width,
            height: result.height,
            mask: result.mask.toBytes(),
            rgba: result.rgba,
            source: result.source,
            ...(result.warning === undefined
              ? {}
              : { warning: result.warning }),
          },
        })
      })
      .catch((error: unknown) => {
        if (active.get(request.id) !== controller) return
        active.delete(request.id)
        post({
          type: 'result',
          id: request.id,
          ok: false,
          error: {
            name: error instanceof Error ? error.name : 'Error',
            message:
              error instanceof Error
                ? error.message
                : 'Background removal failed.',
          },
        })
      })
  }
}
