import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { posix, resolve } from 'node:path'

const repositoryName =
  process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'image-processor-web'
const isGitHubPages = process.env.GITHUB_ACTIONS === 'true'
const buildId = process.env.GITHUB_SHA?.slice(0, 12) ?? Date.now().toString(36)
const isDeferredOnnxRuntimeAsset = (file: string): boolean =>
  /(?:^|\/)ort(?:[.-]).*\.(?:js|wasm)$/u.test(file)
const isDeferredJapaneseFontAsset = (file: string): boolean =>
  /(?:^|\/)noto-(?:sans|serif)-jp.*\.woff2$/u.test(file)
const require = createRequire(import.meta.url)
const pdfPackageRoot = dirname(require.resolve('pdfjs-dist/package.json'))
const pdfVersion = (require('pdfjs-dist/package.json') as { version: string })
  .version
const pdfAssetPath = `pdfjs/${pdfVersion}`
const pdfAssetDirectories = ['cmaps', 'standard_fonts', 'wasm', 'iccs']

const listFiles = async (
  directory: string,
  relativeDirectory = '',
): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = posix.join(relativeDirectory, entry.name)
      if (entry.isDirectory()) {
        return listFiles(resolve(directory, entry.name), relativePath)
      }
      return [relativePath]
    }),
  )
  return files.flat()
}

export default defineConfig({
  base: isGitHubPages ? `/${repositoryName}/` : '/',
  plugins: [
    react(),
    {
      name: 'local-pdf-assets',
      async configureServer(server) {
        // Serve only package-owned resources, never paths supplied by a PDF.
        const allowedFiles = new Set([
          'LICENSE',
          ...(
            await Promise.all(
              pdfAssetDirectories.map(async (directory) =>
                (await listFiles(resolve(pdfPackageRoot, directory))).map(
                  (file) => `${directory}/${file}`,
                ),
              ),
            )
          ).flat(),
        ])
        server.middlewares.use(
          `/${pdfAssetPath}/`,
          async (request, response, next) => {
            const relativePath = request.url?.split('?')[0]?.replace(/^\//u, '')
            if (!relativePath || !allowedFiles.has(relativePath)) {
              next()
              return
            }
            try {
              const content = await readFile(
                resolve(pdfPackageRoot, relativePath),
              )
              response.setHeader(
                'Content-Type',
                relativePath.endsWith('.wasm')
                  ? 'application/wasm'
                  : relativePath.endsWith('.js')
                    ? 'text/javascript'
                    : 'application/octet-stream',
              )
              response.end(content)
            } catch (error) {
              next(error)
            }
          },
        )
      },
      async writeBundle() {
        const destination = resolve(process.cwd(), 'dist', pdfAssetPath)
        await mkdir(destination, { recursive: true })
        // Keep all bundled licenses beside the original CMaps, fonts and WASM.
        await Promise.all(
          ['LICENSE', ...pdfAssetDirectories].map((directory) =>
            cp(
              resolve(pdfPackageRoot, directory),
              resolve(destination, directory),
              {
                recursive: true,
              },
            ),
          ),
        )
      },
    },
    {
      name: 'stamp-service-worker',
      apply: 'build',
      async closeBundle() {
        const outputDirectory = resolve(process.cwd(), 'dist')
        const serviceWorkerPath = resolve(outputDirectory, 'sw.js')
        const source = await readFile(serviceWorkerPath, 'utf8')
        const precacheUrls = (await listFiles(outputDirectory))
          .filter(
            (file) =>
              file !== 'sw.js' &&
              !isDeferredOnnxRuntimeAsset(file) &&
              !isDeferredJapaneseFontAsset(file),
          )
          .sort()
          .map((file) => `./${file}`)
        await writeFile(
          serviceWorkerPath,
          source
            .replaceAll('__PIXELWEAVE_BUILD_ID__', buildId)
            .replace('__PIXELWEAVE_PRECACHE__', JSON.stringify(precacheUrls)),
        )
      },
    },
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        passes: 3,
      },
    },
    chunkSizeWarningLimit: 900,
  },
  worker: {
    // The background-removal Worker lazy-loads ONNX Runtime backends.
    // ES-module Workers are required for Rollup to preserve those chunks.
    format: 'es',
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    coverage: {
      reporter: ['text', 'html'],
    },
  },
})
