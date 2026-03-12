/**
 * LAN speed test implementation
 */
import { sleep, generatePayload } from './utils.js';

let lanJitter = 0;
let lanMinPing = 0;
let lanMaxPing = 0;

export async function startLANTest(lanSettings, currentTranslations, uiCallbacks, saveCallback) {
    const lanPingEl = document.getElementById('lan-ping');
    const lanJitterDisplayEl = document.getElementById('lan-jitter-display');
    const lanDlEl = document.getElementById('lan-dl');
    const lanUlEl = document.getElementById('lan-ul');
    const lanProgressEl = document.getElementById('lan-progress');
    const lanStatusEl = document.getElementById('lan-status');

    // Reset UI
    lanStatusEl.className = 'status-badge testing';
    lanStatusEl.textContent = currentTranslations['status_testing'] || 'Testing';
    lanPingEl.textContent = '--';
    if (lanJitterDisplayEl) lanJitterDisplayEl.textContent = '--';
    lanDlEl.textContent = '--';
    lanUlEl.textContent = '--';
    lanProgressEl.style.width = '0%';
    
    if (uiCallbacks.onStart) uiCallbacks.onStart();

    try {
        // 1. measure Ping
        lanProgressEl.style.width = '10%';
        await measureLANPing(lanPingEl, lanJitterDisplayEl);
        lanProgressEl.style.width = '33%';
        
        // 2. measure Download
        await sleep(500);
        await measureLANDownload(lanDlEl, lanSettings.DL_SIZE_MB);
        lanProgressEl.style.width = '66%';
        
        // 3. measure Upload
        await sleep(500);
        await measureLANUpload(lanUlEl, lanSettings.UL_SIZE_MB);
        lanProgressEl.style.width = '100%';

        lanStatusEl.className = 'status-badge completed';
        lanStatusEl.textContent = currentTranslations['status_completed'] || 'Completed';

        if (saveCallback) {
            await saveCallback({
                ping: parseFloat(lanPingEl.textContent) || 0,
                jitter: lanJitter,
                min_ping: lanMinPing,
                max_ping: lanMaxPing,
                download: parseFloat(lanDlEl.textContent) || 0,
                upload: parseFloat(lanUlEl.textContent) || 0
            });
        }

    } catch (e) {
        console.error(e);
        lanStatusEl.className = 'status-badge error';
        lanStatusEl.textContent = currentTranslations['status_error'] || 'Error';
        if (uiCallbacks.onError) uiCallbacks.onError(e);
    } finally {
        if (uiCallbacks.onEnd) uiCallbacks.onEnd();
    }
}

async function measureLANPing(pingEl, jitterEl) {
    pingEl.classList.add('testing-active');
    let totalLatency = 0;
    const pings = 5;
    let latencies = [];

    for (let i = 0; i < pings; i++) {
        const start = performance.now();
        await fetch('/api/lan/ping', { cache: 'no-store' });
        const end = performance.now();
        const lat = end - start;
        totalLatency += lat;
        latencies.push(lat);
    }

    const avgLatency = totalLatency / pings;
    pingEl.textContent = avgLatency.toFixed(1);
    
    lanMinPing = Math.min(...latencies);
    lanMaxPing = Math.max(...latencies);
    
    let jitterSum = 0;
    for (let i = 1; i < latencies.length; i++) {
        jitterSum += Math.abs(latencies[i] - latencies[i-1]);
    }
    lanJitter = pings > 1 ? (jitterSum / (pings - 1)) : 0;
    if (jitterEl) jitterEl.textContent = lanJitter.toFixed(1);

    pingEl.classList.remove('testing-active');
}

async function measureLANDownload(dlEl, sizeMB) {
    dlEl.classList.add('testing-active');
    const start = performance.now();
    const response = await fetch(`/api/lan/download?size=${sizeMB}`, { cache: 'no-store' });
    
    if (response.status === 409) {
        throw new Error(await response.text());
    }
    if (!response.ok) throw new Error('Download failed');
    
    const reader = response.body.getReader();
    let receivedLength = 0;

    while(true) {
        const {done, value} = await reader.read();
        if (done) break;
        receivedLength += value.length;
    }

    const end = performance.now();
    const durationSeconds = (end - start) / 1000;
    const bitsLoaded = receivedLength * 8;
    const speedMbps = (bitsLoaded / durationSeconds) / 1000000;

    dlEl.textContent = speedMbps.toFixed(1);
    dlEl.classList.remove('testing-active');
}

async function measureLANUpload(ulEl, sizeMB) {
    ulEl.classList.add('testing-active');
    const payload = generatePayload(sizeMB);
    const start = performance.now();
    const response = await fetch('/api/lan/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: payload
    });

    if (response.status === 409) {
        throw new Error(await response.text());
    }
    if (!response.ok) throw new Error('Upload failed');
    
    const result = await response.json();
    const end = performance.now();
    
    const durationSeconds = (end - start) / 1000;
    const bitsLoaded = result.bytes * 8;
    const speedMbps = (bitsLoaded / durationSeconds) / 1000000;

    ulEl.textContent = speedMbps.toFixed(1);
    ulEl.classList.remove('testing-active');
}
