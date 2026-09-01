import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './theme/tokens.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// offline shell + installability; dev bleibt ohne SW, damit HMR nicht cached
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
  })
}
