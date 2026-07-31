import type { PixelBuffer } from '../editor/filters/types'
import type {
  BackgroundRemovalOptions,
  BackgroundRemovalSource,
} from './segmentation'
import type { BackgroundModelDescriptor } from './modelCache'
import type { OnnxSegmentationAdapterOptions } from './onnxSegmentation'

export interface BackgroundWorkerModelRequest {
  descriptor: BackgroundModelDescriptor
  onnx?: Omit<
    OnnxSegmentationAdapterOptions,
    'id' | 'modelBytes' | 'loadSessionFactory'
  >
  consentGranted: boolean
}

export interface BackgroundRemovalJob {
  image: PixelBuffer
  options?: BackgroundRemovalOptions
  model?: BackgroundWorkerModelRequest
}

export type BackgroundWorkerRequest =
  | { type: 'run'; id: number; job: BackgroundRemovalJob }
  | { type: 'cancel'; id: number }

export type BackgroundWorkerResponse =
  | {
      type: 'progress'
      id: number
      progress: number
      stage: 'prepare' | 'infer' | 'compose'
    }
  | {
      type: 'result'
      id: number
      ok: true
      result: {
        width: number
        height: number
        mask: Uint8Array
        rgba: Uint8ClampedArray
        source: BackgroundRemovalSource
        warning?: string
      }
    }
  | {
      type: 'result'
      id: number
      ok: false
      error: { name: string; message: string }
    }
