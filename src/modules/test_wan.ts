/**
 * WAN speed test implementation
 */

export interface WANTestUICallbacks {
    onStart?: () => void;
    onError?: (err: any) => void;
    onEnd?: () => void;
}

export function startWANTest(
    currentTranslations: Record<string, string>,
    uiCallbacks: WANTestUICallbacks,
    onFinish?: () => void
) {
    const wanStatusEl = document.getElementById('wan-status');
    const wanServerInfoEl = document.getElementById('wan-server-info');
    const wanPingEl = document.getElementById('wan-ping');
    const wanJitterEl = document.getElementById('wan-jitter');
    const wanDlEl = document.getElementById('wan-dl');
    const wanUlEl = document.getElementById('wan-ul');
    const wanProgressEl = document.getElementById('wan-progress');

    // Reset UI
    if (wanStatusEl) {
        wanStatusEl.className = 'status-badge testing';
        wanStatusEl.textContent = currentTranslations['status_testing'] || 'Testing';
    }
    if (wanServerInfoEl) {
        wanServerInfoEl.textContent = currentTranslations['msg_locating_server'] || 'Locating best server...';
    }
    if (wanPingEl) wanPingEl.textContent = '--';
    if (wanJitterEl) wanJitterEl.textContent = '--';
    if (wanDlEl) wanDlEl.textContent = '--';
    if (wanUlEl) wanUlEl.textContent = '--';
    if (wanProgressEl) wanProgressEl.style.width = '10%';
    
    if (uiCallbacks.onStart) uiCallbacks.onStart();

    const elementsToReset = [wanPingEl, wanDlEl, wanUlEl];
    elementsToReset.forEach(el => {
        if (el) el.classList.remove('testing-active');
    });

    const eventSource = new EventSource('/api/wan/test');

    eventSource.onopen = function() {
        console.log("SSE Connection opened");
    };

    eventSource.onmessage = function(event) {
        const data = JSON.parse(event.data);
        console.log("WAN Event:", data);

        switch (data.type) {
            case 'info':
                if (data.info && wanServerInfoEl) {
                    wanServerInfoEl.textContent = data.info;
                }
                break;
            case 'ping':
                if (wanPingEl) {
                    wanPingEl.textContent = parseFloat(data.value).toFixed(1);
                    wanPingEl.classList.add('testing-active');
                }
                if (wanProgressEl) wanProgressEl.style.width = '30%';
                break;
            case 'jitter':
                if (wanJitterEl) wanJitterEl.textContent = parseFloat(data.value).toFixed(1);
                break;
            case 'download':
                if (wanPingEl) wanPingEl.classList.remove('testing-active');
                if (wanDlEl) {
                    wanDlEl.textContent = parseFloat(data.value).toFixed(1);
                    wanDlEl.classList.add('testing-active');
                }
                if (wanProgressEl) wanProgressEl.style.width = '60%';
                break;
            case 'upload':
                if (wanDlEl) wanDlEl.classList.remove('testing-active');
                if (wanUlEl) {
                    wanUlEl.textContent = parseFloat(data.value).toFixed(1);
                    wanUlEl.classList.add('testing-active');
                }
                if (wanProgressEl) wanProgressEl.style.width = '90%';
                break;
            case 'done':
                eventSource.close();
                if (wanUlEl) wanUlEl.classList.remove('testing-active');
                if (wanStatusEl) {
                    wanStatusEl.className = 'status-badge completed';
                    wanStatusEl.textContent = currentTranslations['status_completed'] || 'Completed';
                }
                if (data.info && wanServerInfoEl) {
                    wanServerInfoEl.textContent = data.info;
                }
                if (wanProgressEl) wanProgressEl.style.width = '100%';
                if (onFinish) onFinish();
                break;
            case 'error':
                eventSource.close();
                if (wanStatusEl) {
                    wanStatusEl.className = 'status-badge error';
                    wanStatusEl.textContent = currentTranslations['status_error'] || 'Error';
                }
                if (wanServerInfoEl) {
                    wanServerInfoEl.textContent = data.info || 'Unknown error';
                }
                if (uiCallbacks.onError) uiCallbacks.onError(data.info);
                if (onFinish) onFinish();
                break;
        }
    };

    eventSource.onerror = function(err) {
        console.error("SSE Error:", err);
        eventSource.close();
        if (uiCallbacks.onEnd) uiCallbacks.onEnd();
    };
}
