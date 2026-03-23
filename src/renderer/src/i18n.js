import { createI18n } from 'vue-i18n'
import en from '@lang/en.json'
import de from '@lang/de.json'

const savedLocale = localStorage.getItem('life-parental-locale') || 'de'

export const i18n = createI18n({
    legacy: false,
    locale: savedLocale,
    fallbackLocale: 'en',
    messages: { en, de }
})

export function setLocale(locale) {
    i18n.global.locale.value = locale
    localStorage.setItem('life-parental-locale', locale)
}

/** Global t() usable outside Vue component setup (composables, utilities). */
export function t(key, params) {
    return i18n.global.t(key, params)
}
