/**
 * NetPaceX Application Orchestrator
 */

import { currentLang, currentTranslations, changeLanguage } from './modules/i18n.js';
import { switchMainView, showToast, showConfirmModal } from './modules/ui.js';
import { 
    fetchHistory, 
    updateAverages, 
    renderHistoryTable, 
    wanHistoryData, 
    lanHistoryData, 
    currentHistoryTab, 
    setCurrentHistoryTab,
    currentPage,
    setCurrentPage,
    ITEMS_PER_PAGE
} from './modules/history.js';
import { renderHistoryChart } from './modules/charts.js';
import { startLANTest } from './modules/test_lan.js';
import { startWANTest } from './modules/test_wan.js';
import { handleAuthCheck, handleAuthVerify, renderSettings, saveSettings } from './modules/settings.js';

// Global App State
let appSettings = {
    timezone: 'UTC',
    wan_unit: 'Mbps',
    lan_unit: 'Mbps',
    mask_mac: 'true',
    allow_delete: 'false',
    default_lang: 'en',
    lock_lang: 'false',
    cron_wan_enable: 'false',
    cron_wan_expr: '0 * * * *',
    cron_lan_enable: 'false',
    cron_lan_expr: '30 * * * *',
    cron_lan_target: '',
    wan_engine: 'mlab'
};

let isPasswordProtected = false;
let originalSettings = {};
let securityCallback = null;
let connTypeCallback = null;

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Load Translations
    await changeLanguage(currentLang);
    
    // 2. Auth Check
    isPasswordProtected = await handleAuthCheck();
    
    // 3. Load Settings & History
    await refreshAppSettings();
    await fetchHistory(renderAllHistory, () => updateAverages(appSettings));

    // 4. Initial Routing (ensure switcher visibility)
    applyHeaderSwitcher();

    // 5. Setup Event Listeners
    setupEventListeners();
});

