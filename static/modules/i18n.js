/**
 * Localization and translation logic
 */

export let currentLang = localStorage.getItem('lang') || 'en';
export let currentTranslations = {};

export async function changeLanguage(lang) {
    try {
        const response = await fetch(`/locales/${lang}.json`);
        const translations = await response.json();
        
        localStorage.setItem('lang', lang);
        currentLang = lang;
        
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (translations[key]) {
                if (el.tagName === 'INPUT' && el.type === 'text' && el.placeholder) {
                    el.placeholder = translations[key];
                } else {
                    el.innerHTML = translations[key];
                }
            }
        });

        const footerEl = document.getElementById('footer-text');
        if (footerEl && translations['footer_text']) {
            footerEl.innerHTML = translations['footer_text'];
        }

        currentTranslations = translations;

        // Callback and re-renders will be handled by app.js orchestration
        return translations;
    } catch (e) {
        console.error('Failed to load translations:', e);
        throw e;
    }
}
