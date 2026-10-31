import { interpolate } from '../lib/interpolate.js'
import ar from './ar.js'

// Screen text is written in English in the code and looked up here: t('Sales history') gives the Arabic text when the
// language is Arabic, and the English text when there is no translation (so a missing entry never shows a blank).
export const LANGUAGES = Object.freeze([
  Object.freeze({ id: 'ar', label: 'العربية', dir: 'rtl', locale: 'ar-u-nu-latn' }), // Western digits stay readable
  Object.freeze({ id: 'en', label: 'English', dir: 'ltr', locale: 'en' }),
])

export const DEFAULT_LANGUAGE = 'ar'
export const LANGUAGE_STORAGE_KEY = 'saas2.language'

const dictionaries = Object.freeze({ ar })

export function languageInfo(id) {
  return LANGUAGES.find((language) => language.id === id) ?? LANGUAGES.find((language) => language.id === DEFAULT_LANGUAGE)
}

export function translate(language, text, params) {
  if (typeof text !== 'string') return text
  const entry = dictionaries[language]?.[text]
  return interpolate(typeof entry === 'string' ? entry : text, params)
}

export function readStoredLanguage(storage) {
  try {
    const value = storage?.getItem(LANGUAGE_STORAGE_KEY)
    return LANGUAGES.some((language) => language.id === value) ? value : DEFAULT_LANGUAGE
  } catch { return DEFAULT_LANGUAGE }
}

export function storeLanguage(storage, language) {
  try { storage?.setItem(LANGUAGE_STORAGE_KEY, language); return true } catch { return false }
}
