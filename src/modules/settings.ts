/**
 * Settings page logic and authentication
 */

export interface SaveSettingsCallbacks {
    onSuccess?: () => void;
    onError?: (msg: string) => void;
}

export async function handleAuthCheck(): Promise<boolean> {
    try {
        const res = await fetch('/api/auth/check');
        const data = await res.json();
        return data.password_enabled;
    } catch (e) {
        console.error('Auth check failed:', e);
        return false;
    }
}

export async function handleAuthVerify(password: string): Promise<boolean> {
    const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    });
    return res.ok;
}

export function renderSettings(appSettings: any, isPasswordProtected: boolean) {
    // 1. Generic Select/Input fields
    const sets = [
        { id: 'set-timezone', key: 'timezone' },
        { id: 'set-wan-engine', key: 'wan_engine' },
        { id: 'set-history-retention', key: 'history_retention' }
    ];

    sets.forEach(s => {
        const el = document.getElementById(s.id) as HTMLInputElement | HTMLSelectElement | null;
        if (el) el.value = appSettings[s.key] || '';
    });

    // 2. Radio Units (WAN)
    const val = appSettings['wan_unit'];
    if (val) {
        const radio = document.querySelector(`input[name="wan_unit"][value="${val}"]`) as HTMLInputElement | null;
        if (radio) radio.checked = true;
    }

    // 3. Password Protected Toggles
    const deleteGroup = document.getElementById('group-allow-delete');
    const deleteToggle = document.getElementById('set-allow-delete') as HTMLInputElement | null;

    const toggleStatus = (
        toggle: HTMLInputElement | null,
        group: HTMLElement | null,
        isEnabled: boolean,
        key: string
    ) => {
        if (!toggle) return;
        if (!isEnabled) {
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

    // 4. Other Toggles & Selects
    const defaultLangSelect = document.getElementById('set-default-lang') as HTMLSelectElement | null;
    const lockLangToggle = document.getElementById('set-lock-lang') as HTMLInputElement | null;
    if (defaultLangSelect) defaultLangSelect.value = appSettings.default_lang || 'en';
    if (lockLangToggle) lockLangToggle.checked = String(appSettings.lock_lang) === 'true';

    // 5. Cron Settings
    const cronWanEnable = document.getElementById('set-cron-wan-enable') as HTMLInputElement | null;
    const cronWanExpr = document.getElementById('set-cron-wan-expr') as HTMLInputElement | null;
    const cronWanPreset = document.getElementById('set-cron-wan-preset') as HTMLSelectElement | null;
    const cronWanCustomWrapper = document.getElementById('cron-wan-custom-wrapper');

    if (cronWanEnable) cronWanEnable.checked = String(appSettings.cron_wan_enable) === 'true';
    if (cronWanExpr) cronWanExpr.value = appSettings.cron_wan_expr || '';

    // 6. Cron Presets Visibility
    const presets = ['*/15 * * * *', '*/30 * * * *', '0 * * * *', '0 */6 * * *', '0 */12 * * *', '0 0 * * *'];
    
    const updateCronUI = (
        expr: string,
        presetEl: HTMLSelectElement | null,
        wrapperEl: HTMLElement | null
    ) => {
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
}

export async function saveSettings(
    appSettings: any,
    currentTranslations: Record<string, string>,
    uiCallbacks: SaveSettingsCallbacks
) {
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
