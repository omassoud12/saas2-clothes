import { useEffect, useRef } from 'react'
import { getMobileNavigation, isNavigationItemActive, isPlainLeftClick } from './app-navigation.js'
import { NavigationIcon } from './AppSidebar.jsx'
import { useI18n } from '../i18n/I18nContext.js'
import { LanguageSwitch } from '../i18n/LanguageSwitch.jsx'

// Everything that is not in the bottom bar. A native modal dialog keeps the page behind it inert and traps focus.
export function MoreSheet({ role, identity, pathname, loggingOut, onNavigate, onLogout, onClose }) {
  const { t } = useI18n()
  const dialog = useRef(null)
  const { more } = getMobileNavigation(role)

  useEffect(() => {
    const node = dialog.current
    const trigger = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    node.showModal()
    return () => {
      node.close()
      document.body.style.overflow = previousOverflow
      if (trigger?.isConnected) trigger.focus()
    }
  }, [])

  function follow(event, path) {
    if (!isPlainLeftClick(event)) return
    event.preventDefault()
    onClose()
    onNavigate(path)
  }

  return (
    <dialog
      ref={dialog}
      className="more-sheet"
      aria-labelledby="more-sheet-title"
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => { if (event.target === dialog.current) onClose() }}
    >
      <div className="more-sheet-panel">
        <header className="more-sheet-header">
          <h2 id="more-sheet-title">{t('More')}</h2>
          <button type="button" className="more-sheet-close" aria-label={t('Close more')} onClick={onClose}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <ul className="more-sheet-list">
          {more.map((item) => {
            const active = isNavigationItemActive(pathname, item.path)
            return (
              <li key={item.key}>
                <a className={active ? 'is-active' : undefined} href={item.path} aria-current={active ? 'page' : undefined} onClick={(event) => follow(event, item.path)}>
                  <NavigationIcon name={item.icon} />
                  <span>{t(item.label)}</span>
                </a>
              </li>
            )
          })}
        </ul>
        <section className="more-sheet-language" aria-labelledby="more-sheet-language-title">
          <h3 id="more-sheet-language-title">{t('Language')}</h3>
          <LanguageSwitch />
        </section>
        <footer className="more-sheet-footer">
          <p><strong>{identity.storeName}</strong><span>{identity.userName} · {identity.role}</span></p>
          <button type="button" className="more-sheet-logout" disabled={loggingOut} onClick={onLogout}>
            {loggingOut ? t('Signing out...') : t('Logout')}
          </button>
        </footer>
      </div>
    </dialog>
  )
}
