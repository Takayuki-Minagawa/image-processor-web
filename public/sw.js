const BUILD_ID = '__PIXELWEAVE_BUILD_ID__'
const SCOPE_KEY = new URL(self.registration.scope).pathname.replace(
  /[^a-z0-9]+/gi,
  '-',
)
const CACHE_PREFIX = `pixelweave-shell-${SCOPE_KEY}-`
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`
const PRECACHE_URLS = __PIXELWEAVE_PRECACHE__
const SCOPE_URL = new URL(self.registration.scope)

const scopedUrl = (relativeUrl) =>
  new URL(relativeUrl, self.registration.scope).href

const isWithinScope = (url) =>
  url.origin === SCOPE_URL.origin && url.pathname.startsWith(SCOPE_URL.pathname)

const offlineNavigationResponse = () =>
  new Response('Pixelweave Studio is currently offline.', {
    status: 503,
    statusText: 'Service Unavailable',
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      try {
        await Promise.all(
          PRECACHE_URLS.map(async (relativeUrl) => {
            const canonicalUrl = scopedUrl(relativeUrl)
            const freshUrl = new URL(canonicalUrl)
            freshUrl.searchParams.set('__pixelweave_build', BUILD_ID)
            const response = await fetch(freshUrl, { cache: 'reload' })
            if (!response.ok) {
              throw new Error(
                `Could not precache ${relativeUrl}: ${response.status}`,
              )
            }
            await cache.put(canonicalUrl, response)
          }),
        )
      } catch (error) {
        await caches.delete(CACHE_NAME)
        throw error
      }
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (!isWithinScope(url)) return

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request)
        } catch {
          const cache = await caches.open(CACHE_NAME)
          return (
            (await cache.match(scopedUrl('./index.html'))) ??
            offlineNavigationResponse()
          )
        }
      })(),
    )
    return
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request)
      if (cached) return cached

      const response = await fetch(request)
      if (
        response.ok &&
        response.type === 'basic' &&
        isWithinScope(new URL(response.url))
      ) {
        await cache.put(request, response.clone())
      }
      return response
    }),
  )
})
