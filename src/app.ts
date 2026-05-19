/**
 * NetPaceX Application Orchestrator
 */

import { currentLang, currentTranslations, changeLanguage } from './modules/i18n';
import { switchMainView, showToast, showConfirmModal } from './modules/ui';
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
} from './modules/history';
import { renderHistoryChart } from './modules/charts';
import { startLANTest } from './modules/test_lan';
import { startWANTest } from './modules/test_wan';
import { handleAuthCheck, handleAuthVerify, renderSettings, saveSettings } from './modules/settings';

// Global App State
interface AppSettings {
    timezone: string;
    wan_unit: string;
    lan_unit: string;
    mask_mac: string;
    allow_delete: string;
    default_lang: string;
    lock_lang: string;
    cron_wan_enable: string;
    cron_wan_expr: string;
    cron_lan_enable: string;
    cron_lan_expr: string;
    cron_lan_target: string;
    wan_engine: string;
    history_retention: string;
    [key: string]: string;
}

let appSettings: AppSettings = {
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
    wan_engine: 'mlab',
    history_retention: '0'
};

let isPasswordProtected = false;
let originalSettings: AppSettings = { ...appSettings };
let currentView = 'test';
let securityCallback: (() => void) | null = null;
let securityCancelCallback: (() => void) | null = null;
let connTypeCallback: ((type: string) => void) | null = null;

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
    const navigate = (viewId: string) => {
        if (currentView === 'settings' && viewId !== 'settings') {
            appSettings = { ...originalSettings };
        }
        currentView = viewId;
        switchMainView(viewId, { 
            onHistory: renderAllHistory, 
            onSettings: () => renderSettings(appSettings, isPasswordProtected) 
        });
    };

    const navTest = document.getElementById('nav-test');
    if (navTest) navTest.onclick = () => navigate('test');
    
    const navHistory = document.getElementById('nav-history');
    if (navHistory) navHistory.onclick = () => navigate('history');
    
    const navSettings = document.getElementById('nav-settings');
    if (navSettings) navSettings.onclick = () => navigate('settings');

    // Menu Toggle
    const menuToggle = document.getElementById('menu-toggle');
    const navMenu = document.getElementById('nav-menu');
    if (menuToggle && navMenu) {
        menuToggle.onclick = (e) => {
            e.stopPropagation();
            navMenu.classList.toggle('active');
        };
        document.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (navMenu.classList.contains('active') && !navMenu.contains(target) && target !== menuToggle) {
                navMenu.classList.remove('active');
            }
        });
    }

    // Language Selector
    const langSelect = document.getElementById('lang-select') as HTMLSelectElement | null;
    if (langSelect) {
        langSelect.value = currentLang;
        langSelect.onchange = async (e) => {
            const target = e.target as HTMLSelectElement;
            await changeLanguage(target.value);
            renderAllHistory();
        };
    }

    // Launchers
    const btnLauncherWan = document.getElementById('btn-launcher-wan');
    if (btnLauncherWan) btnLauncherWan.onclick = () => initWANTest();
    
    const btnLauncherLan = document.getElementById('btn-launcher-lan');
    if (btnLauncherLan) btnLauncherLan.onclick = () => initLANTest();
    
    const btnWan = document.getElementById('btn-wan');
    if (btnWan) btnWan.onclick = () => initWANTest();
    
    const btnLan = document.getElementById('btn-lan');
    if (btnLan) btnLan.onclick = () => initLANTest();

    // Close buttons
    const btnCloseWan = document.getElementById('btn-close-wan');
    if (btnCloseWan) btnCloseWan.onclick = () => closeTestCard('wan');
    
    const btnCloseLan = document.getElementById('btn-close-lan');
    if (btnCloseLan) btnCloseLan.onclick = () => closeTestCard('lan');

    // History Tabs
    const tabWanHistory = document.getElementById('tab-wan-history');
    if (tabWanHistory) {
        tabWanHistory.onclick = () => {
            setCurrentHistoryTab('wan');
            setCurrentPage(1);
            const tabWan = document.getElementById('tab-wan-history');
            if (tabWan) tabWan.classList.add('active');
            const tabLan = document.getElementById('tab-lan-history');
            if (tabLan) tabLan.classList.remove('active');
            renderAllHistory();
        };
    }
    
    const tabLanHistory = document.getElementById('tab-lan-history');
    if (tabLanHistory) {
        tabLanHistory.onclick = () => {
            setCurrentHistoryTab('lan');
            setCurrentPage(1);
            const tabLan = document.getElementById('tab-lan-history');
            if (tabLan) tabLan.classList.add('active');
            const tabWan = document.getElementById('tab-wan-history');
            if (tabWan) tabWan.classList.remove('active');
            renderAllHistory();
        };
    }

    // Pagination
    const btnPrev = document.getElementById('btn-prev');
    if (btnPrev) {
        btnPrev.onclick = () => {
            if (currentPage > 1) {
                setCurrentPage(currentPage - 1);
                renderAllHistory();
            }
        };
    }
    
    const btnNext = document.getElementById('btn-next');
    if (btnNext) {
        btnNext.onclick = () => {
            const data = currentHistoryTab === 'wan' ? wanHistoryData : lanHistoryData;
            const totalPages = Math.ceil(data.length / ITEMS_PER_PAGE);
            if (currentPage < totalPages) {
                setCurrentPage(currentPage + 1);
                renderAllHistory();
            }
        };
    }

    // Settings Inputs
    const setIds = ['set-timezone', 'set-wan-engine', 'set-default-lang', 'set-lock-lang', 'set-cron-wan-enable', 'set-cron-wan-preset', 'set-cron-wan-expr', 'set-cron-lan-enable', 'set-cron-lan-preset', 'set-cron-lan-expr', 'set-cron-lan-target', 'set-mask-mac', 'set-allow-delete', 'set-history-retention'];
    setIds.forEach(id => {
        const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
        if (el) {
            const eventType = el.tagName === 'SELECT' || (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) ? 'change' : 'input';
            el.addEventListener(eventType, (e) => {
                const target = e.target as HTMLInputElement | HTMLSelectElement;
                let val = (target instanceof HTMLInputElement && target.type === 'checkbox') ? target.checked : target.value;
                const key = id.replace('set-', '').replace(/-/g, '_');
                
                if (id.endsWith('-preset')) {
                    handleCronPresetChange(id.split('-')[2], String(val));
                } else {
                    appSettings[key] = String(val);
                }
            });
        }
    });

    // Radio units
    document.querySelectorAll('input[name="wan_unit"]').forEach(r => {
        r.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            appSettings.wan_unit = target.value;
        });
    });
    document.querySelectorAll('input[name="lan_unit"]').forEach(r => {
        r.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            appSettings.lan_unit = target.value;
        });
    });

    const btnSaveSettings = document.getElementById('btn-save-settings');
    if (btnSaveSettings) btnSaveSettings.onclick = saveAllSettings;

    // Modals
    const btnSecurityCancel = document.getElementById('btn-security-cancel');
    if (btnSecurityCancel) btnSecurityCancel.onclick = () => closeSecurityModal();
    
    const btnCloseDetails = document.getElementById('btn-close-details');
    if (btnCloseDetails) btnCloseDetails.onclick = closeDetailsModal;
    
    // Connection Type Buttons
    const btnConnWifi = document.getElementById('btn-conn-wifi');
    if (btnConnWifi) btnConnWifi.onclick = () => submitConnType('Wi-Fi');
    
    const btnConnEthernet = document.getElementById('btn-conn-ethernet');
    if (btnConnEthernet) btnConnEthernet.onclick = () => submitConnType('Ethernet');
    
    const btnConnLocalhost = document.getElementById('btn-conn-localhost');
    if (btnConnLocalhost) btnConnLocalhost.onclick = () => submitConnType('Localhost');

    // Timezone list fetch
    fetch('/api/timezones')
        .then(r => r.json())
        .then((zones: string[]) => {
            const tzSelect = document.getElementById('set-timezone') as HTMLSelectElement | null;
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

    // Settings Sidebar Tabs
    document.querySelectorAll('.settings-nav-btn').forEach(btn => {
        const htmlBtn = btn as HTMLButtonElement;
        htmlBtn.onclick = () => {
            const tabId = htmlBtn.getAttribute('data-tab');
            if (tabId) switchSettingsTab(tabId);
        };
    });
}

function handleCronPresetChange(type: string, value: string) {
    const customWrapper = document.getElementById(`cron-${type}-custom-wrapper`);
    const exprInput = document.getElementById(`set-cron-${type}-expr`) as HTMLInputElement | null;

    if (customWrapper) {
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
}

async function saveAllSettings() {
    const maskChanged = appSettings.mask_mac !== originalSettings.mask_mac;
    const deleteChanged = appSettings.allow_delete !== originalSettings.allow_delete;

    const rollback = () => {
        appSettings = { ...originalSettings };
        renderSettings(appSettings, isPasswordProtected);
    };

    if (isPasswordProtected && (maskChanged || deleteChanged)) {
        openSecurityModal(() => {
            performSave();
        }, rollback);
    } else {
        await performSave();
    }
}

async function performSave() {
    const btn = document.getElementById('btn-save-settings') as HTMLButtonElement | null;
    if (!btn) return;
    const originalText = btn.textContent || 'Save Changes';
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

function switchSettingsTab(tabId: string) {
    // Buttons active state
    document.querySelectorAll('.settings-nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });

    // Content area visibility
    document.querySelectorAll('.settings-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === tabId);
    });
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
            const btnWan = document.getElementById('btn-wan') as HTMLButtonElement | null;
            if (btnWan) btnWan.disabled = true;
            const btnLan = document.getElementById('btn-lan') as HTMLButtonElement | null;
            if (btnLan) btnLan.disabled = true;
        },
        onError: (err) => showToast(err, 'error'),
        onEnd: () => {
            const btnWan = document.getElementById('btn-wan') as HTMLButtonElement | null;
            if (btnWan) btnWan.disabled = false;
            const btnLan = document.getElementById('btn-lan') as HTMLButtonElement | null;
            if (btnLan) btnLan.disabled = false;
        }
    }, () => {
        const btnWan = document.getElementById('btn-wan') as HTMLButtonElement | null;
        if (btnWan) btnWan.disabled = false;
        const btnLan = document.getElementById('btn-lan') as HTMLButtonElement | null;
        if (btnLan) btnLan.disabled = false;
        
        const closeBtn = document.querySelector('#wan-card .card-close-btn');
        if (closeBtn) closeBtn.classList.add('visible');
        
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
                const btnWan = document.getElementById('btn-wan') as HTMLButtonElement | null;
                if (btnWan) btnWan.disabled = true;
                const btnLan = document.getElementById('btn-lan') as HTMLButtonElement | null;
                if (btnLan) btnLan.disabled = true;
            },
            onEnd: () => {
                const btnWan = document.getElementById('btn-wan') as HTMLButtonElement | null;
                if (btnWan) btnWan.disabled = false;
                const btnLan = document.getElementById('btn-lan') as HTMLButtonElement | null;
                if (btnLan) btnLan.disabled = false;
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
                const closeBtn = document.querySelector('#lan-card .card-close-btn');
                if (closeBtn) closeBtn.classList.add('visible');
            });
        }
    );
}

