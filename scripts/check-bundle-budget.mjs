import { gzipSync } from 'node:zlib'
import { readFile, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

const BASELINE_ENTRY_BYTES = 581_120
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

const serviceWorker = await readFile(resolve(outputDirectory, 'sw.js'), 'utf8')
if (/["'][^"']*\/ort(?:[.-])[^"']*\.(?:js|wasm)["']/u.test(serviceWorker)) {
  throw new Error(
    'ONNX Runtime assets must remain outside the service-worker app shell.',
  )
}

console.log(
  `Initial JS budget: ${rawBytes}/${maximumRawBytes} raw, ` +
    `${gzipBytes}/${maximumGzipBytes} gzip bytes.`,
)
