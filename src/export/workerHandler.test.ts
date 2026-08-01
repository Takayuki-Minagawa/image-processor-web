import { describe, expect, it } from 'vitest'
import { calculateRasterPdfGeometry } from './pdf'
import { createMediaExportWorkerMessageHandler } from './workerHandler'
import type { MediaExportWorkerResponse } from './workerProtocol'

const geometry = calculateRasterPdfGeometry({
  trimWidthMm: 1,
  trimHeightMm: 1,
  bleedMm: 0,
  dpi: 25.4,
})

const gifJob = {
  kind: 'gif' as const,
  slideshow: {
    width: 1,
    height: 1,
    palette: new Uint8Array([0, 0, 0, 255, 255, 255]),
    frames: [{ pixels: new Uint8Array([0]), durationMs: 100 }],
  },
}

describe('media export Worker handler', () => {
  it('reports progress and returns PDF bytes under one job id', async () => {
    const responses: MediaExportWorkerResponse[] = []
    let resolveTerminal: (response: MediaExportWorkerResponse) => void = () =>
      undefined
    const terminal = new Promise<MediaExportWorkerResponse>((resolve) => {
      resolveTerminal = resolve
    })
    const handler = createMediaExportWorkerMessageHandler((response) => {
      responses.push(response)
      if (response.type === 'result' || response.type === 'error') {
        resolveTerminal(response)
      }
    })

    handler({
      type: 'run',
      jobId: 'pdf-1',
      job: {
        kind: 'pdf',
        geometries: [geometry],
        pages: [
          {
            width: 1,
            height: 1,
            encoding: 'rgb',
            data: new Uint8Array([10, 20, 30]),
          },
        ],
      },
    })

    await expect(terminal).resolves.toMatchObject({
      type: 'result',
      jobId: 'pdf-1',
      mimeType: 'application/pdf',
    })
    expect(responses).toContainEqual({
      type: 'progress',
      jobId: 'pdf-1',
      stage: 'pdf-pages',
      progress: 1,
      completed: 1,
      total: 1,
    })
  })

  it('turns an in-flight abort into an explicit cancelled response', async () => {
    let resolveTerminal: (response: MediaExportWorkerResponse) => void = () =>
      undefined
    const terminal = new Promise<MediaExportWorkerResponse>((resolve) => {
      resolveTerminal = resolve
    })
    const handler = createMediaExportWorkerMessageHandler(
      (response) => {
        if (response.type === 'cancelled') resolveTerminal(response)
      },
      {
        encodeGif: (_input, options = {}) =>
          new Promise<Uint8Array>((_resolve, reject) => {
            const rejectAbort = (): void =>
              reject(new DOMException('cancelled', 'AbortError'))
            if (options.signal?.aborted) rejectAbort()
            else options.signal?.addEventListener('abort', rejectAbort)
          }),
      },
    )

    handler({ type: 'run', jobId: 'gif-1', job: gifJob })
    handler({ type: 'cancel', jobId: 'gif-1' })

    await expect(terminal).resolves.toEqual({
      type: 'cancelled',
      jobId: 'gif-1',
    })
  })

  it('normalizes unexpected encoder failures', async () => {
    let resolveTerminal: (response: MediaExportWorkerResponse) => void = () =>
      undefined
    const terminal = new Promise<MediaExportWorkerResponse>((resolve) => {
      resolveTerminal = resolve
    })
    const handler = createMediaExportWorkerMessageHandler(
      (response) => {
        if (response.type === 'error') resolveTerminal(response)
      },
      {
        encodeGif: async () => {
          throw new Error('codec unavailable')
        },
      },
    )

    handler({ type: 'run', jobId: 'gif-2', job: gifJob })

    await expect(terminal).resolves.toEqual({
      type: 'error',
      jobId: 'gif-2',
      code: 'EXPORT_FAILED',
      message: 'codec unavailable',
    })
  })
})
