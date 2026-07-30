import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { posix, resolve } from 'node:path';

const repositoryName =
  process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'image-processor-web';
const isGitHubPages = process.env.GITHUB_ACTIONS === 'true';
const buildId =
  process.env.GITHUB_SHA?.slice(0, 12) ?? Date.now().toString(36);

const listFiles = async (
  directory: string,
  relativeDirectory = '',
): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        return listFiles(resolve(directory, entry.name), relativePath);
      }
      return [relativePath];
    }),
  );
  return files.flat();
};

export default defineConfig({
  base: isGitHubPages ? `/${repositoryName}/` : '/',
  plugins: [
    react(),
    {
      name: 'stamp-service-worker',
      apply: 'build',
      async closeBundle() {
        const outputDirectory = resolve(process.cwd(), 'dist');
        const serviceWorkerPath = resolve(outputDirectory, 'sw.js');
        const source = await readFile(serviceWorkerPath, 'utf8');
        const precacheUrls = (await listFiles(outputDirectory))
          .filter((file) => file !== 'sw.js')
          .sort()
          .map((file) => `./${file}`);
        await writeFile(
          serviceWorkerPath,
          source
            .replaceAll('__PIXELWEAVE_BUILD_ID__', buildId)
            .replace('__PIXELWEAVE_PRECACHE__', JSON.stringify(precacheUrls)),
        );
      },
    },
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
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
});
