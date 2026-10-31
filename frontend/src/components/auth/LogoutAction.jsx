import { useLogout } from '../../app/useLogout.js'
import { Button } from '../ui/index.jsx'
import { useI18n } from '../../i18n/I18nContext.js'

export function LogoutAction({ disabled = false }) {
  const { t } = useI18n()
  const { loggingOut, logoutError, logout } = useLogout()
  return <div className="logout-action">
    <Button tone="secondary" disabled={disabled || loggingOut} onClick={logout}>
      {loggingOut ? t('Signing out...') : t('Logout')}
    </Button>
    {logoutError && <p className="error-message" role="alert">{logoutError}</p>}
  </div>
}
