import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { createCanvas, loadImage } from 'canvas'

const modelPath = process.argv[2]
const representativeImagePath = process.argv[3]
if (!modelPath) {
  throw new Error(
    'Usage: npm run verify:background-model -- /path/to/u2netp.onnx [/path/to/representative.png]',
  )
}

const [
  { DEFAULT_BACKGROUND_MODEL, DEFAULT_BACKGROUND_MODEL_ONNX_OPTIONS },
  { createOnnxRuntimeSessionFactoryLoader },
  { createOnnxSegmentationAdapter },
  {
    ConsentAwareBackgroundModelCache,
    MemoryModelConsentRepository,
    OpfsModelRepository,
  },
] = await Promise.all([
  import('../src/background/defaultModel.ts'),
  import('../src/background/onnxRuntime.ts'),
  import('../src/background/onnxSegmentation.ts'),
  import('../src/background/modelCache.ts'),
])

const modelBytes = new Uint8Array(await readFile(resolve(modelPath)))
const digest = createHash('sha256').update(modelBytes).digest('hex')
if (
  modelBytes.byteLength !== DEFAULT_BACKGROUND_MODEL.sizeBytes ||
  digest !== DEFAULT_BACKGROUND_MODEL.sha256
) {
  throw new Error(
    `Model identity mismatch: ${modelBytes.byteLength} bytes, SHA-256 ${digest}.`,
  )
}

const wasmBinary = await readFile(
  resolve('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm'),
)
const loadSessionFactory = createOnnxRuntimeSessionFactoryLoader({
  supportsWebGpu: () => false,
  importWasmRuntime: async () => {
    const runtime = await import('onnxruntime-web/wasm')
    runtime.env.wasm.numThreads = 1
    runtime.env.wasm.wasmBinary = wasmBinary
    return runtime
  },
})

const cachedFiles = new Map()
const opfsRoot = {
  async getFileHandle(name, options = {}) {
    if (!cachedFiles.has(name)) {
      if (!options.create) {
        throw new DOMException(`Missing OPFS entry ${name}.`, 'NotFoundError')
      }
      cachedFiles.set(name, new Uint8Array())
    }
    return {
      async getFile() {
        return {
          async arrayBuffer() {
            return new Uint8Array(cachedFiles.get(name)).buffer
          },
        }
      },
      async createWritable() {
        let pending = new Uint8Array()
        return {
          async write(bytes) {
            pending = new Uint8Array(bytes)
          },
          async close() {
            cachedFiles.set(name, pending)
          },
        }
      },
    }
  },
  async removeEntry(name) {
    if (!cachedFiles.delete(name)) {
      throw new DOMException(`Missing OPFS entry ${name}.`, 'NotFoundError')
    }
  },
}
const consentRepository = new MemoryModelConsentRepository()
const modelCache = new ConsentAwareBackgroundModelCache({
  models: new OpfsModelRepository(async () => opfsRoot),
  consents: consentRepository,
})
let onlineFetches = 0
await modelCache.grantConsent(DEFAULT_BACKGROUND_MODEL)
const cachedModelBytes = await modelCache.getOrDownload(
  DEFAULT_BACKGROUND_MODEL,
  async () => {
    onlineFetches += 1
    return modelBytes
  },
)
let offlineFetches = 0
const offlineModelBytes = await modelCache.getOrDownload(
  DEFAULT_BACKGROUND_MODEL,
  async () => {
    offlineFetches += 1
    throw new TypeError('The acceptance run is offline.')
  },
)
if (
  onlineFetches !== 1 ||
  offlineFetches !== 0 ||
  cachedFiles.size !== 1 ||
  cachedModelBytes.byteLength !== modelBytes.byteLength ||
  offlineModelBytes.byteLength !== modelBytes.byteLength
) {
  throw new Error(
    `Offline cache acceptance failed: online=${onlineFetches}, offline=${offlineFetches}, files=${cachedFiles.size}.`,
  )
}
const adapter = createOnnxSegmentationAdapter({
  id: 'u2netp-acceptance',
  modelBytes: offlineModelBytes,
  loadSessionFactory,
  ...DEFAULT_BACKGROUND_MODEL_ONNX_OPTIONS,
})

