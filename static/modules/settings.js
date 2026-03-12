/**
 * Settings page logic and authentication
 */

export async function handleAuthCheck() {
    try {
        const res = await fetch('/api/auth/check');
        const data = await res.json();
        return data.password_enabled;
    } catch (e) {
        console.error('Auth check failed:', e);
        return false;
    }
}

export async function handleAuthVerify(password) {
    const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    });
    return res.ok;
}

export function renderSettings(appSettings, isPasswordProtected) {
    const sets = [
        { id: 'set-wan-unit', key: 'wan_unit' },
        { id: 'set-lan-unit', key: 'lan_unit' },
        { id: 'set-timezone', key: 'timezone' },
        { id: 'set-wan-engine', key: 'wan_engine' }
    ];

    sets.forEach(s => {
        const el = document.getElementById(s.id);
        if (el) el.value = appSettings[s.key] || '';
    });

    const deleteGroup = document.getElementById('group-allow-delete');
    const deleteToggle = document.getElementById('set-allow-delete');
    const maskGroup = document.getElementById('group-mask-mac');
    const maskToggle = document.getElementById('set-mask-mac');

    if (!isPasswordProtected) {
        deleteToggle.disabled = true;
        deleteToggle.checked = false;
        deleteGroup.style.opacity = '0.5';
        deleteGroup.title = 'Requires APP_PASSWORD set in Docker';

        maskToggle.disabled = true;
        maskToggle.checked = false;
        maskGroup.style.opacity = '0.5';
        maskGroup.title = 'Requires APP_PASSWORD set in Docker';
    } else {
        deleteToggle.disabled = false;
        deleteToggle.checked = appSettings.allow_delete === 'true';
        deleteGroup.style.opacity = '1';
        deleteGroup.title = '';

        maskToggle.disabled = false;
        maskToggle.checked = appSettings.mask_mac === 'true';
        maskGroup.style.opacity = '1';
        maskGroup.title = '';
    }

    const defaultLangSelect = document.getElementById('set-default-lang');
    const lockLangToggle = document.getElementById('set-lock-lang');
    if (defaultLangSelect) defaultLangSelect.value = appSettings.default_lang || 'en';
    if (lockLangToggle) lockLangToggle.checked = appSettings.lock_lang === 'true';

    // Cron
    const cronWanEnable = document.getElementById('set-cron-wan-enable');
    const cronWanExpr = document.getElementById('set-cron-wan-expr');
    const cronWanPreset = document.getElementById('set-cron-wan-preset');
    const cronWanCustomWrapper = document.getElementById('cron-wan-custom-wrapper');

    if (cronWanEnable) cronWanEnable.checked = appSettings.cron_wan_enable === 'true';
    if (cronWanExpr) cronWanExpr.value = appSettings.cron_wan_expr || '';

    const cronLanEnable = document.getElementById('set-cron-lan-enable');
    const cronLanExpr = document.getElementById('set-cron-lan-expr');
    const cronLanPreset = document.getElementById('set-cron-lan-preset');
    const cronLanCustomWrapper = document.getElementById('cron-lan-custom-wrapper');
    const cronLanTarget = document.getElementById('set-cron-lan-target');

    if (cronLanEnable) cronLanEnable.checked = appSettings.cron_lan_enable === 'true';
    if (cronLanExpr) cronLanExpr.value = appSettings.cron_lan_expr || '';
    if (cronLanTarget) cronLanTarget.value = appSettings.cron_lan_target || '';

    const presets = ['*/15 * * * *', '*/30 * * * *', '0 * * * *', '0 */6 * * *', '0 */12 * * *', '0 0 * * *'];
    
    if (cronWanPreset && cronWanCustomWrapper) {
        if (presets.includes(appSettings.cron_wan_expr)) {
            cronWanPreset.value = appSettings.cron_wan_expr;
            cronWanCustomWrapper.style.display = 'none';
        } else if (appSettings.cron_wan_expr) {
            cronWanPreset.value = 'custom';
            cronWanCustomWrapper.style.display = 'block';
        }
    }

    if (cronLanPreset && cronLanCustomWrapper) {
        if (presets.includes(appSettings.cron_lan_expr)) {
            cronLanPreset.value = appSettings.cron_lan_expr;
            cronLanCustomWrapper.style.display = 'none';
        } else if (appSettings.cron_lan_expr) {
            cronLanPreset.value = 'custom';
            cronLanCustomWrapper.style.display = 'block';
        }
    }
}

export async function saveSettings(appSettings, currentTranslations, uiCallbacks) {
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(appSettings)
        });
        if (res.ok) {
            if (uiCallbacks.onSuccess) uiCallbacks.onSuccess();
        } else {
            if (uiCallbacks.onError) uiCallbacks.onError('Error saving settings');
        }
    } catch (e) {
        console.error('Failed to save settings:', e);
        if (uiCallbacks.onError) uiCallbacks.onError('Connection error');
    }
}
