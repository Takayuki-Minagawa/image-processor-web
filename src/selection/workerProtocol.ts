import type { PixelBuffer } from '../editor/filters/types'
import type { SelectionPoint } from './algorithms'
import type { SelectionCombineMode } from './operations'
import { SelectionMask } from './mask'

export interface SelectionMaskPayload {
  width: number
  height: number
  data: Uint8Array
}

export type PixelBufferPayload = PixelBuffer

export type SelectionWorkerJob =
  | {
      kind: 'polygon'
      width: number
      height: number
      points: SelectionPoint[]
      samplesPerAxis?: 1 | 2 | 4
    }
  | {
      kind: 'flood-fill'
      image: PixelBufferPayload
      seedX: number
      seedY: number
      tolerance?: number
      connectivity?: 4 | 8
      includeAlpha?: boolean
    }
  | {
      kind: 'combine'
      base: SelectionMaskPayload
      incoming: SelectionMaskPayload
      mode: SelectionCombineMode
    }
  | {
      kind: 'transform'
      mask: SelectionMaskPayload
      operation: 'invert' | 'dilate' | 'erode' | 'feather'
      radius?: number
    }

export type SelectionWorkerRequest =
  | { type: 'run'; id: number; job: SelectionWorkerJob }
  | { type: 'cancel'; id: number }

export type SelectionWorkerResponse =
  | {
      type: 'result'
      id: number
      ok: true
      mask: SelectionMaskPayload
    }
  | {
      type: 'result'
      id: number
      ok: false
      error: { name: string; message: string }
    }

export const maskToPayload = (mask: SelectionMask): SelectionMaskPayload => ({
  width: mask.width,
  height: mask.height,
  data: mask.toBytes(),
})

export const payloadToMask = (payload: SelectionMaskPayload): SelectionMask =>
  SelectionMask.fromBytes(payload.width, payload.height, payload.data)
