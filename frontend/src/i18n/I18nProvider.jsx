import { useCallback, useEffect, useMemo, useState } from 'react'
import { I18nContext } from './I18nContext.js'
import { languageInfo, readStoredLanguage, storeLanguage, translate } from './translate.js'

// Holds the chosen language (Arabic by default), keeps <html lang dir> in step with it, and remembers the choice.
export function I18nProvider({ children, initialLanguage }) {
  const [language, setLanguageState] = useState(() => initialLanguage ?? readStoredLanguage(typeof window === 'undefined' ? null : window.localStorage))
  const info = languageInfo(language)

  useEffect(() => {
    document.documentElement.lang = info.id
    document.documentElement.dir = info.dir
  }, [info])

  const setLanguage = useCallback((next) => {
    setLanguageState(next)
    storeLanguage(window.localStorage, next)
  }, [])

  const value = useMemo(() => ({
    language: info.id, dir: info.dir, locale: info.locale,
    t: (text, params) => translate(info.id, text, params),
    setLanguage,
  }), [info, setLanguage])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
