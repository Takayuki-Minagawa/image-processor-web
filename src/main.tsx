import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './fonts.css'
import './styles.css'

void import('./pwa').then(({ startPwaRegistration }) => startPwaRegistration())

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
)
