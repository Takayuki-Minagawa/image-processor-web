import { describe, expect, it, vi } from 'vitest'
import { SelectionMask } from '../../selection/mask'
import type { PixelBuffer } from './types'
import {
  applySelectionFilterCpu,
  applySelectionFilterOperationsCpu,
  imageFilterSettingsToFilterOperations,
} from './selectionFilter'
import {
  SelectionFilterClient,
  type SelectionFilterWorkerLike,
} from './selectionFilterClient'
import { createSelectionFilterWorkerMessageHandler } from './selectionFilter.worker'
import type {
  SelectionFilterWorkerRequest,
  SelectionFilterWorkerResponse,
} from './selectionFilterProtocol'

const image = (width: number, height: number, data: number[]): PixelBuffer => ({
  width,
  height,
  data: new Uint8ClampedArray(data),
})

describe('selection filter CPU boundary', () => {
  it('keeps pixels outside the mask byte-for-byte unchanged', () => {
    const input = image(
      3,
      1,
      [10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 128],
    )
    const original = [...input.data]

    const result = applySelectionFilterCpu(input, new Uint8Array([0, 255, 0]), {
      invert: 1,
    })

    expect([...result.data]).toEqual([
      10, 20, 30, 255, 215, 205, 195, 255, 70, 80, 90, 128,
    ])
    expect([...input.data]).toEqual(original)
    expect(result.data).not.toBe(input.data)
  })

  it('uses partial mask alpha as a deterministic feather blend', () => {
    const input = image(
      3,
      1,
      [10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 255],
    )
    const result = applySelectionFilterCpu(
      input,
      SelectionMask.fromBytes(3, 1, new Uint8Array([0, 128, 255])),
      { invert: 1 },
    )

    expect([...result.data]).toEqual([
      10, 20, 30, 255, 128, 128, 128, 255, 245, 235, 225, 255,
    ])
  })

  it('applies an exact advanced registry chain only through the mask', () => {
    const input = image(2, 1, [10, 20, 30, 255, 40, 50, 60, 255])
    const result = applySelectionFilterOperationsCpu(
      input,
      new Uint8Array([0, 255]),
      [{ id: 'invert', params: { amount: 1 } }],
    )

    expect([...result.data]).toEqual([10, 20, 30, 255, 215, 205, 195, 255])
  })

  it('applies the basic adjustments and a radius-independent box blur', () => {
    const input = image(3, 1, [0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255])
    const blurred = applySelectionFilterCpu(input, SelectionMask.full(3, 1), {
      blur: 1,
    })
    expect([...blurred.data]).toEqual([
      85, 85, 85, 255, 85, 85, 85, 255, 85, 85, 85, 255,
    ])

    const adjusted = applySelectionFilterCpu(
      image(1, 1, [40, 80, 120, 200]),
      new Uint8Array([255]),
      {
        brightness: 0.1,
        contrast: 0.2,
        saturation: -0.25,
        hue: 0.1,
        grayscale: true,
      },
    )
    expect(adjusted.data[0]).toBe(adjusted.data[1])
    expect(adjusted.data[1]).toBe(adjusted.data[2])
    expect(adjusted.data[3]).toBe(200)
  })

  it('maps every representable additional setting to a stable registry operation', () => {
    const settings = {
      sharpen: 0.5,
      emboss: 0.4,
      noise: 0.2,
      pixelate: 3,
      sepia: 0.3,
      invert: 0.4,
      gamma: 1.2,
      temperature: 0.25,
      tint: -0.15,
      vignette: 0.5,
      duotone: 0.6,
      halftone: 0.7,
      glitch: 0.8,
    }
    const first = imageFilterSettingsToFilterOperations(settings)
    const second = imageFilterSettingsToFilterOperations(settings)

    expect(first.map(({ id }) => id)).toEqual([
      'sharpen',
      'emboss',
      'noise',
      'pixelate',
      'sepia',
      'invert',
      'levels',
      'white-balance',
      'vignette',
      'duotone',
      'halftone',
      'glitch',
    ])
    expect(first).toEqual(second)
  })

  it('rejects unsafe dimensions, malformed buffers, and mask mismatches', () => {
    expect(() =>
      applySelectionFilterCpu(
        image(8_193, 1, [0, 0, 0, 255]),
        new Uint8Array(8_193),
        {},
      ),
    ).toThrow(/8,192 px/)
    expect(() =>
      applySelectionFilterCpu(
        image(2, 2, [0, 0, 0, 255]),
        new Uint8Array(4),
        {},
      ),
    ).toThrow(/valid RGBA/)
    expect(() =>
      applySelectionFilterCpu(
        image(2, 1, [0, 0, 0, 255, 0, 0, 0, 255]),
        new Uint8Array(1),
        {},
      ),
    ).toThrow(/byte length/)
    expect(() =>
      applySelectionFilterCpu(
        image(2, 1, [0, 0, 0, 255, 0, 0, 0, 255]),
        SelectionMask.full(1, 2),
        {},
      ),
    ).toThrow(/dimensions/)
  })

  it('honors preflight and progress-triggered aborts', () => {
    const input = image(1, 1, [10, 20, 30, 255])
    const alreadyAborted = new AbortController()
    alreadyAborted.abort()
    expect(() =>
      applySelectionFilterCpu(
        input,
        new Uint8Array([255]),
        {},
        {
          signal: alreadyAborted.signal,
        },
      ),
    ).toThrow(expect.objectContaining({ name: 'AbortError' }))

    const duringProgress = new AbortController()
    expect(() =>
      applySelectionFilterCpu(
        input,
        new Uint8Array([255]),
        { invert: 1 },
        {
          signal: duringProgress.signal,
          onProgress: ({ stage }) => {
            if (stage === 'prepare') duringProgress.abort()
          },
        },
      ),
    ).toThrow(expect.objectContaining({ name: 'AbortError' }))
  })
})

