import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import BusbarApp from './BusbarApp.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BusbarApp />
  </StrictMode>,
)

// The tool's own service worker (https:// or localhost only). Its scope is the busbar/ folder,
// so it never touches the OmniPorta hub. Skipped in dev so it never caches Vite's modules.
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch((err) => {
      console.warn('Service worker registration failed:', err)
    })
  })
}