function showTestView(type: 'wan' | 'lan') {
    const launcher = document.getElementById('test-launcher');
    if (launcher) launcher.style.display = 'none';
    
    const resultsGrid = document.querySelector('.results-grid') as HTMLElement | null;
    if (resultsGrid) resultsGrid.style.display = 'grid';
    
    const wanCard = document.getElementById('wan-card');
    if (wanCard) wanCard.style.display = type === 'wan' ? 'flex' : 'none';
    
    const lanCard = document.getElementById('lan-card');
    if (lanCard) lanCard.style.display = type === 'lan' ? 'flex' : 'none';
    
    const card = document.getElementById(`${type}-card`);
    if (card) {
        const closeBtn = card.querySelector('.card-close-btn');
        if (closeBtn) closeBtn.classList.remove('visible');
    }
}

function closeTestCard(type: string) {
    const launcher = document.getElementById('test-launcher');
    if (launcher) launcher.style.display = 'grid';
    
    const resultsGrid = document.querySelector('.results-grid') as HTMLElement | null;
    if (resultsGrid) resultsGrid.style.display = 'none';
}

// Modals
function openDetailsModal(item: any, isWan: boolean) {
    const modal = document.getElementById('details-modal');
    if (!modal) return;

    const titleTarget = document.getElementById('modal-title-target');
    if (titleTarget) titleTarget.textContent = currentTranslations['modal_title_wan'] || 'Test Details';
    
    const modalDate = document.getElementById('modal-date');
    if (modalDate) modalDate.textContent = item.test_date;
    
    const modalBadge = document.getElementById('modal-badge');
    if (modalBadge) {
        modalBadge.textContent = isWan ? (currentTranslations['badge_wan'] || 'Internet') : (currentTranslations['badge_lan'] || 'LAN');
        modalBadge.className = `modal-badge ${isWan ? 'wan' : 'lan'}`;
    }

    const modalTarget = document.getElementById('modal-target');
    if (modalTarget) {
        modalTarget.textContent = isWan ? item.server_name : `${item.ip_address} (${item.conn_type})`;
    }
    
    const unit = isWan ? appSettings.wan_unit : appSettings.lan_unit;
    const div = unit === 'Gbps' ? 1000 : 1;
    
    const modalDownload = document.getElementById('modal-download');
    if (modalDownload) {
        modalDownload.textContent = (item.download_mbps / div).toFixed(isWan ? (unit === 'Gbps' ? 3 : 1) : 1);
    }
    
    const modalUpload = document.getElementById('modal-upload');
    if (modalUpload) {
        modalUpload.textContent = (item.upload_mbps / div).toFixed(isWan ? (unit === 'Gbps' ? 3 : 1) : 1);
    }
    
    const modalPingAvg = document.getElementById('modal-ping-avg');
    if (modalPingAvg) modalPingAvg.textContent = item.ping_ms ? item.ping_ms.toFixed(1) : '--';
    
    const modalPingJitter = document.getElementById('modal-ping-jitter');
    if (modalPingJitter) modalPingJitter.textContent = item.jitter_ms ? item.jitter_ms.toFixed(1) : '--';
    
    const modalPingMin = document.getElementById('modal-ping-min');
    if (modalPingMin) modalPingMin.textContent = item.min_ping_ms ? item.min_ping_ms.toFixed(1) : '--';
    
    const modalPingMax = document.getElementById('modal-ping-max');
    if (modalPingMax) modalPingMax.textContent = item.max_ping_ms ? item.max_ping_ms.toFixed(1) : '--';

    modal.style.display = 'flex';
}

