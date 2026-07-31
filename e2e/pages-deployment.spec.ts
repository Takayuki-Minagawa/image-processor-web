import { expect, test } from '@playwright/test'

interface DeploymentState {
  cachedPaths: string[]
  resourcePaths: string[]
  scopePath: string
}

test.describe('GitHub Pages production deployment', () => {
  test('本番アセットとService WorkerをPagesサブパス内で配信する', async ({
    page,
    baseURL,
  }) => {
    const response = await page.goto('./')

    expect(response?.status()).toBe(200)
    expect(new URL(page.url()).pathname).toBe(new URL(baseURL ?? '').pathname)
    await expect(
      page.getByRole('region', { name: '画像編集キャンバス' }),
    ).toBeVisible()

    await page.evaluate('navigator.serviceWorker.ready.then(() => undefined)')
    await expect
      .poll(() =>
        page.evaluate<string | undefined>(
          'navigator.serviceWorker.controller?.state',
        ),
      )
      .toBe('activated')

    const deploymentState = await page.evaluate<DeploymentState>(`
      (async () => {
        const registration = await navigator.serviceWorker.ready
        const scopePath = new URL(registration.scope).pathname
        const resourcePaths = performance
          .getEntriesByType('resource')
          .map((entry) => new URL(entry.name).pathname)
          .filter((path) => /\\.(?:css|js)$/.test(path))

        await fetch(new URL('/', window.location.origin))
        const cachedPaths = (
          await Promise.all(
            (await caches.keys())
              .filter((name) => name.startsWith('pixelweave-shell-'))
              .map(async (name) =>
                (await caches.open(name))
                  .keys()
                  .then((requests) =>
                    requests.map(
                      (request) => new URL(request.url).pathname,
                    ),
                  ),
              ),
          )
        ).flat()

        return {
          cachedPaths,
          resourcePaths,
          scopePath,
        }
      })()
    `)

    expect(deploymentState.scopePath).toBe(new URL(baseURL ?? '').pathname)
    expect(deploymentState.resourcePaths.length).toBeGreaterThan(0)
    expect(deploymentState.cachedPaths.length).toBeGreaterThan(0)
    expect(
      deploymentState.resourcePaths.every((path) =>
        path.startsWith(deploymentState.scopePath),
      ),
    ).toBe(true)
    expect(
      deploymentState.cachedPaths.every((path) =>
        path.startsWith(deploymentState.scopePath),
      ),
    ).toBe(true)
    expect(
      deploymentState.cachedPaths.some((path) =>
        /\/ort(?:[.-]).*\.(?:js|wasm)$/u.test(path),
      ),
    ).toBe(false)
  })

  test('キャッシュ欠損時のオフラインnavigationを503 Responseで返す', async ({
    context,
    page,
  }) => {
    await page.goto('./')
    await page.evaluate(`
      (async () => {
        const registration = await navigator.serviceWorker.ready
        const indexUrl = new URL('./index.html', registration.scope).href
        await Promise.all(
          (await caches.keys())
            .filter((name) => name.startsWith('pixelweave-shell-'))
            .map(async (name) => {
              await (await caches.open(name)).delete(indexUrl)
            }),
        )
      })()
    `)
    await expect
      .poll(() =>
        page.evaluate<string | undefined>(
          'navigator.serviceWorker.controller?.state',
        ),
      )
      .toBe('activated')

    await context.setOffline(true)
    const response = await page.goto('./offline-navigation')

    expect(response?.status()).toBe(503)
    await expect(page.locator('body')).toContainText(
      'Pixelweave Studio is currently offline.',
    )
  })
})
