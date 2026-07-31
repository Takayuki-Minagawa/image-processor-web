import {
  BackgroundModelCacheError,
  ConsentAwareBackgroundModelCache,
  MemoryModelConsentRepository,
  OpfsModelRepository,
  validateBackgroundModelDescriptor,
  type BackgroundModelConsent,
  type BackgroundModelDescriptor,
  type ModelCacheDirectory,
  type ModelCacheDirectoryProvider,
  type ModelConsentRepository,
} from './modelCache'
import {
  createOnnxSegmentationAdapter,
  type OnnxSegmentationAdapterOptions,
  type OnnxSessionFactoryLoader,
} from './onnxSegmentation'
import type {
  BackgroundSegmentationAdapter,
  SegmentationContext,
} from './segmentation'

export const MAX_BACKGROUND_MODEL_DOWNLOAD_BYTES = 512 * 1024 * 1024

export type BackgroundModelFetch = (
  input: URL,
  init: { signal?: AbortSignal },
) => Promise<Response>

export type BackgroundModelDownloadErrorCode =
  | 'missing-download-url'
  | 'unsafe-download-url'
  | 'http-error'
  | 'invalid-content-length'
  | 'download-size-limit'
  | 'download-size-mismatch'

export class BackgroundModelDownloadError extends Error {
  readonly code: BackgroundModelDownloadErrorCode

  constructor(
    code: BackgroundModelDownloadErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'BackgroundModelDownloadError'
    this.code = code
  }
}

export interface DownloadBackgroundModelOptions {
  fetcher?: BackgroundModelFetch
  baseUrl?: string | URL
  maximumBytes?: number
  allowHttpLocalhost?: boolean
  signal?: AbortSignal
  reportProgress?(loadedBytes: number, totalBytes: number): void
}

export interface BackgroundOnnxModelLoaderOptions {
  descriptor: BackgroundModelDescriptor
  loadSessionFactory: OnnxSessionFactoryLoader
  onnx?: Omit<
    OnnxSegmentationAdapterOptions,
    'id' | 'modelBytes' | 'loadSessionFactory'
  >
  cache?: ConsentAwareBackgroundModelCache
  getOpfsRoot?: ModelCacheDirectoryProvider
  consentRepository?: ModelConsentRepository
  fetcher?: BackgroundModelFetch
  baseUrl?: string | URL
  maximumDownloadBytes?: number
  allowHttpLocalhost?: boolean
}

export interface BackgroundOnnxModelLoader {
  readonly descriptor: BackgroundModelDescriptor
  grantConsent(): Promise<BackgroundModelConsent>
  hasConsent(): Promise<boolean>
  revoke(removeCachedModel?: boolean): Promise<void>
  load(context?: SegmentationContext): Promise<BackgroundSegmentationAdapter>
}

interface StorageManagerWithDirectory {
  getDirectory(): Promise<ModelCacheDirectory>
}

const abortError = (): DOMException =>
  new DOMException('Background model loading was cancelled.', 'AbortError')

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw abortError()
  }
}

const defaultOpfsRoot = async (): Promise<ModelCacheDirectory> => {
  const storage = globalThis.navigator?.storage as
    (StorageManager & Partial<StorageManagerWithDirectory>) | undefined
  if (!storage || typeof storage.getDirectory !== 'function') {
    throw new DOMException(
      'Origin Private File System is unavailable.',
      'NotSupportedError',
    )
  }
  return (await storage.getDirectory()) as unknown as ModelCacheDirectory
}

const resolvedMaximumBytes = (value: number | undefined): number => {
  const maximum = value ?? MAX_BACKGROUND_MODEL_DOWNLOAD_BYTES
  if (
    !Number.isSafeInteger(maximum) ||
    maximum <= 0 ||
    maximum > MAX_BACKGROUND_MODEL_DOWNLOAD_BYTES
  ) {
    throw new RangeError(
      `maximumBytes must be from 1 to ${MAX_BACKGROUND_MODEL_DOWNLOAD_BYTES}.`,
    )
  }
  return maximum
}

const defaultBaseUrl = (): string | undefined => {
  if (typeof document !== 'undefined' && document.baseURI) {
    return document.baseURI
  }
  return globalThis.location?.href
}

const isLocalhost = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname === '[::1]' ||
  hostname.endsWith('.localhost')