describe('selection filter worker protocol', () => {
  const request = (id = 1): SelectionFilterWorkerRequest => ({
    type: 'run',
    id,
    job: {
      image: image(1, 1, [10, 20, 30, 255]),
      mask: new Uint8Array([255]),
      settings: { invert: 1 },
    },
  })

  it('reports staged progress and transfers the successful RGBA result', () => {
    const posts: Array<{
      response: SelectionFilterWorkerResponse
      transfer?: Transferable[]
    }> = []
    const handle = createSelectionFilterWorkerMessageHandler(
      (response, transfer) => posts.push({ response, transfer }),
      (operation) => operation(),
    )

    handle(request())

    const progress = posts.filter(
      ({ response }) => response.type === 'progress',
    )
    expect(progress.length).toBeGreaterThanOrEqual(4)
    expect(progress.at(-1)?.response).toMatchObject({
      type: 'progress',
      progress: 1,
      stage: 'blend',
    })
    const result = posts.find(
      ({ response }) => response.type === 'result' && response.ok,
    )
    expect(result?.response).toMatchObject({
      type: 'result',
      id: 1,
      ok: true,
    })
    if (result?.response.type !== 'result' || !result.response.ok) {
      throw new Error('Expected a successful worker result.')
    }
    expect([...result.response.image.data]).toEqual([245, 235, 225, 255])
    expect(result.transfer).toEqual([result.response.image.data.buffer])
  })

  it('validates jobs and cancels scheduled work before it starts', () => {
    const posts: SelectionFilterWorkerResponse[] = []
    const scheduled: Array<() => void> = []
    const handle = createSelectionFilterWorkerMessageHandler(
      (response) => posts.push(response),
      (operation) => scheduled.push(operation),
    )
    const invalid = request(1)
    if (invalid.type === 'run') invalid.job.mask = new Uint8Array(0)
    handle(invalid)
    scheduled.shift()?.()
    expect(posts.at(-1)).toMatchObject({
      type: 'result',
      ok: false,
      error: { name: 'RangeError' },
    })

    handle(request(2))
    handle({ type: 'cancel', id: 2 })
    scheduled.shift()?.()
    expect(posts.at(-1)).toEqual({ type: 'cancelled', id: 2 })
    expect(
      posts.some((response) => response.type === 'result' && response.id === 2),
    ).toBe(false)
  })

  it('emits a transparent overlay outside the selected pixels', () => {
    const posts: SelectionFilterWorkerResponse[] = []
    const handle = createSelectionFilterWorkerMessageHandler(
      (response) => posts.push(response),
      (operation) => operation(),
    )
    handle({
      type: 'run',
      id: 7,
      job: {
        image: image(2, 1, [10, 20, 30, 255, 40, 50, 60, 255]),
        mask: new Uint8Array([0, 255]),
        settings: { invert: 1 },
        outputMode: 'selection-overlay',
      },
    })

    const response = posts.find(
      (candidate) =>
        candidate.type === 'result' && candidate.id === 7 && candidate.ok,
    )
    if (!response || response.type !== 'result' || !response.ok) {
      throw new Error('Expected a successful overlay result.')
    }
    expect([...response.image.data]).toEqual([
      10, 20, 30, 0, 215, 205, 195, 255,
    ])
  })

  it('runs exact advanced operations with or without a selection mask', () => {
    const posts: SelectionFilterWorkerResponse[] = []
    const handle = createSelectionFilterWorkerMessageHandler(
      (response) => posts.push(response),
      (operation) => operation(),
    )

    handle({
      type: 'run',
      id: 8,
      job: {
        image: image(2, 1, [10, 20, 30, 255, 40, 50, 60, 255]),
        mask: new Uint8Array([0, 255]),
        operations: [{ id: 'invert', params: { amount: 1 } }],
        outputMode: 'selection-overlay',
      },
    })
    handle({
      type: 'run',
      id: 9,
      job: {
        image: image(1, 1, [10, 20, 30, 255]),
        operations: [{ id: 'invert', params: { amount: 1 } }],
      },
    })

    const masked = posts.find(
      (response) =>
        response.type === 'result' && response.id === 8 && response.ok,
    )
    const full = posts.find(
      (response) =>
        response.type === 'result' && response.id === 9 && response.ok,
    )
    if (
      !masked ||
      masked.type !== 'result' ||
      !masked.ok ||
      !full ||
      full.type !== 'result' ||
      !full.ok
    ) {
      throw new Error('Expected successful advanced worker results.')
    }
    expect([...masked.image.data]).toEqual([10, 20, 30, 0, 215, 205, 195, 255])
    expect([...full.image.data]).toEqual([245, 235, 225, 255])
  })
})

