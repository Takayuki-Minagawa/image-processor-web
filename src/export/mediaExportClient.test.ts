import { describe, expect, it, vi } from 'vitest'
import {
  runMediaExportJob,
  type MediaExportWorkerLike,
} from './mediaExportClient'
import type { MediaExportWorkerRequest } from './workerProtocol'

class FakeWorker extends EventTarget implements MediaExportWorkerLike {
  readonly postMessage = vi.fn((request: MediaExportWorkerRequest) => {
    if (request.type === 'run') {
      queueMicrotask(() =>
        this.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'result',
              jobId: request.jobId,
              mimeType: 'image/gif',
              data: new Uint8Array([71, 73, 70]),
            },
          }),
        ),
      )
    }
  })
  readonly terminate = vi.fn()
}

describe('media export Worker client', () => {
  it('resolves bytes and terminates its isolated Worker', async () => {
    const worker = new FakeWorker()
    const result = await runMediaExportJob(
      {
        kind: 'gif',
        slideshow: {
          width: 1,
          height: 1,
          palette: new Uint8Array([0, 0, 0, 255, 255, 255]),
          frames: [{ pixels: new Uint8Array([0]), durationMs: 100 }],
        },
      },
      { createWorker: () => worker },
    )
    expect([...result.data]).toEqual([71, 73, 70])
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('posts a cancellation request for the active job', async () => {
    const worker = new FakeWorker()
    worker.postMessage.mockImplementation((request) => {
      if (request.type === 'cancel') {
        queueMicrotask(() =>
          worker.dispatchEvent(
            new MessageEvent('message', {
              data: { type: 'cancelled', jobId: request.jobId },
            }),
          ),
        )
      }
    })
    const controller = new AbortController()
    const operation = runMediaExportJob(
      {
        kind: 'gif',
        slideshow: {
          width: 1,
          height: 1,
          palette: new Uint8Array([0, 0, 0, 255, 255, 255]),
          frames: [{ pixels: new Uint8Array([0]), durationMs: 100 }],
        },
      },
      { createWorker: () => worker, signal: controller.signal },
    )
    controller.abort()
    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
  })
})