const validatedModelUrl = (
  value: string | undefined,
  baseUrl: string | URL | undefined,
  allowHttpLocalhost: boolean,
): URL => {
  if (!value) {
    throw new BackgroundModelDownloadError(
      'missing-download-url',
      'The background model descriptor does not provide a download URL.',
    )
  }

  let url: URL
  try {
    url = new URL(value, baseUrl ?? defaultBaseUrl())
  } catch (error) {
    throw new BackgroundModelDownloadError(
      'unsafe-download-url',
      'The background model download URL is invalid.',
      { cause: error },
    )
  }
  if (
    url.username ||
    url.password ||
    (url.protocol !== 'https:' &&
      !(
        allowHttpLocalhost &&
        url.protocol === 'http:' &&
        isLocalhost(url.hostname)
      ))
  ) {
    throw new BackgroundModelDownloadError(
      'unsafe-download-url',
      'Background models must use HTTPS or an HTTP localhost URL without credentials.',
    )
  }
  url.hash = ''
  return url
}

const contentLength = (
  response: Response,
  expectedBytes: number,
  maximumBytes: number,
): number | null => {
  const header = response.headers.get('content-length')
  if (header === null) {
    return null
  }
  if (!/^(?:0|[1-9]\d*)$/.test(header.trim())) {
    throw new BackgroundModelDownloadError(
      'invalid-content-length',
      'The background model response has an invalid Content-Length header.',
    )
  }
  const length = Number(header)
  if (!Number.isSafeInteger(length) || length <= 0 || length > maximumBytes) {
    throw new BackgroundModelDownloadError(
      'download-size-limit',
      'The background model response exceeds the configured size limit.',
    )
  }
  if (length !== expectedBytes) {
    throw new BackgroundModelDownloadError(
      'download-size-mismatch',
      `The background model response declared ${length} bytes; ${expectedBytes} were expected.`,
    )
  }
  return length
}

const assertDownloadedSize = (
  loadedBytes: number,
  expectedBytes: number,
  maximumBytes: number,
): void => {
  if (loadedBytes > expectedBytes || loadedBytes > maximumBytes) {
    throw new BackgroundModelDownloadError(
      'download-size-limit',
      'The background model response exceeded its declared size.',
    )
  }
}

