import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { AppErrorBoundary } from './components/AppErrorBoundary.jsx'
import './styles/tokens.css'
import './index.css'
import './styles/landing.css'
import './styles/auth.css'
import './styles/admin.css'
import './styles/product-base.css'
import './styles/lifecycle.css'
import './styles/finance.css'
import './styles/dashboard.css'
import './styles/categories.css'
import './styles/shell-phone.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
