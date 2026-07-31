import type { ImageFilterSettings } from '../fabricEngine'
import {
  assertSelectionFilterImage,
  normalizeSelectionFilterSettings,
  selectionFilterMaskToBytes,
  type SelectionFilterMask,
  type SelectionFilterProgress,
} from './selectionFilter'
import {
  SELECTION_FILTER_PROGRESS_STAGES,
  type SelectionFilterWorkerRequest,
  type SelectionFilterWorkerResponse,
} from './selectionFilterProtocol'
import { validateFilterOperation } from './registry'
import type { FilterOperation, PixelBuffer } from './types'

export interface SelectionFilterWorkerLike {
  postMessage(
    message: SelectionFilterWorkerRequest,
    transfer?: Transferable[],
  ): void
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<SelectionFilterWorkerResponse>) => void,
  ): void
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent<SelectionFilterWorkerResponse>) => void,
  ): void
  removeEventListener(
    type: 'error',
    listener: (event: ErrorEvent) => void,
  ): void
  terminate?: () => void
}

interface SelectionFilterClientInputBase {
  image: PixelBuffer
  mask?: SelectionFilterMask
  outputMode?: 'composite' | 'selection-overlay'
}

export type SelectionFilterClientInput = SelectionFilterClientInputBase &
  (
    | {
        mask: SelectionFilterMask
        settings: ImageFilterSettings
        operations?: never
      }
    | {
        operations: readonly FilterOperation[]
        settings?: never
      }
  )

export interface SelectionFilterClientRunOptions {
  signal?: AbortSignal
  onProgress?: (progress: SelectionFilterProgress) => void
  transferOwnership?: boolean
}

export interface SelectionFilterTask {
  id: number
  result: Promise<PixelBuffer>
  cancel: () => void
}

interface PendingSelectionFilterJob {
  width: number
  height: number
  resolve: (image: PixelBuffer) => void
  reject: (error: unknown) => void
  onProgress?: (progress: SelectionFilterProgress) => void
  detachAbort?: () => void
}

const abortError = (): DOMException =>
  new DOMException('Selection filtering was cancelled.', 'AbortError')

const protocolError = (message: string): Error =>
  new Error(`Invalid selection filter worker response: ${message}`)

export class SelectionFilterClient {
  readonly #worker: SelectionFilterWorkerLike
  readonly #pending = new Map<number, PendingSelectionFilterJob>()
  #nextId = 1
  #disposed = false

  constructor(worker?: SelectionFilterWorkerLike) {
    this.#worker =
      worker ??
      (new Worker(new URL('./selectionFilter.worker.ts', import.meta.url), {
        type: 'module',
        name: 'pixelweave-selection-filter',
      }) as SelectionFilterWorkerLike)
    this.#worker.addEventListener('message', this.#onMessage)
    this.#worker.addEventListener('error', this.#onError)
  }

  run(
    input: SelectionFilterClientInput,
    options: SelectionFilterClientRunOptions = {},
  ): Promise<PixelBuffer> {
    return this.start(input, options).result
  }

  start(
    input: SelectionFilterClientInput,
    options: SelectionFilterClientRunOptions = {},
  ): SelectionFilterTask {
    const id = this.#nextId
    this.#nextId += 1
    return {
      id,
      result: this.#request(id, input, options),
      cancel: () => this.cancel(id),
    }
  }

