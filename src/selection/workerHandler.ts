import { floodFillSelection, rasterizePolygonSelection } from './algorithms'
import {
  combineSelectionMasks,
  dilateSelectionMask,
  erodeSelectionMask,
  featherSelectionMask,
  invertSelectionMask,
} from './operations'
import {
  maskToPayload,
  payloadToMask,
  type SelectionWorkerJob,
  type SelectionWorkerRequest,
  type SelectionWorkerResponse,
} from './workerProtocol'

export const executeSelectionWorkerJob = (job: SelectionWorkerJob) => {
  switch (job.kind) {
    case 'polygon':
      return rasterizePolygonSelection(job.width, job.height, job.points, {
        samplesPerAxis: job.samplesPerAxis,
      })
    case 'flood-fill':
      return floodFillSelection(job.image, job.seedX, job.seedY, {
        tolerance: job.tolerance,
        connectivity: job.connectivity,
        includeAlpha: job.includeAlpha,
      })
    case 'combine':
      return combineSelectionMasks(
        payloadToMask(job.base),
        payloadToMask(job.incoming),
        job.mode,
      )
    case 'transform': {
      const mask = payloadToMask(job.mask)
      switch (job.operation) {
        case 'invert':
          return invertSelectionMask(mask)
        case 'dilate':
          return dilateSelectionMask(mask, job.radius ?? 1)
        case 'erode':
          return erodeSelectionMask(mask, job.radius ?? 1)
        case 'feather':
          return featherSelectionMask(mask, job.radius ?? 1)
      }
    }
  }
}

export const createSelectionWorkerMessageHandler = (
  post: (response: SelectionWorkerResponse) => void,
): ((request: SelectionWorkerRequest) => void) => {
  const cancelled = new Set<number>()
  return (request) => {
    if (request.type === 'cancel') {
      cancelled.add(request.id)
      return
    }
    try {
      const mask = executeSelectionWorkerJob(request.job)
      if (!cancelled.delete(request.id)) {
        post({
          type: 'result',
          id: request.id,
          ok: true,
          mask: maskToPayload(mask),
        })
      }
    } catch (error) {
      if (!cancelled.delete(request.id)) {
        post({
          type: 'result',
          id: request.id,
          ok: false,
          error: {
            name: error instanceof Error ? error.name : 'Error',
            message:
              error instanceof Error
                ? error.message
                : 'Selection worker operation failed.',
          },
        })
      }
    }
  }
}
