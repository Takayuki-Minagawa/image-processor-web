import type { ImageFilterSettings } from '../fabricEngine'
import type { FilterOperation, PixelBuffer } from './types'
import type {
  SelectionFilterProgressStage,
  SelectionFilterProgress,
} from './selectionFilter'

export interface SelectionFilterWorkerJob {
  image: PixelBuffer
  mask?: Uint8Array
  settings?: ImageFilterSettings
  operations?: FilterOperation[]
  outputMode?: 'composite' | 'selection-overlay'
}

export type SelectionFilterWorkerRequest =
  | { type: 'run'; id: number; job: SelectionFilterWorkerJob }
  | { type: 'cancel'; id: number }

export type SelectionFilterWorkerResponse =
  | ({
      type: 'progress'
      id: number
    } & SelectionFilterProgress)
  | {
      type: 'result'
      id: number
      ok: true
      image: PixelBuffer
    }
  | {
      type: 'result'
      id: number
      ok: false
      error: { name: string; message: string }
    }
  | {
      type: 'cancelled'
      id: number
    }

export const SELECTION_FILTER_PROGRESS_STAGES: ReadonlySet<SelectionFilterProgressStage> =
  new Set(['prepare', 'adjust', 'effects', 'blend'])