const width = 640
const height = 480
const data = new Uint8ClampedArray(width * height * 4)
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4
    const foreground =
      (x - width / 2) ** 2 / 180 ** 2 + (y - height / 2) ** 2 / 150 ** 2 < 1
    data[offset] = foreground ? 210 : 238
    data[offset + 1] = foreground ? 55 : 238
    data[offset + 2] = foreground ? 45 : 238
    data[offset + 3] = 255
  }
}

const started = performance.now()
const mask = await adapter.segment({ width, height, data }, {})
const elapsedMs = performance.now() - started
const center = mask[Math.floor(height / 2) * width + Math.floor(width / 2)]
const corner = mask[0]

if (
  mask.length !== width * height ||
  elapsedMs > 10_000 ||
  center < 0.8 ||
  corner > 0.2
) {
  throw new Error(
    `Model acceptance failed: ${Math.round(elapsedMs)} ms, center=${center}, corner=${corner}.`,
  )
}

const mean = (values) =>
  values.reduce((sum, value) => sum + value, 0) / values.length

const summarizeRepresentativeMask = (candidate, imageWidth, imageHeight) => {
  const border = []
  const center = []
  let minimum = 1
  let maximum = 0
  let foreground = 0
  const borderX = Math.max(1, Math.round(imageWidth * 0.06))
  const borderY = Math.max(1, Math.round(imageHeight * 0.06))
  for (let y = 0; y < imageHeight; y += 1) {
    for (let x = 0; x < imageWidth; x += 1) {
      const value = candidate[y * imageWidth + x]
      minimum = Math.min(minimum, value)
      maximum = Math.max(maximum, value)
      if (value >= 0.5) foreground += 1
      if (
        x < borderX ||
        x >= imageWidth - borderX ||
        y < borderY ||
        y >= imageHeight - borderY
      ) {
        border.push(value)
      }
      if (
        x >= imageWidth * 0.25 &&
        x < imageWidth * 0.75 &&
        y >= imageHeight * 0.15 &&
        y < imageHeight * 0.85
      ) {
        center.push(value)
      }
    }
  }
  return {
    minimum,
    maximum,
    centerMean: mean(center),
    borderMean: mean(border),
    foregroundRatio: foreground / candidate.length,
  }
}

let representative
if (representativeImagePath) {
  const image = await loadImage(resolve(representativeImagePath))
  const canvas = createCanvas(image.width, image.height)
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  const pixels = context.getImageData(0, 0, image.width, image.height)
  const representativeStarted = performance.now()
  const representativeMask = await adapter.segment(
    {
      width: image.width,
      height: image.height,
      data: new Uint8ClampedArray(pixels.data),
    },
    {},
  )
  const quality = summarizeRepresentativeMask(
    representativeMask,
    image.width,
    image.height,
  )
  representative = {
    image: `${image.width}x${image.height}`,
    elapsedMs: Math.round(performance.now() - representativeStarted),
    ...quality,
  }
  if (
    representativeMask.length !== image.width * image.height ||
    representative.elapsedMs > 10_000 ||
    quality.minimum > 0.2 ||
    quality.maximum < 0.8 ||
    quality.foregroundRatio < 0.05 ||
    quality.foregroundRatio > 0.95 ||
    quality.centerMean - quality.borderMean < 0.1
  ) {
    throw new Error(
      `Representative-image acceptance failed: ${JSON.stringify(representative)}.`,
    )
  }
}

console.log(
  JSON.stringify(
    {
      model: `${DEFAULT_BACKGROUND_MODEL.id}@${DEFAULT_BACKGROUND_MODEL.version}`,
      bytes: modelBytes.byteLength,
      sha256: digest,
      backend: 'wasm',
      image: `${width}x${height}`,
      elapsedMs: Math.round(elapsedMs),
      center,
      corner,
      offlineCache: {
        onlineFetches,
        offlineFetches,
        entries: cachedFiles.size,
      },
      ...(representative ? { representative } : {}),
    },
    null,
    2,
  ),
)
