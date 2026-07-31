import {
  type ResolvedAutomationCommand,
  assertBatchSafeCommands,
} from '../automation/commands'
import { MAX_IMAGE_BYTES } from '../lib/imageSafety'
import type {
  PipelineImageMimeType,
  PipelineOutputOptions,
  PipelineProgressResponse,
} from './imagePipelineProtocol'
import {
  type ImagePipelineClientPort,
  type PipelineClientProcessResult,
} from './imagePipelineClient'
import { stripControlCharacters } from './safety'

export const MAX_BATCH_ITEMS = 500
export const MAX_BATCH_CONCURRENCY = 4

export interface BatchSource {
  name: string
  type: PipelineImageMimeType
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface BatchItem {
  id: string
  source: BatchSource
}

export interface BatchOutput extends PipelineClientProcessResult {
  id: string
  sourceName: string
  outputName: string
}

export interface BatchFailure {
  id: string
  sourceName: string
  error: unknown
}

export interface BatchRunResult {
  status: 'completed' | 'cancelled'
  completed: BatchOutput[]
  failed: BatchFailure[]
}

export interface BatchProgress {
  completed: number
  failed: number
  total: number
  active: number
  current?: PipelineProgressResponse
}

export interface BatchRunOptions {
  commands: ResolvedAutomationCommand[]
  output: PipelineOutputOptions
  concurrency?: number
  signal?: AbortSignal
  onProgress?: (progress: BatchProgress) => void
}

const supportedMimeTypes = new Set<PipelineImageMimeType>([
  'image/png',
  'image/jpeg',
  'image/webp',
])

const extension = (mimeType: PipelineImageMimeType): string =>
  mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1]