async function refreshAppSettings() {
    try {
        const res = await fetch('/api/settings');
        if (res.ok) {
            const data = await res.json();
            appSettings = { ...appSettings, ...data };
            originalSettings = { ...appSettings };
            updateUnitLabels();
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
}

function renderAllHistory() {
    updateAverages(appSettings);
    renderHistoryChart(wanHistoryData, lanHistoryData, currentHistoryTab, appSettings, currentTranslations);
    renderHistoryTable(appSettings, currentTranslations, openDetailsModal, deleteHistoryItem, handleUnmaskMAC);
}

function setupEventListeners() {
    // Nav Tabs
    document.getElementById('nav-test').onclick = () => switchMainView('test', { onHistory: renderAllHistory, onSettings: () => renderSettings(appSettings, isPasswordProtected) });
    document.getElementById('nav-history').onclick = () => switchMainView('history', { onHistory: renderAllHistory, onSettings: () => renderSettings(appSettings, isPasswordProtected) });
    document.getElementById('nav-settings').onclick = () => switchMainView('settings', { onHistory: renderAllHistory, onSettings: () => renderSettings(appSettings, isPasswordProtected) });

    // Menu Toggle
    const menuToggle = document.getElementById('menu-toggle');
    const navMenu = document.getElementById('nav-menu');
    if (menuToggle && navMenu) {
        menuToggle.onclick = (e) => {
            e.stopPropagation();
            navMenu.classList.toggle('active');
        };
        document.addEventListener('click', (e) => {
            if (navMenu.classList.contains('active') && !navMenu.contains(e.target) && e.target !== menuToggle) {
                navMenu.classList.remove('active');
            }
        });
    }

    // Language Selector
    const langSelect = document.getElementById('lang-select');
    if (langSelect) {
        langSelect.value = currentLang;
        langSelect.onchange = async (e) => {
            await changeLanguage(e.target.value);
            renderAllHistory();
        };
    }

    // Launchers
    document.getElementById('btn-launcher-wan').onclick = () => initWANTest();
    document.getElementById('btn-launcher-lan').onclick = () => initLANTest();
    document.getElementById('btn-wan').onclick = () => initWANTest();
    document.getElementById('btn-lan').onclick = () => initLANTest();

    // Close buttons
    document.getElementById('btn-close-wan').onclick = () => closeTestCard('wan');
    document.getElementById('btn-close-lan').onclick = () => closeTestCard('lan');

    // History Tabs
    document.getElementById('tab-wan-history').onclick = () => {
        setCurrentHistoryTab('wan');
        setCurrentPage(1);
        document.getElementById('tab-wan-history').classList.add('active');
        document.getElementById('tab-lan-history').classList.remove('active');
        renderAllHistory();
    };
    document.getElementById('tab-lan-history').onclick = () => {
        setCurrentHistoryTab('lan');
        setCurrentPage(1);
        document.getElementById('tab-lan-history').classList.add('active');
        document.getElementById('tab-wan-history').classList.remove('active');
        renderAllHistory();
    };

    // Pagination
    document.getElementById('btn-prev').onclick = () => {
        if (currentPage > 1) {
            setCurrentPage(currentPage - 1);
            renderAllHistory();
        }
    };
    document.getElementById('btn-next').onclick = () => {
        const data = currentHistoryTab === 'wan' ? wanHistoryData : lanHistoryData;
        const totalPages = Math.ceil(data.length / ITEMS_PER_PAGE);
        if (currentPage < totalPages) {
            setCurrentPage(currentPage + 1);
            renderAllHistory();
        }
    };

    // Settings Inputs
    const setIds = ['set-timezone', 'set-wan-engine', 'set-default-lang', 'set-lock-lang', 'set-cron-wan-enable', 'set-cron-wan-preset', 'set-cron-wan-expr', 'set-cron-lan-enable', 'set-cron-lan-preset', 'set-cron-lan-expr', 'set-cron-lan-target', 'set-mask-mac', 'set-allow-delete'];
    setIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const eventType = el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'radio' ? 'change' : 'input';
            el.addEventListener(eventType, (e) => {
                let val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
                const key = id.replace('set-', '').replace(/-/g, '_');
                
                if (id.endsWith('-preset')) {
                    handleCronPresetChange(id.split('-')[2], val);
                } else {
                    appSettings[key] = String(val);
                }
            });
        }
    });

    // Radio units
    document.querySelectorAll('input[name="wan_unit"]').forEach(r => {
        r.addEventListener('change', (e) => appSettings.wan_unit = e.target.value);
    });
    document.querySelectorAll('input[name="lan_unit"]').forEach(r => {
        r.addEventListener('change', (e) => appSettings.lan_unit = e.target.value);
    });

    document.getElementById('btn-save-settings').onclick = saveAllSettings;

    // Modals
    document.getElementById('btn-security-cancel').onclick = closeSecurityModal;
    document.getElementById('btn-close-details').onclick = closeDetailsModal;
    
    // Connection Type Buttons
    document.getElementById('btn-conn-wifi').onclick = () => submitConnType('Wi-Fi');
    document.getElementById('btn-conn-ethernet').onclick = () => submitConnType('Ethernet');
    document.getElementById('btn-conn-localhost').onclick = () => submitConnType('Localhost');

    // Timezone list fetch
    fetch('/api/timezones')
        .then(r => r.json())
        .then(zones => {
            const tzSelect = document.getElementById('set-timezone');
            if (tzSelect) {
                zones.forEach(tz => {
                    const opt = document.createElement('option');
                    opt.value = tz;
                    opt.textContent = tz;
                    tzSelect.appendChild(opt);
                });
                tzSelect.value = appSettings.timezone;
            }
        });
}

function handleCronPresetChange(type, value) {
    const customWrapper = document.getElementById(`cron-${type}-custom-wrapper`);
    const exprInput = document.getElementById(`set-cron-${type}-expr`);

    if (value === 'custom') {
        customWrapper.style.display = 'block';
    } else {
        customWrapper.style.display = 'none';
        if (exprInput) {
            exprInput.value = value;
            appSettings[`cron_${type}_expr`] = value;
        }
    }
}

async function saveAllSettings() {
    const maskChanged = appSettings.mask_mac !== originalSettings.mask_mac;
    const deleteChanged = appSettings.allow_delete !== originalSettings.allow_delete;

    if (isPasswordProtected && (maskChanged || deleteChanged)) {
        openSecurityModal(() => {
            performSave();
        });
    } else {
        await performSave();
    }
}