const responseBytes = async (
  response: Response,
  expectedBytes: number,
  maximumBytes: number,
  options: Pick<DownloadBackgroundModelOptions, 'signal' | 'reportProgress'>,
): Promise<Uint8Array> => {
  options.reportProgress?.(0, expectedBytes)
  if (!response.body) {
    throwIfAborted(options.signal)
    const bytes = new Uint8Array(await response.arrayBuffer())
    throwIfAborted(options.signal)
    assertDownloadedSize(bytes.byteLength, expectedBytes, maximumBytes)
    if (bytes.byteLength !== expectedBytes) {
      throw new BackgroundModelDownloadError(
        'download-size-mismatch',
        `The background model response contained ${bytes.byteLength} bytes; ${expectedBytes} were expected.`,
      )
    }
    options.reportProgress?.(bytes.byteLength, expectedBytes)
    return bytes
  }

  const reader = response.body.getReader()
  const bytes = new Uint8Array(expectedBytes)
  let loaded = 0
  try {
    while (true) {
      throwIfAborted(options.signal)
      const chunk = await reader.read()
      throwIfAborted(options.signal)
      if (chunk.done) {
        break
      }
      if (!ArrayBuffer.isView(chunk.value)) {
        throw new TypeError(
          'The background model stream returned invalid bytes.',
        )
      }
      const chunkBytes = new Uint8Array(
        chunk.value.buffer,
        chunk.value.byteOffset,
        chunk.value.byteLength,
      )
      assertDownloadedSize(
        loaded + chunkBytes.byteLength,
        expectedBytes,
        maximumBytes,
      )
      bytes.set(chunkBytes, loaded)
      loaded += chunkBytes.byteLength
      options.reportProgress?.(loaded, expectedBytes)
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
  if (loaded !== expectedBytes) {
    throw new BackgroundModelDownloadError(
      'download-size-mismatch',
      `The background model response contained ${loaded} bytes; ${expectedBytes} were expected.`,
    )
  }
  return bytes
}

/**
 * Downloads only the descriptor URL supplied by the caller. Model integrity is
 * verified by ConsentAwareBackgroundModelCache before the bytes are committed.
 */
export const downloadBackgroundModelBytes = async (
  candidate: BackgroundModelDescriptor,
  options: DownloadBackgroundModelOptions = {},
): Promise<Uint8Array> => {
  const descriptor = validateBackgroundModelDescriptor(candidate)
  const maximumBytes = resolvedMaximumBytes(options.maximumBytes)
  if (descriptor.sizeBytes > maximumBytes) {
    throw new BackgroundModelDownloadError(
      'download-size-limit',
      `The ${descriptor.sizeBytes} byte model exceeds the ${maximumBytes} byte download limit.`,
    )
  }
  throwIfAborted(options.signal)
  const url = validatedModelUrl(
    descriptor.downloadUrl,
    options.baseUrl,
    options.allowHttpLocalhost ?? true,
  )
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  const response = await fetcher(url, { signal: options.signal })
  throwIfAborted(options.signal)
  if (!response.ok) {
    throw new BackgroundModelDownloadError(
      'http-error',
      `Background model download failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`,
    )
  }
  if (response.url) {
    validatedModelUrl(
      response.url,
      options.baseUrl,
      options.allowHttpLocalhost ?? true,
    )
  }
  contentLength(response, descriptor.sizeBytes, maximumBytes)
  return responseBytes(response, descriptor.sizeBytes, maximumBytes, options)
}

const unwrapDownloadFailure = (error: unknown): never => {
  if (
    error instanceof BackgroundModelCacheError &&
    error.code === 'model-download-failed'
  ) {
    if (
      error.cause instanceof BackgroundModelDownloadError ||
      (error.cause instanceof DOMException && error.cause.name === 'AbortError')
    ) {
      throw error.cause
    }
  }
  throw error
}

/**
 * Creates a consent-gated, OPFS-backed loader. Construction, grantConsent(),
 * and cache inspection never fetch or import an ONNX runtime.
 */
export const createBackgroundOnnxModelLoader = (
  options: BackgroundOnnxModelLoaderOptions,
): BackgroundOnnxModelLoader => {
  const descriptor = validateBackgroundModelDescriptor(options.descriptor)
  const maximumBytes = resolvedMaximumBytes(options.maximumDownloadBytes)
  if (descriptor.sizeBytes > maximumBytes) {
    throw new BackgroundModelDownloadError(
      'download-size-limit',
      `The ${descriptor.sizeBytes} byte model exceeds the ${maximumBytes} byte download limit.`,
    )
  }
  if (typeof options.loadSessionFactory !== 'function') {
    throw new TypeError('A lazy ONNX session factory loader is required.')
  }
  const cache =
    options.cache ??
    new ConsentAwareBackgroundModelCache({
      models: new OpfsModelRepository(options.getOpfsRoot ?? defaultOpfsRoot),
      consents: options.consentRepository ?? new MemoryModelConsentRepository(),
    })

  return {
    descriptor,
    grantConsent: () => cache.grantConsent(descriptor),
    hasConsent: () => cache.hasConsent(descriptor),
    revoke: (removeCachedModel = false) =>
      cache.revoke(descriptor, removeCachedModel),
    async load(
      context: SegmentationContext = {},
    ): Promise<BackgroundSegmentationAdapter> {
      throwIfAborted(context.signal)
      if (!(await cache.hasConsent(descriptor))) {
        throw new BackgroundModelCacheError(
          'consent-required',
          `Loading model ${descriptor.id} requires explicit consent.`,
        )
      }
      throwIfAborted(context.signal)
      context.reportProgress?.(0, 'prepare')
      let modelBytes: Uint8Array
      try {
        modelBytes = await cache.getOrDownload(
          descriptor,
          (_model, downloadContext) =>
            downloadBackgroundModelBytes(descriptor, {
              fetcher: options.fetcher,
              baseUrl: options.baseUrl,
              maximumBytes,
              allowHttpLocalhost: options.allowHttpLocalhost,
              signal: downloadContext.signal,
              reportProgress: downloadContext.reportProgress,
            }),
          {
            signal: context.signal,
            reportProgress: (loadedBytes, totalBytes) => {
              context.reportProgress?.(
                totalBytes === 0 ? 0 : loadedBytes / totalBytes,
                'prepare',
              )
            },
          },
        )
      } catch (error) {
        unwrapDownloadFailure(error)
      }
      throwIfAborted(context.signal)
      context.reportProgress?.(1, 'prepare')
      return createOnnxSegmentationAdapter({
        ...options.onnx,
        id: `${descriptor.id}@${descriptor.version}`,
        modelBytes: modelBytes!,
        loadSessionFactory: options.loadSessionFactory,
      })
    },
  }
}
