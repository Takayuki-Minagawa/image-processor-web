import { describe, expect, it } from 'vitest'
import type {
  ImagePipelineClientPort,
  PipelineClientProcessInput,
  PipelineClientProcessResult,
} from './imagePipelineClient'
import {
  BatchController,
  type BatchItem,
  type BatchSource,
} from './batchController'

const source = (name: string, values: number[] = [1]): BatchSource => ({
  name,
  type: 'image/png',
  size: values.length,
  arrayBuffer: async () => new Uint8Array(values).buffer,
})

class FakeClient implements ImagePipelineClientPort {
  active = 0
  maximumActive = 0
  readonly cancelled: string[] = []
  failNames = new Set<string>()
  delay = 0

  async process(
    input: PipelineClientProcessInput,
  ): Promise<PipelineClientProcessResult> {
    this.active += 1
    this.maximumActive = Math.max(this.maximumActive, this.active)
    try {
      if (this.delay > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, this.delay)
          input.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer)
              reject(new DOMException('cancelled', 'AbortError'))
            },
            { once: true },
          )
        })
      }
      if (this.failNames.has(input.sourceName)) {
        throw new Error(`failed ${input.sourceName}`)
      }
      return {
        data: new Uint8Array([9]).buffer,
        mimeType: input.output.mimeType,
        width: 10,
        height: 10,
      }
    } finally {
      this.active -= 1
    }
  }

  async createZip(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0)
  }

  cancel(jobId: string): void {
    this.cancelled.push(jobId)
  }
}

const items = (...names: string[]): BatchItem[] =>
  names.map((name, index) => ({
    id: `item-${index}`,
    source: source(name),
  }))

describe('BatchController', () => {
  it('bounds concurrency, continues after per-file failure, and names outputs safely', async () => {
    const client = new FakeClient()
    client.delay = 5
    client.failNames.add('bad.png')
    const controller = new BatchController(client)
    const result = await controller.run(
      items('one.png', 'bad.png', 'unsafe name?.png', 'four.png'),
      {
        commands: [{ type: 'resizeImage', width: 10, height: 10 }],
        output: { mimeType: 'image/webp' },
        concurrency: 2,
      },
    )

    expect(result.status).toBe('completed')
    expect(result.completed).toHaveLength(3)
    expect(result.failed).toMatchObject([{ sourceName: 'bad.png' }])
    expect(
      result.completed.find(
        ({ sourceName }) => sourceName === 'unsafe name?.png',
      )?.outputName,
    ).toBe('unsafe-name.webp')
    expect(client.maximumActive).toBeLessThanOrEqual(2)
    expect(controller.isRunning).toBe(false)
  })

  it('cancels active work, starts no new files, and returns completed outputs only', async () => {
    const client = new FakeClient()
    client.delay = 15
    const controller = new BatchController(client)
    let requestedCancel = false
    const result = await controller.run(
      items('one.png', 'two.png', 'three.png'),
      {
        commands: [],
        output: { mimeType: 'image/png' },
        concurrency: 1,
        onProgress: ({ active }) => {
          if (active === 1 && !requestedCancel) {
            requestedCancel = true
            controller.cancel()
          }
        },
      },
    )

    expect(result).toMatchObject({
      status: 'cancelled',
      completed: [],
      failed: [],
    })
    expect(client.cancelled.length).toBeGreaterThan(0)
  })

  it('rejects unsafe commands, duplicate ids, invalid concurrency, and changed input sizes', async () => {
    const client = new FakeClient()
    const controller = new BatchController(client)
    await expect(
      controller.run(items('one.png'), {
        commands: [{ type: 'addText', text: 'not batch safe' }],
        output: { mimeType: 'image/png' },
      }),
    ).rejects.toThrow(/cannot be replayed/)
    await expect(
      controller.run(
        [
          { id: 'same', source: source('one.png') },
          { id: 'same', source: source('two.png') },
        ],
        { commands: [], output: { mimeType: 'image/png' } },
      ),
    ).rejects.toThrow(/unique/)
    await expect(
      controller.run(items('one.png'), {
        commands: [],
        output: { mimeType: 'image/png' },
        concurrency: Number.NaN,
      }),
    ).rejects.toThrow(/concurrency/)

    const changed: BatchItem = {
      id: 'changed',
      source: {
        ...source('changed.png'),
        size: 2,
        arrayBuffer: async () => new ArrayBuffer(1),
      },
    }
    const result = await controller.run([changed], {
      commands: [],
      output: { mimeType: 'image/png' },
    })
    expect(result.failed[0].error).toBeInstanceOf(RangeError)
  })
})
