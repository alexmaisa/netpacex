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
    // 1. Generic Select/Input fields
    const sets = [
        { id: 'set-timezone', key: 'timezone' },
        { id: 'set-wan-engine', key: 'wan_engine' }
    ];

    sets.forEach(s => {
        const el = document.getElementById(s.id);
        if (el) el.value = appSettings[s.key] || '';
    });

    // 2. Radio Units (WAN/LAN)
    ['wan_unit', 'lan_unit'].forEach(key => {
        const val = appSettings[key];
        if (val) {
            const radio = document.querySelector(`input[name="${key}"][value="${val}"]`);
            if (radio) radio.checked = true;
        }
    });

    // 3. Password Protected Toggles
    const deleteGroup = document.getElementById('group-allow-delete');
    const deleteToggle = document.getElementById('set-allow-delete');
    const maskGroup = document.getElementById('group-mask-mac');
    const maskToggle = document.getElementById('set-mask-mac');

    const toggleStatus = (toggle, group, isEnabled, key) => {
        if (!toggle) return;
        if (!isPasswordProtected) {
            toggle.disabled = true;
            toggle.checked = false;
            if (group) {
                group.style.opacity = '0.5';
                group.title = 'Requires APP_PASSWORD set in Docker';
            }
        } else {
            toggle.disabled = false;
            toggle.checked = String(appSettings[key]) === 'true';
            if (group) {
                group.style.opacity = '1';
                group.title = '';
            }
        }
    };

    toggleStatus(deleteToggle, deleteGroup, isPasswordProtected, 'allow_delete');
    toggleStatus(maskToggle, maskGroup, isPasswordProtected, 'mask_mac');

    // 4. Other Toggles & Selects
    const defaultLangSelect = document.getElementById('set-default-lang');
    const lockLangToggle = document.getElementById('set-lock-lang');
    if (defaultLangSelect) defaultLangSelect.value = appSettings.default_lang || 'en';
    if (lockLangToggle) lockLangToggle.checked = String(appSettings.lock_lang) === 'true';

    // 5. Cron Settings
    const cronWanEnable = document.getElementById('set-cron-wan-enable');
    const cronWanExpr = document.getElementById('set-cron-wan-expr');
    const cronWanPreset = document.getElementById('set-cron-wan-preset');
    const cronWanCustomWrapper = document.getElementById('cron-wan-custom-wrapper');

    if (cronWanEnable) cronWanEnable.checked = String(appSettings.cron_wan_enable) === 'true';
    if (cronWanExpr) cronWanExpr.value = appSettings.cron_wan_expr || '';

    const cronLanEnable = document.getElementById('set-cron-lan-enable');
    const cronLanExpr = document.getElementById('set-cron-lan-expr');
    const cronLanPreset = document.getElementById('set-cron-lan-preset');
    const cronLanCustomWrapper = document.getElementById('cron-lan-custom-wrapper');
    const cronLanTarget = document.getElementById('set-cron-lan-target');

    if (cronLanEnable) cronLanEnable.checked = String(appSettings.cron_lan_enable) === 'true';
    if (cronLanExpr) cronLanExpr.value = appSettings.cron_lan_expr || '';
    if (cronLanTarget) cronLanTarget.value = appSettings.cron_lan_target || '';

    // 6. Cron Presets Visibility
    const presets = ['*/15 * * * *', '*/30 * * * *', '0 * * * *', '0 */6 * * *', '0 */12 * * *', '0 0 * * *'];
    
    const updateCronUI = (expr, presetEl, wrapperEl) => {
        if (!presetEl || !wrapperEl) return;
        if (presets.includes(expr)) {
            presetEl.value = expr;
            wrapperEl.style.display = 'none';
        } else if (expr) {
            presetEl.value = 'custom';
            wrapperEl.style.display = 'block';
        }
    };

    updateCronUI(appSettings.cron_wan_expr, cronWanPreset, cronWanCustomWrapper);
    updateCronUI(appSettings.cron_lan_expr, cronLanPreset, cronLanCustomWrapper);
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
