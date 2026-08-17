import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/base.css'
import './styles/bridge.css'
import './styles/hub.css'
import './styles/app.css'
import './styles/ide.css'
import './styles/specialized-editors.css'
import './styles/CommandPalette.css'
import './styles/QuickOpen.css'
import './styles/TerminalPanel.css'
import './styles/Breadcrumbs.css'
import './styles/ContextMenu.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>
)
