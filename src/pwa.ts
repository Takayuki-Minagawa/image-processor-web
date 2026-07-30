export interface PwaState {
  offlineReady: boolean
  updateAvailable: boolean
}

const listeners = new Set<VoidFunction>()
let registration: ServiceWorkerRegistration | null = null
let waitingWorker: ServiceWorker | null = null
let started = false
let refreshing = false
let reloadOnControllerChange = false
let state: PwaState = {
  offlineReady: false,
  updateAvailable: false,
}

const updateState = (update: Partial<PwaState>): void => {
  const next = { ...state, ...update }
  if (
    next.offlineReady === state.offlineReady &&
    next.updateAvailable === state.updateAvailable
  ) {
    return
  }
  state = next
  listeners.forEach((listener) => listener())
}

const watchWorker = (worker: ServiceWorker | null): void => {
  if (!worker) return
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
      waitingWorker = worker
      updateState({ updateAvailable: true })
    }
  })
}

export function getPwaState(): PwaState {
  return state
}

export function subscribePwaState(listener: VoidFunction): VoidFunction {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function startPwaRegistration(): void {
  if (started || !import.meta.env.PROD || !('serviceWorker' in navigator)) {
    return
  }
  started = true

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadOnControllerChange || refreshing) return
    refreshing = true
    window.location.reload()
  })

  void navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    })
    .then(async (nextRegistration) => {
      registration = nextRegistration
      if (nextRegistration.waiting && navigator.serviceWorker.controller) {
        waitingWorker = nextRegistration.waiting
        updateState({ updateAvailable: true })
      }

      watchWorker(nextRegistration.installing)
      nextRegistration.addEventListener('updatefound', () => {
        watchWorker(nextRegistration.installing)
      })

      await navigator.serviceWorker.ready
      updateState({ offlineReady: true })
    })
    .catch(() => {
      // The editor remains fully usable online when registration is blocked.
    })
}

export function applyServiceWorkerUpdate(): boolean {
  const worker = registration?.waiting ?? waitingWorker
  if (!worker) return false
  reloadOnControllerChange = true
  worker.postMessage({ type: 'SKIP_WAITING' })
  return true
}
