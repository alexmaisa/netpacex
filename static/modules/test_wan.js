/**
 * WAN speed test implementation
 */

export function startWANTest(currentTranslations, uiCallbacks, onFinish) {
    const wanStatusEl = document.getElementById('wan-status');
    const wanServerInfoEl = document.getElementById('wan-server-info');
    const wanPingEl = document.getElementById('wan-ping');
    const wanJitterEl = document.getElementById('wan-jitter');
    const wanDlEl = document.getElementById('wan-dl');
    const wanUlEl = document.getElementById('wan-ul');
    const wanProgressEl = document.getElementById('wan-progress');

    // Reset UI
    wanStatusEl.className = 'status-badge testing';
    wanStatusEl.textContent = currentTranslations['status_testing'] || 'Testing';
    wanServerInfoEl.textContent = currentTranslations['msg_locating_server'] || 'Locating best server...';
    wanPingEl.textContent = '--';
    if (wanJitterEl) wanJitterEl.textContent = '--';
    wanDlEl.textContent = '--';
    wanUlEl.textContent = '--';
    wanProgressEl.style.width = '10%';
    
    if (uiCallbacks.onStart) uiCallbacks.onStart();

    [wanPingEl, wanDlEl, wanUlEl].forEach(el => el.classList.remove('testing-active'));

    const eventSource = new EventSource('/api/wan/test');

    eventSource.onopen = function() {
        console.log("SSE Connection opened");
    };

    eventSource.onmessage = function(event) {
        const data = JSON.parse(event.data);
        console.log("WAN Event:", data);

        switch (data.type) {
            case 'info':
                if (data.info) {
                    wanServerInfoEl.textContent = data.info;
                }
                break;
            case 'ping':
                wanPingEl.textContent = parseFloat(data.value).toFixed(1);
                wanPingEl.classList.add('testing-active');
                wanProgressEl.style.width = '30%';
                break;
            case 'jitter':
                if (wanJitterEl) wanJitterEl.textContent = parseFloat(data.value).toFixed(1);
                break;
            case 'download':
                wanPingEl.classList.remove('testing-active');
                wanDlEl.textContent = parseFloat(data.value).toFixed(1);
                wanDlEl.classList.add('testing-active');
                wanProgressEl.style.width = '60%';
                break;
            case 'upload':
                wanDlEl.classList.remove('testing-active');
                wanUlEl.textContent = parseFloat(data.value).toFixed(1);
                wanUlEl.classList.add('testing-active');
                wanProgressEl.style.width = '90%';
                break;
            case 'done':
                eventSource.close();
                wanUlEl.classList.remove('testing-active');
                wanStatusEl.className = 'status-badge completed';
                wanStatusEl.textContent = currentTranslations['status_completed'] || 'Completed';
                wanProgressEl.style.width = '100%';
                if (onFinish) onFinish();
                break;
            case 'error':
                eventSource.close();
                wanStatusEl.className = 'status-badge error';
                wanStatusEl.textContent = currentTranslations['status_error'] || 'Error';
                wanServerInfoEl.textContent = data.info || 'Unknown error';
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
