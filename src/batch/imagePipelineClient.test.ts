import { describe, expect, it, vi } from 'vitest'
import type {
  ImagePipelineWorkerRequest,
  ImagePipelineWorkerResponse,
} from './imagePipelineProtocol'
import { ImagePipelineClient, type WorkerLike } from './imagePipelineClient'

class FakeWorker implements WorkerLike {
  readonly requests: Array<{
    message: ImagePipelineWorkerRequest
    transfer?: Transferable[]
  }> = []
  readonly messageListeners = new Set<
    (event: MessageEvent<ImagePipelineWorkerResponse>) => void
  >()
  readonly errorListeners = new Set<(event: ErrorEvent) => void>()
  terminated = false

  postMessage(
    message: ImagePipelineWorkerRequest,
    transfer?: Transferable[],
  ): void {
    this.requests.push({ message, transfer })
  }

  addEventListener(
    type: 'message' | 'error',
    listener:
      | ((event: MessageEvent<ImagePipelineWorkerResponse>) => void)
      | ((event: ErrorEvent) => void),
  ): void {
    if (type === 'message') {
      this.messageListeners.add(
        listener as (event: MessageEvent<ImagePipelineWorkerResponse>) => void,
      )
    } else {
      this.errorListeners.add(listener as (event: ErrorEvent) => void)
    }
  }

  removeEventListener(
    type: 'message' | 'error',
    listener:
      | ((event: MessageEvent<ImagePipelineWorkerResponse>) => void)
      | ((event: ErrorEvent) => void),
  ): void {
    if (type === 'message') {
      this.messageListeners.delete(
        listener as (event: MessageEvent<ImagePipelineWorkerResponse>) => void,
      )
    } else {
      this.errorListeners.delete(listener as (event: ErrorEvent) => void)
    }
  }

  terminate(): void {
    this.terminated = true
  }

  emit(response: ImagePipelineWorkerResponse): void {
    const event = {
      data: response,
    } as MessageEvent<ImagePipelineWorkerResponse>
    this.messageListeners.forEach((listener) => listener(event))
  }
}

describe('ImagePipelineClient transferable protocol', () => {
  it('transfers input ownership, reports progress, and resolves correlated results', async () => {
    const worker = new FakeWorker()
    const client = new ImagePipelineClient(worker)
    const input = new Uint8Array([1, 2]).buffer
    const onProgress = vi.fn()
    const pending = client.process({
      jobId: 'one',
      sourceName: 'one.png',
      inputMimeType: 'image/png',
      input,
      commands: [],
      output: { mimeType: 'image/webp' },
      onProgress,
    })

    expect(worker.requests[0].transfer).toEqual([input])
    worker.emit({
      type: 'progress',
      jobId: 'one',
      phase: 'decode',
      progress: 0.5,
    })
    const output = new Uint8Array([3]).buffer
    worker.emit({
      type: 'processResult',
      jobId: 'one',
      data: output,
      mimeType: 'image/webp',
      width: 20,
      height: 10,
    })

    await expect(pending).resolves.toEqual({
      data: output,
      mimeType: 'image/webp',
      width: 20,
      height: 10,
    })
    expect(onProgress).toHaveBeenCalledOnce()
    client.dispose()
    expect(worker.terminated).toBe(true)
  })

  it('sends cancellation, rejects promptly, and ignores a late worker result', async () => {
    const worker = new FakeWorker()
    const client = new ImagePipelineClient(worker)
    const controller = new AbortController()
    const pending = client.process({
      jobId: 'cancel-me',
      sourceName: 'cancel.png',
      inputMimeType: 'image/png',
      input: new ArrayBuffer(1),
      commands: [],
      output: { mimeType: 'image/png' },
      signal: controller.signal,
    })
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.requests.at(-1)?.message).toEqual({
      type: 'cancel',
      jobId: 'cancel-me',
    })
    expect(() =>
      worker.emit({
        type: 'processResult',
        jobId: 'cancel-me',
        data: new ArrayBuffer(0),
        mimeType: 'image/png',
        width: 1,
        height: 1,
      }),
    ).not.toThrow()
  })

  it('rejects protocol mismatches and duplicate active ids', async () => {
    const worker = new FakeWorker()
    const client = new ImagePipelineClient(worker)
    const first = client.process({
      jobId: 'duplicate',
      sourceName: 'one.png',
      inputMimeType: 'image/png',
      input: new ArrayBuffer(1),
      commands: [],
      output: { mimeType: 'image/png' },
    })
    await expect(
      client.createZip({
        jobId: 'duplicate',
        entries: [{ name: 'one.png', data: new ArrayBuffer(1) }],
      }),
    ).rejects.toThrow(/Duplicate/)
    worker.emit({
      type: 'zipResult',
      jobId: 'duplicate',
      data: new ArrayBuffer(1),
    })
    await expect(first).rejects.toThrow(/expected processResult/)
  })
})
