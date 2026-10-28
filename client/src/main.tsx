import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './design/tokens.css'
import './design/controls.css'
import './index.css'
import App from './App.tsx'
import { DialogProvider } from './components/Dialog'
import { prefetchWorkspace } from './api'

// Before the app even asks who is logged in: see api.prefetchWorkspace.
prefetchWorkspace()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DialogProvider>
      <App />
    </DialogProvider>
  </StrictMode>,
)
