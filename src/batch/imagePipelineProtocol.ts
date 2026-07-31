import type { ResolvedAutomationCommand } from '../automation/commands'
import type { StoredZipEntry } from './zip'

export type PipelineImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp'

export type PipelineProgressPhase = 'decode' | 'commands' | 'encode' | 'zip'

export interface PipelineOutputOptions {
  mimeType: PipelineImageMimeType
  quality?: number
}

export interface ProcessImageWorkerRequest {
  type: 'process'
  jobId: string
  sourceName: string
  inputMimeType: PipelineImageMimeType
  input: ArrayBuffer
  commands: ResolvedAutomationCommand[]
  output: PipelineOutputOptions
}

export interface CreateZipWorkerRequest {
  type: 'zip'
  jobId: string
  entries: StoredZipEntry[]
}

export interface CancelWorkerRequest {
  type: 'cancel'
  jobId: string
}

export type ImagePipelineWorkerRequest =
  ProcessImageWorkerRequest | CreateZipWorkerRequest | CancelWorkerRequest

export interface PipelineProgressResponse {
  type: 'progress'
  jobId: string
  phase: PipelineProgressPhase
  progress: number
}

export interface ProcessImageWorkerResult {
  type: 'processResult'
  jobId: string
  data: ArrayBuffer
  mimeType: PipelineImageMimeType
  width: number
  height: number
}

export interface CreateZipWorkerResult {
  type: 'zipResult'
  jobId: string
  data: ArrayBuffer
}

export interface PipelineCancelledResponse {
  type: 'cancelled'
  jobId: string
}

export interface PipelineErrorResponse {
  type: 'error'
  jobId: string
  code: string
  message: string
}

export type ImagePipelineWorkerResponse =
  | PipelineProgressResponse
  | ProcessImageWorkerResult
  | CreateZipWorkerResult
  | PipelineCancelledResponse
  | PipelineErrorResponse

export const imageFormatExtension = (
  mimeType: PipelineImageMimeType,
): 'png' | 'jpg' | 'webp' => {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/webp':
      return 'webp'
    case 'image/png':
      return 'png'
  }
}