  cancel(id?: number): void {
    const ids = id === undefined ? [...this.#pending.keys()] : [id]
    ids.forEach((candidate) => {
      if (!this.#pending.has(candidate)) return
      try {
        this.#worker.postMessage({ type: 'cancel', id: candidate })
      } catch {
        // Local cancellation still settles promptly if the worker is gone.
      } finally {
        this.#settle(candidate, 'reject', abortError())
      }
    })
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#worker.removeEventListener('message', this.#onMessage)
    this.#worker.removeEventListener('error', this.#onError)
    this.#worker.terminate?.()
    this.#rejectAll(new Error('The selection filter worker was disposed.'))
  }

  #request(
    id: number,
    input: SelectionFilterClientInput,
    options: SelectionFilterClientRunOptions,
  ): Promise<PixelBuffer> {
    if (this.#disposed) {
      return Promise.reject(
        new Error('The selection filter worker has been disposed.'),
      )
    }
    if (options.signal?.aborted) {
      return Promise.reject(abortError())
    }

    let imageData: Uint8ClampedArray
    let maskData: Uint8Array | undefined
    let settings: Required<ImageFilterSettings> | undefined
    let operations: FilterOperation[] | undefined
    try {
      assertSelectionFilterImage(input.image)
      imageData =
        options.transferOwnership &&
        input.image.data.buffer instanceof ArrayBuffer
          ? input.image.data
          : new Uint8ClampedArray(input.image.data)
      maskData = input.mask
        ? selectionFilterMaskToBytes(input.image, input.mask)
        : undefined
      if ('settings' in input && input.settings !== undefined) {
        settings = normalizeSelectionFilterSettings(input.settings)
      } else if ('operations' in input) {
        if (input.operations.length === 0 || input.operations.length > 64) {
          throw new RangeError(
            'Advanced filtering requires from 1 to 64 operations.',
          )
        }
        operations = input.operations.map((operation, index) =>
          validateFilterOperation(operation, `filters[${index}]`),
        )
      }
      if (input.outputMode === 'selection-overlay' && !maskData) {
        throw new TypeError(
          'Selection overlay output requires a selection mask.',
        )
      }
    } catch (error) {
      return Promise.reject(error)
    }

    const request: SelectionFilterWorkerRequest = {
      type: 'run',
      id,
      job: {
        image: {
          width: input.image.width,
          height: input.image.height,
          data: imageData,
        },
        ...(maskData ? { mask: maskData } : {}),
        ...(settings ? { settings } : {}),
        ...(operations ? { operations } : {}),
        ...(input.outputMode ? { outputMode: input.outputMode } : {}),
      },
    }

    return new Promise((resolve, reject) => {
      const pending: PendingSelectionFilterJob = {
        width: input.image.width,
        height: input.image.height,
        resolve,
        reject,
        onProgress: options.onProgress,
      }
      if (options.signal) {
        const onAbort = (): void => this.cancel(id)
        options.signal.addEventListener('abort', onAbort, { once: true })
        pending.detachAbort = () =>
          options.signal?.removeEventListener('abort', onAbort)
      }
      this.#pending.set(id, pending)
      try {
        this.#worker.postMessage(request, [
          imageData.buffer as ArrayBuffer,
          ...(maskData ? [maskData.buffer as ArrayBuffer] : []),
        ])
      } catch (error) {
        this.#settle(id, 'reject', error)
      }
    })
  }

  readonly #onMessage = (
    event: MessageEvent<SelectionFilterWorkerResponse>,
  ): void => {
    const response = event.data
    const pending = this.#pending.get(response.id)
    if (!pending) return

    if (response.type === 'progress') {
      if (
        !Number.isFinite(response.progress) ||
        response.progress < 0 ||
        response.progress > 1 ||
        !SELECTION_FILTER_PROGRESS_STAGES.has(response.stage)
      ) {
        this.#settle(
          response.id,
          'reject',
          protocolError('progress is malformed'),
        )
        return
      }
      try {
        pending.onProgress?.({
          progress: response.progress,
          stage: response.stage,
        })
      } catch (error) {
        this.#worker.postMessage({ type: 'cancel', id: response.id })
        this.#settle(response.id, 'reject', error)
      }
      return
    }

    if (response.type === 'cancelled') {
      this.#settle(response.id, 'reject', abortError())
      return
    }

    if (!response.ok) {
      const error = new Error(response.error.message)
      error.name = response.error.name
      this.#settle(response.id, 'reject', error)
      return
    }

    try {
      if (
        response.image.width !== pending.width ||
        response.image.height !== pending.height
      ) {
        throw protocolError('result dimensions do not match the request')
      }
      assertSelectionFilterImage(response.image)
      this.#settle(response.id, 'resolve', {
        width: response.image.width,
        height: response.image.height,
        data: new Uint8ClampedArray(response.image.data),
      })
    } catch (error) {
      this.#settle(response.id, 'reject', error)
    }
  }

  readonly #onError = (event: ErrorEvent): void => {
    this.#rejectAll(
      event.error ??
        new Error(event.message || 'Selection filter worker failed.'),
    )
  }

  #settle(
    id: number,
    action: 'resolve' | 'reject',
    value: PixelBuffer | unknown,
  ): void {
    const pending = this.#pending.get(id)
    if (!pending) return
    this.#pending.delete(id)
    pending.detachAbort?.()
    if (action === 'resolve') {
      pending.resolve(value as PixelBuffer)
    } else {
      pending.reject(value)
    }
  }

  #rejectAll(error: unknown): void {
    for (const id of [...this.#pending.keys()]) {
      this.#settle(id, 'reject', error)
    }
  }
}
