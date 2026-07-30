import { defineConfig, devices } from '@playwright/test'

const previewHost = '127.0.0.1'
const previewPort = 4173
const repository = process.env.GITHUB_REPOSITORY ?? 'local/image-processor-web'
const repositoryName = repository.split('/')[1] ?? 'image-processor-web'
const pagesBasePath = `/${repositoryName}/`
const previewBaseUrl = `http://${previewHost}:${previewPort}${pagesBasePath}`
const buildBeforePreview = process.env.PLAYWRIGHT_SKIP_BUILD !== 'true'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: previewBaseUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-github-pages',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: [
      buildBeforePreview ? 'npm run build' : '',
      `npm run preview -- --host ${previewHost} --port ${previewPort}`,
    ]
      .filter(Boolean)
      .join(' && '),
    url: previewBaseUrl,
    env: {
      ...process.env,
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: repository,
      GITHUB_SHA: process.env.GITHUB_SHA ?? 'local-pages-e2e',
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