function closeDetailsModal() {
    const modal = document.getElementById('details-modal');
    if (modal) modal.style.display = 'none';
}

async function deleteHistoryItem(type: string, id: number) {
    if (!appSettings.allow_delete || appSettings.allow_delete === 'false') {
        showToast(currentTranslations['msg_del_disabled'] || 'Deletion is disabled', 'error');
        return;
    }
    const title = currentTranslations['modal_confirm_title'] || 'Confirm Deletion';
    const msg = currentTranslations['msg_confirm_delete'] || 'Are you sure you want to delete this item?';
    
    showConfirmModal(title, msg, async () => {
        const res = await fetch(`/api/${type}/history/delete?id=${id}`, { method: 'POST' });
        if (res.ok) {
            showToast(currentTranslations['msg_delete_success'] || 'Deleted successfully');
            await fetchHistory(renderAllHistory, () => updateAverages(appSettings));
        } else {
            showToast('Error deleting record', 'error');
        }
    });
}

function openSecurityModal(onConfirm: () => void, onCancel: () => void) {
    securityCallback = onConfirm;
    securityCancelCallback = onCancel;
    const modal = document.getElementById('security-modal');
    if (!modal) return;

    const pwdContainer = document.getElementById('password-field-container');
    const pwdInput = document.getElementById('security-password') as HTMLInputElement | null;
    const confirmBtn = document.getElementById('btn-security-confirm') as HTMLButtonElement | null;

    if (pwdInput) pwdInput.value = '';
    if (pwdContainer) pwdContainer.style.display = isPasswordProtected ? 'block' : 'none';
    modal.style.display = 'flex';

    if (confirmBtn) {
        confirmBtn.onclick = async () => {
            if (isPasswordProtected && pwdInput) {
                const ok = await handleAuthVerify(pwdInput.value);
                if (ok) {
                    if (securityCallback) securityCallback();
                    closeSecurityModal(false);
                } else {
                    pwdInput.classList.add('error-shake');
                    setTimeout(() => pwdInput.classList.remove('error-shake'), 500);
                }
            } else {
                if (securityCallback) securityCallback();
                closeSecurityModal(false);
            }
        };
    }
}

function closeSecurityModal(isCancel = true) {
    const modal = document.getElementById('security-modal');
    if (modal) modal.style.display = 'none';
    if (isCancel && securityCancelCallback) {
        securityCancelCallback();
    }
    securityCallback = null;
    securityCancelCallback = null;
}

function handleUnmaskMAC(fullMAC: string, cellEl: HTMLElement) {
    openSecurityModal(() => {
        cellEl.textContent = fullMAC;
        cellEl.onclick = null;
        cellEl.style.cursor = 'default';
        cellEl.title = '';
    }, () => {});
}

function showConnTypeModal(callback: (type: string) => void) {
    connTypeCallback = callback;
    const modal = document.getElementById('conn-type-modal');
    if (modal) modal.style.display = 'flex';
}

function submitConnType(type: string) {
    const modal = document.getElementById('conn-type-modal');
    if (modal) modal.style.display = 'none';
    if (connTypeCallback) {
        connTypeCallback(type);
        connTypeCallback = null;
    }
}
