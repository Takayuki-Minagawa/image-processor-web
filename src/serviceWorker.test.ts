/// <reference types="node" />
// @vitest-environment node

import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const scope = 'https://example.com/image-processor-web/'
const assetUrl = `${scope}assets/editor.js`
const serviceWorkerSource = readFileSync(
  new URL('../public/sw.js', import.meta.url),
  'utf8',
)
  .replaceAll('__PIXELWEAVE_BUILD_ID__', 'test-build')
  .replace('__PIXELWEAVE_PRECACHE__', JSON.stringify(['./index.html']))

type FetchEvent = {
  request: Request
  respondWith: (response: Promise<Response>) => void
}

const createWorker = () => {
  const match = vi
    .fn<(request: Request | string) => Promise<Response | undefined>>()
    .mockResolvedValue(undefined)
  const put = vi
    .fn<(request: Request | string, response: Response) => Promise<void>>()
    .mockResolvedValue(undefined)
  const open = vi.fn().mockResolvedValue({ match, put })
  const fetch = vi.fn<(request: Request) => Promise<Response>>()
  let onFetch: ((event: FetchEvent) => void) | undefined

  runInNewContext(serviceWorkerSource, {
    URL,
    Response,
    caches: { open },
    fetch,
    self: {
      registration: { scope },
      addEventListener: (
        type: string,
        listener: (event: FetchEvent) => void,
      ) => {
        if (type === 'fetch') onFetch = listener
      },
    },
  })

  return {
    open,
    match,
    put,
    fetch,
    respondTo(request: Request): Promise<Response> | undefined {
      let response: Promise<Response> | undefined
      if (!onFetch) throw new Error('Service Worker fetch handler is missing')
      onFetch({
        request,
        respondWith: (result) => {
          response = result
        },
      })
      return response
    },
  }
}

const networkResponse = (
  url = assetUrl,
  type: ResponseType = 'basic',
  status = 200,
): Response => {
  const response = new Response('network content', { status })
  Object.defineProperties(response, {
    url: { value: url },
    type: { value: type },
  })
  return response
}

const navigationRequest = (): Request => {
  const request = new Request(`${scope}design/123`)
  Object.defineProperty(request, 'mode', { value: 'navigate' })
  return request
}

describe('Service Worker cache resilience', () => {
  it.each(['open', 'match', 'put'] as const)(
    'returns online assets when cache.%s fails',
    async (operation) => {
      const worker = createWorker()
      const request = new Request(assetUrl)
      const response = networkResponse()
      worker[operation].mockRejectedValue(new Error('Storage unavailable'))
      worker.fetch.mockResolvedValue(response)

      const actual = await worker.respondTo(request)

      expect(actual).toBe(response)
      expect(await actual?.text()).toBe('network content')
      expect(worker.fetch).toHaveBeenCalledExactlyOnceWith(request)
    },
  )

  it('caches a clone of a successful response without consuming the original', async () => {
    const worker = createWorker()
    const request = new Request(assetUrl)
    const response = networkResponse()
    worker.fetch.mockResolvedValue(response)

    expect(await worker.respondTo(request)).toBe(response)

    expect(worker.open).toHaveBeenCalledExactlyOnceWith(
      'pixelweave-shell--image-processor-web--test-build',
    )
    expect(worker.put).toHaveBeenCalledOnce()
    const [cachedRequest, cachedResponse] = worker.put.mock.calls[0]
    expect(cachedRequest).toBe(request)
    expect(cachedResponse).not.toBe(response)
    expect(await cachedResponse.text()).toBe('network content')
    expect(response.bodyUsed).toBe(false)
  })

  it('serves a cached asset while offline', async () => {
    const worker = createWorker()
    const cached = new Response('cached asset')
    worker.match.mockResolvedValue(cached)
    worker.fetch.mockRejectedValue(new TypeError('Offline'))

    expect(await worker.respondTo(new Request(assetUrl))).toBe(cached)
    expect(worker.fetch).not.toHaveBeenCalled()
    expect(worker.put).not.toHaveBeenCalled()
  })

  it.each(['cache miss', 'open failure', 'match failure'])(
    'preserves an asset network error after a %s',
    async (scenario) => {
      const worker = createWorker()
      if (scenario === 'open failure') {
        worker.open.mockRejectedValue(new Error('Cache unavailable'))
      }
      if (scenario === 'match failure') {
        worker.match.mockRejectedValue(new Error('Cache unavailable'))
      }
      const networkError = new TypeError('Offline')
      worker.fetch.mockRejectedValue(networkError)

      await expect(worker.respondTo(new Request(assetUrl))).rejects.toBe(
        networkError,
      )
      expect(worker.put).not.toHaveBeenCalled()
    },
  )

  it('returns an online navigation without reading the cache', async () => {
    const worker = createWorker()
    const response = networkResponse(`${scope}design/123`)
    worker.open.mockRejectedValue(new Error('Cache unavailable'))
    worker.fetch.mockResolvedValue(response)

    expect(await worker.respondTo(navigationRequest())).toBe(response)
    expect(worker.open).not.toHaveBeenCalled()
  })

  it('uses the scoped shell for offline navigation', async () => {
    const worker = createWorker()
    const shell = new Response('<html>app shell</html>')
    worker.fetch.mockRejectedValue(new TypeError('Offline'))
    worker.match.mockResolvedValue(shell)

    expect(await worker.respondTo(navigationRequest())).toBe(shell)
    expect(worker.match).toHaveBeenCalledExactlyOnceWith(`${scope}index.html`)
  })

  it.each(['cache miss', 'open failure', 'match failure'])(
    'returns a readable offline navigation response after a %s',
    async (scenario) => {
      const worker = createWorker()
      worker.fetch.mockRejectedValue(new TypeError('Offline'))
      if (scenario === 'open failure') {
        worker.open.mockRejectedValue(new Error('Cache unavailable'))
      }
      if (scenario === 'match failure') {
        worker.match.mockRejectedValue(new Error('Cache unavailable'))
      }

      const response = await worker.respondTo(navigationRequest())

      expect(response?.status).toBe(503)
      expect(response?.headers.get('Cache-Control')).toBe('no-store')
      expect(await response?.text()).toBe(
        'Pixelweave Studio is currently offline.',
      )
    },
  )

  it.each([
    ['external origin', 'https://other.example/assets/editor.js', 'basic', 200],
    ['outside scope', 'https://example.com/other/app.js', 'basic', 200],
    ['opaque response', assetUrl, 'opaque', 200],
    ['error response', assetUrl, 'basic', 500],
  ] as const)(
    'returns but does not cache an %s',
    async (_label, url, type, status) => {
      const worker = createWorker()
      const response = networkResponse(url, type, status)
      worker.fetch.mockResolvedValue(response)

      expect(await worker.respondTo(new Request(assetUrl))).toBe(response)
      expect(worker.put).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['https://other.example/image-processor-web/assets/editor.js', 'GET'],
    ['https://example.com/image-processor-web-other/assets/editor.js', 'GET'],
    ['https://example.com/assets/editor.js', 'GET'],
    [assetUrl, 'POST'],
  ])('does not intercept %s (%s)', (url, method) => {
    const worker = createWorker()

    expect(worker.respondTo(new Request(url, { method }))).toBeUndefined()
    expect(worker.open).not.toHaveBeenCalled()
    expect(worker.fetch).not.toHaveBeenCalled()
  })
})