async function performSave() {
    const btn = document.getElementById('btn-save-settings');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = currentTranslations['btn_saving'] || 'Saving...';

    await saveSettings(appSettings, currentTranslations, {
        onSuccess: async () => {
            originalSettings = { ...appSettings };
            showToast(currentTranslations['msg_settings_saved'] || 'Settings saved successfully');
            updateUnitLabels();
            applyHeaderSwitcher();
            await fetchHistory(renderAllHistory, () => updateAverages(appSettings));
        },
        onError: (msg) => showToast(msg, 'error')
    });

    btn.disabled = false;
    btn.textContent = originalText;
}

function applyHeaderSwitcher() {
    const langHeaderSwitcher = document.getElementById('lang-select');
    if (langHeaderSwitcher) {
        if (appSettings.lock_lang === 'true') {
            langHeaderSwitcher.style.display = 'none';
            if (currentLang !== appSettings.default_lang) {
                changeLanguage(appSettings.default_lang);
            }
        } else {
            langHeaderSwitcher.style.display = 'block';
        }
    }
}

function updateUnitLabels() {
    document.querySelectorAll('#wan-card [data-i18n="unit_mbps"]').forEach(el => el.textContent = appSettings.wan_unit);
    document.querySelectorAll('#lan-card [data-i18n="unit_mbps"]').forEach(el => el.textContent = appSettings.lan_unit);
    
    // Average cards
    const units = {
        'avg-wan-download': appSettings.wan_unit,
        'avg-wan-upload': appSettings.wan_unit,
        'avg-lan-download': appSettings.lan_unit,
        'avg-lan-upload': appSettings.lan_unit
    };
    for (const [id, unit] of Object.entries(units)) {
        const el = document.getElementById(id);
        if (el && el.nextElementSibling) el.nextElementSibling.textContent = unit;
    }

    document.querySelectorAll('.unit-wan').forEach(el => el.textContent = appSettings.wan_unit);
    document.querySelectorAll('.unit-lan').forEach(el => el.textContent = appSettings.lan_unit);
}

// Test Orchestration
function initWANTest() {
    showTestView('wan');
    startWANTest(currentTranslations, {
        onStart: () => {
            document.getElementById('btn-wan').disabled = true;
            document.getElementById('btn-lan').disabled = true;
        },
        onError: (err) => showToast(err, 'error'),
        onEnd: () => {
            document.getElementById('btn-wan').disabled = false;
            document.getElementById('btn-lan').disabled = false;
        }
    }, () => {
        document.getElementById('btn-wan').disabled = false;
        document.getElementById('btn-lan').disabled = false;
        document.querySelector('#wan-card .card-close-btn').classList.add('visible');
        fetchHistory(renderAllHistory, () => updateAverages(appSettings));
    });
}

function initLANTest() {
    showTestView('lan');
    startLANTest(
        { DL_SIZE_MB: 20, UL_SIZE_MB: 10 },
        currentTranslations,
        {
            onStart: () => {
                document.getElementById('btn-wan').disabled = true;
                document.getElementById('btn-lan').disabled = true;
            },
            onEnd: () => {
                document.getElementById('btn-wan').disabled = false;
                document.getElementById('btn-lan').disabled = false;
            }
        },
        async (results) => {
            showConnTypeModal(async (connType) => {
                try {
                    await fetch('/api/lan/save', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...results, conn_type: connType })
                    });
                    showToast(currentTranslations['msg_save_success'] || 'LAN results saved');
                    await fetchHistory(renderAllHistory, () => updateAverages(appSettings));
                } catch (e) {
                    showToast('Failed to save LAN results', 'error');
                }
                document.querySelector('#lan-card .card-close-btn').classList.add('visible');
            });
        }
    );
}

function showTestView(type) {
    document.getElementById('test-launcher').style.display = 'none';
    document.querySelector('.results-grid').style.display = 'grid';
    document.getElementById('wan-card').style.display = type === 'wan' ? 'flex' : 'none';
    document.getElementById('lan-card').style.display = type === 'lan' ? 'flex' : 'none';
    const card = document.getElementById(`${type}-card`);
    card.querySelector('.card-close-btn').classList.remove('visible');
}

function closeTestCard(type) {
    document.getElementById('test-launcher').style.display = 'grid';
    document.querySelector('.results-grid').style.display = 'none';
}

