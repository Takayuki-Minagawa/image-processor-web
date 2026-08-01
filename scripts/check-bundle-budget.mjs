import { gzipSync } from 'node:zlib'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

// The default Japanese shell now includes device-local theme and language
// preference handling. English copy and the guide remain split into chunks.
const BASELINE_ENTRY_BYTES = 586_000
const BASELINE_ENTRY_GZIP_BYTES = 180_660
const MAXIMUM_GROWTH = 1.1

const outputDirectory = resolve(process.cwd(), 'dist')
const html = await readFile(resolve(outputDirectory, 'index.html'), 'utf8')
const entrySource = html.match(
  /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+\.js)"/u,
)?.[1]

if (!entrySource) {
  throw new Error(
    'Could not find the production module entry in dist/index.html.',
  )
}

const entryPath = resolve(outputDirectory, 'assets', basename(entrySource))
const entry = await readFile(entryPath)
const rawBytes = (await stat(entryPath)).size
const gzipBytes = gzipSync(entry).byteLength
const maximumRawBytes = Math.floor(BASELINE_ENTRY_BYTES * MAXIMUM_GROWTH)
const maximumGzipBytes = Math.floor(BASELINE_ENTRY_GZIP_BYTES * MAXIMUM_GROWTH)

if (rawBytes > maximumRawBytes || gzipBytes > maximumGzipBytes) {
  throw new Error(
    `Initial JS budget exceeded: ${rawBytes}/${maximumRawBytes} raw bytes, ` +
      `${gzipBytes}/${maximumGzipBytes} gzip bytes.`,
  )
}

const outputAssets = await readdir(resolve(outputDirectory, 'assets'))
const escapePattern = (value) =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')
const requiredLazyChunks = [
  {
    label: 'asset payload',
    stems: ['coreIcons', 'coreLayouts', 'coreShapes'],
    maximumBytes: 256_000,
  },
  {
    label: 'template payload',
    stems: [
      'banners',
      'businessCards',
      'flyers',
      'presentations',
      'social',
      'thumbnails',
    ],
    maximumBytes: 256_000,
  },
  {
    label: 'media export',
    stems: [
      'browserRaster',
      'mediaExportClient',
      'mediaExport.worker',
      'mediaRecorder',
    ],
    maximumBytes: 512_000,
  },
]

const lazyChunkReports = []
for (const group of requiredLazyChunks) {
  for (const stem of group.stems) {
    const pattern = new RegExp(`^${escapePattern(stem)}-[^.]+\\.js$`, 'u')
    const matches = outputAssets.filter((file) => pattern.test(file))
    if (matches.length !== 1) {
      throw new Error(
        `${group.label} must remain a distinct lazy chunk (${stem}); found ${matches.length}.`,
      )
    }
    const file = matches[0]
    const bytes = (await stat(resolve(outputDirectory, 'assets', file))).size
    if (bytes > group.maximumBytes) {
      throw new Error(
        `${group.label} chunk ${file} exceeded ${group.maximumBytes} raw bytes (${bytes}).`,
      )
    }
    if (html.includes(file)) {
      throw new Error(
        `${group.label} chunk ${file} must not be loaded directly by index.html.`,
      )
    }
    lazyChunkReports.push(`${stem}=${bytes}`)
  }
}

const serviceWorker = await readFile(resolve(outputDirectory, 'sw.js'), 'utf8')
if (/["'][^"']*\/ort(?:[.-])[^"']*\.(?:js|wasm)["']/u.test(serviceWorker)) {
  throw new Error(
    'ONNX Runtime assets must remain outside the service-worker app shell.',
  )
}
if (
  /["'][^"']*\/noto-(?:sans|serif)-jp[^"']*\.woff2["']/u.test(serviceWorker)
) {
  throw new Error(
    'Japanese font files must remain runtime-cached lazy assets, not part of the app shell.',
  )
}

console.log(
  `Initial JS budget: ${rawBytes}/${maximumRawBytes} raw, ` +
    `${gzipBytes}/${maximumGzipBytes} gzip bytes.`,
)
console.log(`Deferred feature chunks: ${lazyChunkReports.join(', ')} bytes.`)
