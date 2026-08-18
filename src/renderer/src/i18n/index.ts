import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en/common.json'
import es from './locales/es/common.json'

const SETTINGS_STORAGE_KEY = 'chart-editor-settings'

// Read the persisted language directly from localStorage rather than waiting
// on the zustand store to hydrate -- i18next must be initialized before the
// first render, and zustand's persist middleware hydrates during store
// creation (synchronously, since it uses localStorage), but there is no
// guarantee of import order between this module and stores/projectStore.
function getInitialLanguage(): 'en' | 'es' {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    const stored = raw ? JSON.parse(raw)?.state?.language : undefined
    if (stored === 'en' || stored === 'es') return stored
  } catch {
    // Corrupt or missing localStorage entry -- fall through to detection
  }
  return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en'
}

void i18next.use(initReactI18next).init({
  resources: {
    en: { common: en },
    es: { common: es }
  },
  lng: getInitialLanguage(),
  fallbackLng: 'en',
  defaultNS: 'common',
  interpolation: { escapeValue: false }
})

export default i18next