// Modals
function openDetailsModal(item, isWan) {
    const modal = document.getElementById('details-modal');
    document.getElementById('modal-title-target').textContent = currentTranslations['modal_title_wan'] || 'Test Details';
    document.getElementById('modal-date').textContent = item.test_date;
    document.getElementById('modal-badge').textContent = isWan ? (currentTranslations['badge_wan'] || 'Internet') : (currentTranslations['badge_lan'] || 'LAN');
    document.getElementById('modal-badge').className = `modal-badge ${isWan ? 'wan' : 'lan'}`;

    document.getElementById('modal-target').textContent = isWan ? item.server_name : `${item.ip_address} (${item.conn_type})`;
    
    const unit = isWan ? appSettings.wan_unit : appSettings.lan_unit;
    const div = unit === 'Gbps' ? 1000 : 1;
    
    document.getElementById('modal-download').textContent = (item.download_mbps / div).toFixed(isWan ? (unit === 'Gbps' ? 3 : 1) : 1);
    document.getElementById('modal-upload').textContent = (item.upload_mbps / div).toFixed(isWan ? (unit === 'Gbps' ? 3 : 1) : 1);
    
    document.getElementById('modal-ping-avg').textContent = item.ping_ms ? item.ping_ms.toFixed(1) : '--';
    document.getElementById('modal-ping-jitter').textContent = item.jitter_ms ? item.jitter_ms.toFixed(1) : '--';
    document.getElementById('modal-ping-min').textContent = item.min_ping_ms ? item.min_ping_ms.toFixed(1) : '--';
    document.getElementById('modal-ping-max').textContent = item.max_ping_ms ? item.max_ping_ms.toFixed(1) : '--';

    modal.style.display = 'flex';
}

function closeDetailsModal() {
    document.getElementById('details-modal').style.display = 'none';
}

async function deleteHistoryItem(type, id) {
    if (!appSettings.allow_delete || appSettings.allow_delete === 'false') {
        showToast(currentTranslations['msg_del_disabled'] || 'Deletion is disabled', 'error');
        return;
    }
    const title = currentTranslations['modal_confirm_title'] || 'Confirm Deletion';
    const msg = currentTranslations['msg_confirm_delete'] || 'Are you sure you want to delete this item?';
    
    showConfirmModal(title, msg, () => {
        openSecurityModal(async () => {
            const res = await fetch(`/api/${type}/history/delete?id=${id}`, { method: 'POST' });
            if (res.ok) {
                showToast(currentTranslations['msg_delete_success'] || 'Deleted successfully');
                await fetchHistory(renderAllHistory, () => updateAverages(appSettings));
            } else {
                showToast('Error deleting record', 'error');
            }
        });
    });
}

function openSecurityModal(onConfirm) {
    securityCallback = onConfirm;
    const modal = document.getElementById('security-modal');
    const pwdContainer = document.getElementById('password-field-container');
    const pwdInput = document.getElementById('security-password');
    const confirmBtn = document.getElementById('btn-security-confirm');

    pwdInput.value = '';
    pwdContainer.style.display = isPasswordProtected ? 'block' : 'none';
    modal.style.display = 'flex';

    confirmBtn.onclick = async () => {
        if (isPasswordProtected) {
            const ok = await handleAuthVerify(pwdInput.value);
            if (ok) {
                if (securityCallback) securityCallback();
                closeSecurityModal();
            } else {
                pwdInput.classList.add('error-shake');
                setTimeout(() => pwdInput.classList.remove('error-shake'), 500);
            }
        } else {
            if (securityCallback) securityCallback();
            closeSecurityModal();
        }
    };
}

function closeSecurityModal() {
    document.getElementById('security-modal').style.display = 'none';
    securityCallback = null;
}

function handleUnmaskMAC(fullMAC, cellEl) {
    openSecurityModal(() => {
        cellEl.textContent = fullMAC;
        cellEl.onclick = null;
        cellEl.style.cursor = 'default';
        cellEl.title = '';
    });
}

function showConnTypeModal(callback) {
    connTypeCallback = callback;
    document.getElementById('conn-type-modal').style.display = 'flex';
}

function submitConnType(type) {
    document.getElementById('conn-type-modal').style.display = 'none';
    if (connTypeCallback) {
        connTypeCallback(type);
        connTypeCallback = null;
    }
}
