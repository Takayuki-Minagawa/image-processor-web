import { lazy, Suspense } from 'react'

const EditorApplication = lazy(() => import('./EditorApplication'))

function AppLoadingShell() {
  return (
    <main className="app-loading-shell" aria-busy="true" aria-live="polite">
      <div className="app-loading-mark" aria-hidden="true">
        P
      </div>
      <div>
        <strong>Pixelweave Studio</strong>
        <span>Loading the design editor…</span>
      </div>
    </main>
  )
}

export default function App() {
  return (
    <Suspense fallback={<AppLoadingShell />}>
      <EditorApplication />
    </Suspense>
  )
}
