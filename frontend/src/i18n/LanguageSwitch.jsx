import { LANGUAGES } from './translate.js'
import { useI18n } from './I18nContext.js'

// Arabic / English. Each name is written in its own language so it can always be found.
export function LanguageSwitch({ className = '' }) {
  const { language, setLanguage } = useI18n()
  return <div className={`language-switch ${className}`.trim()} role="group" aria-label="Language / اللغة">
    {LANGUAGES.map((item) => <button key={item.id} type="button" lang={item.id} aria-pressed={language === item.id} onClick={() => setLanguage(item.id)}>{item.label}</button>)}
  </div>
}
