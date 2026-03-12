/**
 * DOM elements, view switching, and modal management
 */

export function switchMainView(viewId, callbacks = {}) {
    document.querySelectorAll('.main-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
    
    const tabIndex = viewId === 'test' ? 0 : (viewId === 'history' ? 1 : 2);
    const targetTab = document.querySelectorAll('.main-tabs .tab-btn')[tabIndex];
    if (targetTab) targetTab.classList.add('active');

    document.getElementById('view-test').style.display = viewId === 'test' ? 'block' : 'none';
    document.getElementById('view-history').style.display = viewId === 'history' ? 'block' : 'none';
    document.getElementById('view-settings').style.display = viewId === 'settings' ? 'block' : 'none';

    if (viewId === 'history' && callbacks.onHistory) {
        callbacks.onHistory();
    } else if (viewId === 'settings' && callbacks.onSettings) {
        callbacks.onSettings();
    }

    const navMenu = document.getElementById('nav-menu');
    if (navMenu) navMenu.classList.remove('active');
}

export function showToast(msg, type = 'success') {
    const toaster = document.getElementById('toaster');
    if (!toaster) return;

    const toast = document.createElement('div');
    toast.className = `toast glass ${type}`;
    
    let icon = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    if (type === 'error') {
        icon = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    }

    toast.innerHTML = `
        <div class="toast-icon" style="color: ${type === 'error' ? '#ef4444' : 'var(--accent-success)'}">
            ${icon}
        </div>
        <span>${msg}</span>
    `;

    toaster.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

export function showConfirmModal(titleText, messageText, onConfirm) {
    const modal = document.getElementById('confirm-modal');
    const title = document.getElementById('confirm-title');
    const message = document.getElementById('confirm-message');
    const cancelBtn = document.getElementById('btn-confirm-cancel');
    const proceedBtn = document.getElementById('btn-confirm-proceed');

    title.textContent = titleText;
    message.textContent = messageText;
    
    proceedBtn.onclick = () => {
        modal.style.display = 'none';
        if (onConfirm) onConfirm();
    };

    cancelBtn.onclick = () => {
        modal.style.display = 'none';
    };

    modal.style.display = 'flex';
}
