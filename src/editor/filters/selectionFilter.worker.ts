import {
  applySelectionFilterCpu,
  applySelectionFilterOperationsCpu,
  assertSelectionFilterImage,
} from './selectionFilter'
import { applyFilterChainCpu } from './cpu'
import { tryApplyFilterChainWebGl } from './webgl'
import type {
  SelectionFilterWorkerRequest,
  SelectionFilterWorkerResponse,
} from './selectionFilterProtocol'

export interface SelectionFilterWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: { data: SelectionFilterWorkerRequest }) => void,
  ): void
  postMessage(
    message: SelectionFilterWorkerResponse,
    transfer?: Transferable[],
  ): void
}

type WorkerPost = (
  response: SelectionFilterWorkerResponse,
  transfer?: Transferable[],
) => void

type WorkerSchedule = (operation: () => void) => void

const defaultSchedule: WorkerSchedule = (operation) => {
  setTimeout(operation, 0)
}

const errorResponse = (
  id: number,
  error: unknown,
): SelectionFilterWorkerResponse => ({
  type: 'result',
  id,
  ok: false,
  error: {
    name: error instanceof Error ? error.name : 'Error',
    message:
      error instanceof Error ? error.message : 'Selection filtering failed.',
  },
})

/**
 * Creates the protocol handler separately from installation so validation,
 * cancellation, and Transferable behavior can be tested without a real Worker.
 */
export const createSelectionFilterWorkerMessageHandler = (
  post: WorkerPost,
  schedule: WorkerSchedule = defaultSchedule,
): ((request: SelectionFilterWorkerRequest) => void) => {
  const active = new Map<number, AbortController>()

  return (request) => {
    if (!Number.isSafeInteger(request.id) || request.id <= 0) {
      post(
        errorResponse(
          request.id,
          new RangeError('Selection filter job id must be a positive integer.'),
        ),
      )
      return
    }

    if (request.type === 'cancel') {
      const controller = active.get(request.id)
      if (!controller) return
      active.delete(request.id)
      controller.abort()
      post({ type: 'cancelled', id: request.id })
      return
    }

    if (active.has(request.id)) {
      post(
        errorResponse(
          request.id,
          new Error(`Selection filter job "${request.id}" is already active.`),
        ),
      )
      return
    }

    const controller = new AbortController()
    active.set(request.id, controller)
    schedule(() => {
      if (active.get(request.id) !== controller) return
      try {
        if (
          request.job.outputMode !== undefined &&
          request.job.outputMode !== 'composite' &&
          request.job.outputMode !== 'selection-overlay'
        ) {
          throw new TypeError('Selection filter output mode is invalid.')
        }
        const runtime = {
          signal: controller.signal,
          onProgress: ({
            progress,
            stage,
          }: {
            progress: number
            stage: 'prepare' | 'adjust' | 'effects' | 'blend'
          }) => {
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
        const hasSettings = request.job.settings !== undefined
        const hasOperations = request.job.operations !== undefined
        if (hasSettings === hasOperations) {
          throw new TypeError(
            'Selection filter jobs require exactly one filter input.',
          )
        }
        if (hasSettings && !request.job.mask) {
          throw new TypeError(
            'Selection filter settings require a selection mask.',
          )
        }
        if (
          request.job.outputMode === 'selection-overlay' &&
          !request.job.mask
        ) {
          throw new TypeError(
            'Selection overlay output requires a selection mask.',
          )
        }

        let image
        if (request.job.operations) {
          if (
            request.job.operations.length === 0 ||
            request.job.operations.length > 64
          ) {
            throw new RangeError(
              'Advanced filtering requires from 1 to 64 operations.',
            )
          }
          if (request.job.mask) {
            image = applySelectionFilterOperationsCpu(
              request.job.image,
              request.job.mask,
              request.job.operations,
              runtime,
            )
          } else {
            assertSelectionFilterImage(request.job.image)
            runtime.onProgress({ progress: 0, stage: 'prepare' })
            image =
              tryApplyFilterChainWebGl(
                request.job.image,
                request.job.operations,
              ) ??
              applyFilterChainCpu(request.job.image, request.job.operations)
            runtime.onProgress({ progress: 1, stage: 'effects' })
          }
        } else {
          image = applySelectionFilterCpu(
            request.job.image,
            request.job.mask!,
            request.job.settings!,
            runtime,
          )
        }
        if (request.job.outputMode === 'selection-overlay') {
          const mask = request.job.mask!
          for (let pixel = 0; pixel < mask.length; pixel += 1) {
            if (pixel % 65_536 === 0 && controller.signal.aborted) {
              throw new DOMException(
                'Selection filtering was cancelled.',
                'AbortError',
              )
            }
            if (mask[pixel] === 0) {
              image.data[pixel * 4 + 3] = 0
            }
          }
        }
        if (active.get(request.id) !== controller) return
        active.delete(request.id)
        post(
          {
            type: 'result',
            id: request.id,
            ok: true,
            image,
          },
          [image.data.buffer as ArrayBuffer],
        )
      } catch (error) {
        if (active.get(request.id) !== controller) return
        active.delete(request.id)
        if (error instanceof DOMException && error.name === 'AbortError') {
          post({ type: 'cancelled', id: request.id })
        } else {
          post(errorResponse(request.id, error))
        }
      }
    })
  }
}

export const installSelectionFilterWorker = (
  scope: SelectionFilterWorkerScope,
): void => {
  const handleMessage = createSelectionFilterWorkerMessageHandler(
    (response, transfer) => scope.postMessage(response, transfer),
  )
  scope.addEventListener('message', (event) => {
    handleMessage(event.data)
  })
}

const possibleWorkerScope =
  globalThis as unknown as Partial<SelectionFilterWorkerScope>
if (
  typeof document === 'undefined' &&
  typeof possibleWorkerScope.addEventListener === 'function' &&
  typeof possibleWorkerScope.postMessage === 'function'
) {
  installSelectionFilterWorker(
    possibleWorkerScope as SelectionFilterWorkerScope,
  )
}
