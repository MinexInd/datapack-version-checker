import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/base.css'
import './styles/bridge.css'
import './styles/hub.css'
import './styles/app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>
)
