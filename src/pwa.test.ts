import { afterEach, describe, expect, it, vi } from 'vitest'

class FakeServiceWorker extends EventTarget {
  readonly messages: unknown[] = []

  constructor(public state: ServiceWorkerState) {
    super()
  }

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  transitionTo(state: ServiceWorkerState): void {
    this.state = state
    this.dispatchEvent(new Event('statechange'))
  }
}

class FakeRegistration extends EventTarget {
  installing: ServiceWorker | null = null

  constructor(public waiting: ServiceWorker | null) {
    super()
  }
}

const installServiceWorkerContainer = (
  registration: FakeRegistration,
): EventTarget & {
  controller: ServiceWorker
  ready: Promise<ServiceWorkerRegistration>
  register: ReturnType<typeof vi.fn>
} => {
  const container = new EventTarget() as EventTarget & {
    controller: ServiceWorker
    ready: Promise<ServiceWorkerRegistration>
    register: ReturnType<typeof vi.fn>
  }
  container.controller = {} as ServiceWorker
  container.ready = Promise.resolve(
    registration as unknown as ServiceWorkerRegistration,
  )
  container.register = vi.fn().mockResolvedValue(registration)

  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: container,
  })
  return container
}

const flushRegistration = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  Reflect.deleteProperty(navigator, 'serviceWorker')
})

describe('PWA update lifecycle', () => {
  it('allows retry while the waiting worker remains installed', async () => {
    vi.stubEnv('PROD', true)
    const worker = new FakeServiceWorker('installed')
    const registration = new FakeRegistration(
      worker as unknown as ServiceWorker,
    )
    installServiceWorkerContainer(registration)
    const pwa = await import('./pwa')

    pwa.startPwaRegistration()
    await flushRegistration()

    expect(pwa.getPwaState().updateAvailable).toBe(true)
    expect(pwa.applyServiceWorkerUpdate()).toBe(true)
    expect(worker.messages).toEqual([{ type: 'SKIP_WAITING' }])
    expect(pwa.getPwaState().updateAvailable).toBe(true)

    // Represents retry after the caller's activation timeout elapsed.
    expect(pwa.applyServiceWorkerUpdate()).toBe(true)
    expect(worker.messages).toEqual([
      { type: 'SKIP_WAITING' },
      { type: 'SKIP_WAITING' },
    ])
    expect(pwa.getPwaState().updateAvailable).toBe(true)

    registration.waiting = null
    worker.transitionTo('activating')
    expect(pwa.getPwaState().updateAvailable).toBe(false)
    worker.transitionTo('activated')

    expect(pwa.getPwaState().updateAvailable).toBe(false)
    expect(pwa.applyServiceWorkerUpdate()).toBe(false)
  })

  it('rejects an activated worker even if the registration reference is stale', async () => {
    vi.stubEnv('PROD', true)
    const worker = new FakeServiceWorker('installed')
    const registration = new FakeRegistration(
      worker as unknown as ServiceWorker,
    )
    installServiceWorkerContainer(registration)
    const pwa = await import('./pwa')

    pwa.startPwaRegistration()
    await flushRegistration()
    expect(pwa.getPwaState().updateAvailable).toBe(true)

    worker.transitionTo('activated')

    expect(pwa.getPwaState().updateAvailable).toBe(false)
    expect(pwa.applyServiceWorkerUpdate()).toBe(false)
    expect(worker.messages).toEqual([])
  })

  it('clears a stale waiting worker when the controller changes', async () => {
    vi.stubEnv('PROD', true)
    const worker = new FakeServiceWorker('installed')
    const registration = new FakeRegistration(
      worker as unknown as ServiceWorker,
    )
    const container = installServiceWorkerContainer(registration)
    const pwa = await import('./pwa')

    pwa.startPwaRegistration()
    await flushRegistration()
    expect(pwa.getPwaState().updateAvailable).toBe(true)

    registration.waiting = null
    container.dispatchEvent(new Event('controllerchange'))

    expect(pwa.getPwaState().updateAvailable).toBe(false)
    expect(pwa.applyServiceWorkerUpdate()).toBe(false)
    expect(worker.messages).toEqual([])
  })
})
