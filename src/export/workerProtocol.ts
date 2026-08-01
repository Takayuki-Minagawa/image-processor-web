import type { GifSlideshowInput } from './gif'
import type { RasterPdfGeometry, RasterPdfPage } from './pdf'

export interface PdfExportWorkerJob {
  kind: 'pdf'
  geometries: RasterPdfGeometry[]
  pages: RasterPdfPage[]
}

export interface GifExportWorkerJob {
  kind: 'gif'
  slideshow: GifSlideshowInput
}

export type MediaExportWorkerJob = PdfExportWorkerJob | GifExportWorkerJob

export type MediaExportWorkerRequest =
  | { type: 'run'; jobId: string; job: MediaExportWorkerJob }
  | { type: 'cancel'; jobId: string }

export type MediaExportProgressStage =
  'prepare' | 'pdf-pages' | 'gif-frames' | 'finalize'

export type MediaExportWorkerResponse =
  | {
      type: 'progress'
      jobId: string
      stage: MediaExportProgressStage
      progress: number
      completed: number
      total: number
    }
  | {
      type: 'result'
      jobId: string
      mimeType: 'application/pdf' | 'image/gif'
      data: Uint8Array
    }
  | { type: 'cancelled'; jobId: string }
  | {
      type: 'error'
      jobId: string
      code: 'EXPORT_FAILED'
      message: string
    }