class FakeSelectionFilterWorker implements SelectionFilterWorkerLike {
  readonly requests: Array<{
    message: SelectionFilterWorkerRequest
    transfer?: Transferable[]
  }> = []
  readonly messageListeners = new Set<
    (event: MessageEvent<SelectionFilterWorkerResponse>) => void
  >()
  readonly errorListeners = new Set<(event: ErrorEvent) => void>()
  terminated = false

  postMessage(
    message: SelectionFilterWorkerRequest,
    transfer?: Transferable[],
  ): void {
    this.requests.push({ message, transfer })
  }

  addEventListener(
    type: 'message' | 'error',
    listener:
      | ((event: MessageEvent<SelectionFilterWorkerResponse>) => void)
      | ((event: ErrorEvent) => void),
  ): void {
    if (type === 'message') {
      this.messageListeners.add(
        listener as (
          event: MessageEvent<SelectionFilterWorkerResponse>,
        ) => void,
      )
    } else {
      this.errorListeners.add(listener as (event: ErrorEvent) => void)
    }
  }

  removeEventListener(
    type: 'message' | 'error',
    listener:
      | ((event: MessageEvent<SelectionFilterWorkerResponse>) => void)
      | ((event: ErrorEvent) => void),
  ): void {
    if (type === 'message') {
      this.messageListeners.delete(
        listener as (
          event: MessageEvent<SelectionFilterWorkerResponse>,
        ) => void,
      )
    } else {
      this.errorListeners.delete(listener as (event: ErrorEvent) => void)
    }
  }

  terminate(): void {
    this.terminated = true
  }

  emit(response: SelectionFilterWorkerResponse): void {
    const event = {
      data: response,
    } as MessageEvent<SelectionFilterWorkerResponse>
    this.messageListeners.forEach((listener) => listener(event))
  }
}

