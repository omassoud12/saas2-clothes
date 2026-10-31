import { createContext, useContext } from 'react'
import { translate } from './translate.js'

// Without a provider (tests, isolated renders) the text is English as written.
export const fallbackI18n = Object.freeze({
  language: 'en', dir: 'ltr', locale: 'en',
  t: (text, params) => translate('en', text, params),
  setLanguage() {},
})

export const I18nContext = createContext(fallbackI18n)

export function useI18n() {
  return useContext(I18nContext)
}
