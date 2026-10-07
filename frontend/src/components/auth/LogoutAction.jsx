import { useLogout } from '../../app/useLogout.js'
import { Button } from '../ui/index.jsx'

export function LogoutAction({ disabled = false }) {
  const { loggingOut, logoutError, logout } = useLogout()
  return <div className="logout-action">
    <Button tone="secondary" disabled={disabled || loggingOut} onClick={logout}>
      {loggingOut ? 'Signing out...' : 'Logout'}
    </Button>
    {logoutError && <p className="error-message" role="alert">{logoutError}</p>}
  </div>
}