describe('SelectionFilterClient', () => {
  const input = () => ({
    image: image(1, 1, [10, 20, 30, 255]),
    mask: new Uint8Array([255]),
    settings: { invert: 1 },
  })

  it('uses cloned Transferables, forwards progress, and resolves correlated output', async () => {
    const worker = new FakeSelectionFilterWorker()
    const client = new SelectionFilterClient(worker)
    const source = input()
    const onProgress = vi.fn()
    const task = client.start(source, { onProgress })
    const posted = worker.requests[0]

    expect(posted.message).toMatchObject({ type: 'run', id: task.id })
    if (posted.message.type !== 'run') {
      throw new Error('Expected a run request.')
    }
    if (!posted.message.job.mask) {
      throw new Error('Expected a selection mask.')
    }
    expect(posted.transfer).toEqual([
      posted.message.job.image.data.buffer,
      posted.message.job.mask.buffer,
    ])
    expect(posted.transfer).not.toContain(source.image.data.buffer)
    expect(posted.transfer).not.toContain(source.mask.buffer)

    worker.emit({
      type: 'progress',
      id: task.id,
      progress: 0.5,
      stage: 'effects',
    })
    worker.emit({
      type: 'result',
      id: task.id,
      ok: true,
      image: image(1, 1, [245, 235, 225, 255]),
    })

    await expect(task.result).resolves.toEqual({
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([245, 235, 225, 255]),
    })
    expect(onProgress).toHaveBeenCalledWith({
      progress: 0.5,
      stage: 'effects',
    })
    client.dispose()
    expect(worker.terminated).toBe(true)
  })

  it('cancels promptly, ignores late output, and rejects pending work on dispose', async () => {
    const worker = new FakeSelectionFilterWorker()
    const client = new SelectionFilterClient(worker)
    const cancelled = client.start(input())
    cancelled.cancel()

    await expect(cancelled.result).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(worker.requests.at(-1)?.message).toEqual({
      type: 'cancel',
      id: cancelled.id,
    })
    expect(() =>
      worker.emit({
        type: 'result',
        id: cancelled.id,
        ok: true,
        image: image(1, 1, [0, 0, 0, 255]),
      }),
    ).not.toThrow()

    const pending = client.run(input())
    client.dispose()
    await expect(pending).rejects.toThrow(/disposed/)
    expect(worker.terminated).toBe(true)
  })

  it('can transfer caller-owned RGBA without making another full image copy', async () => {
    const worker = new FakeSelectionFilterWorker()
    const client = new SelectionFilterClient(worker)
    const source = input()
    const task = client.start(source, { transferOwnership: true })
    const posted = worker.requests[0]
    if (posted.message.type !== 'run') {
      throw new Error('Expected a run request.')
    }
    expect(posted.message.job.image.data).toBe(source.image.data)
    expect(posted.transfer).toContain(source.image.data.buffer)

    worker.emit({
      type: 'result',
      id: task.id,
      ok: true,
      image: image(1, 1, [245, 235, 225, 255]),
    })
    await task.result
    client.dispose()
  })

  it('validates and posts advanced registry operations without a mask', async () => {
    const worker = new FakeSelectionFilterWorker()
    const client = new SelectionFilterClient(worker)
    const task = client.start({
      image: image(1, 1, [10, 20, 30, 255]),
      operations: [{ id: 'invert', params: { amount: 1 } }],
    })
    const posted = worker.requests[0]
    if (posted.message.type !== 'run') {
      throw new Error('Expected a run request.')
    }
    expect(posted.message.job).toMatchObject({
      operations: [{ id: 'invert', params: { amount: 1 } }],
    })
    expect(posted.message.job.mask).toBeUndefined()
    expect(posted.transfer).toEqual([posted.message.job.image.data.buffer])

    worker.emit({
      type: 'result',
      id: task.id,
      ok: true,
      image: image(1, 1, [245, 235, 225, 255]),
    })
    await expect(task.result).resolves.toMatchObject({
      data: new Uint8ClampedArray([245, 235, 225, 255]),
    })
    client.dispose()
  })

  it('rejects mismatched result dimensions as a protocol error', async () => {
    const worker = new FakeSelectionFilterWorker()
    const client = new SelectionFilterClient(worker)
    const task = client.start(input())
    worker.emit({
      type: 'result',
      id: task.id,
      ok: true,
      image: image(2, 1, [0, 0, 0, 255, 0, 0, 0, 255]),
    })

    await expect(task.result).rejects.toThrow(/dimensions/)
    client.dispose()
  })
})
