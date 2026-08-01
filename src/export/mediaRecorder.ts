export interface RecordedPresentationFrame {
  source: string
  durationMs: number
}

export interface RecordedPresentationVideo {
  blob: Blob
  mimeType: string
  extension: 'mp4' | 'webm'
}

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
] as const

export const selectMediaRecorderMimeType = (
  isTypeSupported: (mimeType: string) => boolean,
): string | null => MIME_CANDIDATES.find(isTypeSupported) ?? null

const abortError = (): DOMException =>
  new DOMException('Video export was cancelled.', 'AbortError')

const wait = (durationMs: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const timer = globalThis.setTimeout(resolve, durationMs)
    signal?.addEventListener(
      'abort',
      () => {
        globalThis.clearTimeout(timer)
        reject(abortError())
      },
      { once: true },
    )
  })

const loadImage = (source: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image), { once: true })
    image.addEventListener(
      'error',
      () => reject(new TypeError('A presentation frame could not be decoded.')),
      { once: true },
    )
    image.src = source
  })

/**
 * Records pre-rendered local frames through the browser's native container
 * muxer. Unsupported browsers return null so the caller can emit GIF instead.
 */
export async function recordPresentationVideo(
  frames: readonly RecordedPresentationFrame[],
  width: number,
  height: number,
  options: {
    signal?: AbortSignal
    onProgress?: (progress: number) => void
  } = {},
): Promise<RecordedPresentationVideo | null> {
  if (
    frames.length === 0 ||
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    !Number.isSafeInteger(height) ||
    height <= 0
  ) {
    throw new RangeError('Video export needs frames and positive dimensions.')
  }
  if (
    typeof MediaRecorder === 'undefined' ||
    typeof HTMLCanvasElement.prototype.captureStream !== 'function'
  ) {
    return null
  }
  const mimeType = selectMediaRecorderMimeType(MediaRecorder.isTypeSupported)
  if (!mimeType) return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('A 2D canvas is required for video export.')
  const decoded = await Promise.all(
    frames.map(({ source }) => loadImage(source)),
  )
  if (options.signal?.aborted) throw abortError()
  const stream = canvas.captureStream(12)
  const chunks: Blob[] = []
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 4_000_000,
  })
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  })
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.addEventListener('stop', () => resolve(), { once: true })
    recorder.addEventListener(
      'error',
      () => reject(new Error('The browser failed to record the presentation.')),
      { once: true },
    )
  })
  const onAbort = () => {
    if (recorder.state !== 'inactive') recorder.stop()
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    recorder.start(250)
    for (let index = 0; index < frames.length; index += 1) {
      if (options.signal?.aborted) throw abortError()
      context.clearRect(0, 0, width, height)
      context.drawImage(decoded[index], 0, 0, width, height)
      const track = stream.getVideoTracks()[0] as MediaStreamTrack & {
        requestFrame?: () => void
      }
      track.requestFrame?.()
      options.onProgress?.(index / frames.length)
      await wait(Math.max(20, frames[index].durationMs), options.signal)
    }
    if (recorder.state !== 'inactive') recorder.stop()
    await stopped
    options.onProgress?.(1)
  } finally {
    options.signal?.removeEventListener('abort', onAbort)
    stream.getTracks().forEach((track) => track.stop())
  }
  if (options.signal?.aborted) throw abortError()
  return {
    blob: new Blob(chunks, { type: mimeType }),
    mimeType,
    extension: mimeType.startsWith('video/mp4') ? 'mp4' : 'webm',
  }
}
