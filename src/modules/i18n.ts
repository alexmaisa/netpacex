/**
 * Localization and translation logic
 */

export let currentLang: string = localStorage.getItem('lang') || 'en';
export let currentTranslations: Record<string, string> = {};

export async function changeLanguage(lang: string): Promise<Record<string, string>> {
    try {
        const response = await fetch(`/locales/${lang}.json`);
        const translations: Record<string, string> = await response.json();
        
        localStorage.setItem('lang', lang);
        currentLang = lang;
        
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (key && translations[key]) {
                if (el instanceof HTMLInputElement && el.type === 'text') {
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
