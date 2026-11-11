import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/be-vietnam-pro/400.css'
import '@fontsource/be-vietnam-pro/500.css'
import '@fontsource/be-vietnam-pro/600.css'
import '@fontsource/be-vietnam-pro/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './design/tokens.css'
import './design/controls.css'
import './index.css'
import App from './App.tsx'
import './design/shell.css'
import './design/today.css'
import './design/chatwin.css'
import './design/plan.css'
import './design/peek.css'
import './design/detail.css'
import './design/create.css'
import './design/views.css'
import './design/timesheet.css'
import './design/booking.css'
import './design/pickers.css'
import './design/settings.css'
import './design/pulse.css'
import { DialogProvider } from './components/Dialog'
import { prefetchWorkspace } from './api'
import { initAppearance } from './theme'

initAppearance()

// Before the app even asks who is logged in: see api.prefetchWorkspace.
prefetchWorkspace()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DialogProvider>
      <App />
    </DialogProvider>
  </StrictMode>,
)