const outputName = (
  sourceName: string,
  mimeType: PipelineImageMimeType,
): string => {
  const stem =
    stripControlCharacters(sourceName.normalize('NFKC'))
      .replace(/\.[^.]+$/, '')
      .replace(/[<>:"/\\|?*]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 80) || 'untitled'
  return `${stem}.${extension(mimeType)}`
}

const uniqueOutputNames = (
  items: readonly BatchItem[],
  mimeType: PipelineImageMimeType,
): string[] => {
  const reserved = new Set<string>()
  return items.map(({ source }) => {
    const base = outputName(source.name, mimeType)
    const dot = base.lastIndexOf('.')
    const stem = dot < 0 ? base : base.slice(0, dot)
    const suffix = dot < 0 ? '' : base.slice(dot)
    let candidate = base
    let copy = 2
    while (reserved.has(candidate.toLowerCase())) {
      candidate = `${stem}-${copy}${suffix}`
      copy += 1
    }
    reserved.add(candidate.toLowerCase())
    return candidate
  })
}

const sourceError = (source: BatchSource): Error | null => {
  if (!supportedMimeTypes.has(source.type)) {
    return new TypeError(`Unsupported image type "${source.type}".`)
  }
  if (source.size <= 0 || source.size > MAX_IMAGE_BYTES) {
    return new RangeError('Input images must be between 1 byte and 50 MB.')
  }
  return null
}

export class BatchController {
  readonly #client: ImagePipelineClientPort
  #active:
    | {
        controller: AbortController
        jobIds: Set<string>
      }
    | undefined
  #generation = 0

  constructor(client: ImagePipelineClientPort) {
    this.#client = client
  }

  get isRunning(): boolean {
    return this.#active !== undefined
  }

  cancel(): boolean {
    const active = this.#active
    if (!active) {
      return false
    }
    active.controller.abort()
    active.jobIds.forEach((jobId) => this.#client.cancel(jobId))
    return true
  }

  async run(
    items: readonly BatchItem[],
    options: BatchRunOptions,
  ): Promise<BatchRunResult> {
    if (this.#active) {
      throw new Error('A batch is already running.')
    }
    if (items.length === 0 || items.length > MAX_BATCH_ITEMS) {
      throw new RangeError(`A batch requires 1 to ${MAX_BATCH_ITEMS} files.`)
    }
    const ids = new Set<string>()
    for (const item of items) {
      if (!/^[a-z0-9][a-z0-9_.-]{0,127}$/i.test(item.id) || ids.has(item.id)) {
        throw new TypeError(
          'Batch item ids must be safe, non-empty, and unique.',
        )
      }
      ids.add(item.id)
    }
    if (!supportedMimeTypes.has(options.output.mimeType)) {
      throw new TypeError('The requested output image type is unsupported.')
    }
    if (
      options.output.quality !== undefined &&
      (!Number.isFinite(options.output.quality) ||
        options.output.quality <= 0 ||
        options.output.quality > 1)
    ) {
      throw new RangeError(
        'Output quality must be greater than 0 and at most 1.',
      )
    }
    assertBatchSafeCommands(options.commands)
    const names = uniqueOutputNames(items, options.output.mimeType)
    const itemOrder = new Map(items.map(({ id }, index) => [id, index]))
    const requestedConcurrency = options.concurrency ?? 1
    if (!Number.isFinite(requestedConcurrency) || requestedConcurrency < 1) {
      throw new RangeError('Batch concurrency must be a positive number.')
    }
    const concurrency = Math.min(
      MAX_BATCH_CONCURRENCY,
      Math.max(1, Math.floor(requestedConcurrency)),
    )
    const controller = new AbortController()
    const active = { controller, jobIds: new Set<string>() }
    this.#active = active
    this.#generation += 1
    const generation = this.#generation
    const onExternalAbort = (): void => {
      this.cancel()
    }
    options.signal?.addEventListener('abort', onExternalAbort, { once: true })
    if (options.signal?.aborted) {
      this.cancel()
    }

    const completed: BatchOutput[] = []
    const failed: BatchFailure[] = []
    let cursor = 0
    let activeCount = 0
    const report = (current?: PipelineProgressResponse): void =>
      options.onProgress?.({
        completed: completed.length,
        failed: failed.length,
        total: items.length,
        active: activeCount,
        ...(current ? { current } : {}),
      })

    const worker = async (): Promise<void> => {
      while (!controller.signal.aborted) {
        const index = cursor
        cursor += 1
        if (index >= items.length) {
          return
        }
        const item = items[index]
        const validationError = sourceError(item.source)
        if (validationError) {
          failed.push({
            id: item.id,
            sourceName: item.source.name,
            error: validationError,
          })
          report()
          continue
        }
        const jobId = `batch-${generation}-${index}-${item.id}`
        active.jobIds.add(jobId)
        activeCount += 1
        report()
        try {
          const input = await item.source.arrayBuffer()
          if (controller.signal.aborted) {
            break
          }
          if (
            input.byteLength <= 0 ||
            input.byteLength > MAX_IMAGE_BYTES ||
            input.byteLength !== item.source.size
          ) {
            throw new RangeError(
              'The image size changed or exceeded the 50 MB limit while reading.',
            )
          }
          const result = await this.#client.process({
            jobId,
            sourceName: item.source.name,
            inputMimeType: item.source.type,
            input,
            commands: options.commands,
            output: options.output,
            signal: controller.signal,
            onProgress: (progress) => report(progress),
          })
          completed.push({
            ...result,
            id: item.id,
            sourceName: item.source.name,
            outputName: names[index],
          })
        } catch (error) {
          if (
            !controller.signal.aborted &&
            !(error instanceof DOMException && error.name === 'AbortError')
          ) {
            failed.push({
              id: item.id,
              sourceName: item.source.name,
              error,
            })
          }
        } finally {
          active.jobIds.delete(jobId)
          activeCount -= 1
          report()
        }
      }
    }

    try {
      await Promise.all(
        Array.from({ length: Math.min(concurrency, items.length) }, worker),
      )
      return {
        status: controller.signal.aborted ? 'cancelled' : 'completed',
        completed: completed.sort(
          (left, right) =>
            (itemOrder.get(left.id) ?? 0) - (itemOrder.get(right.id) ?? 0),
        ),
        failed: failed.sort(
          (left, right) =>
            (itemOrder.get(left.id) ?? 0) - (itemOrder.get(right.id) ?? 0),
        ),
      }
    } finally {
      options.signal?.removeEventListener('abort', onExternalAbort)
      if (this.#active === active) {
        this.#active = undefined
      }
    }
  }
}
