/**
 * LAN speed test implementation
 */
import { sleep, generatePayload } from './utils';

let lanJitter = 0;
let lanMinPing = 0;
let lanMaxPing = 0;

export interface LANTestSettings {
    DL_SIZE_MB: number;
    UL_SIZE_MB: number;
}

export interface LANTestUICallbacks {
    onStart?: () => void;
    onError?: (err: any) => void;
    onEnd?: () => void;
}

export interface LANTestResults {
    ping: number;
    jitter: number;
    min_ping: number;
    max_ping: number;
    download: number;
    upload: number;
}

export async function startLANTest(
    lanSettings: LANTestSettings,
    currentTranslations: Record<string, string>,
    uiCallbacks: LANTestUICallbacks,
    saveCallback?: (results: LANTestResults) => Promise<void> | void
) {
    const lanPingEl = document.getElementById('lan-ping');
    const lanJitterDisplayEl = document.getElementById('lan-jitter-display');
    const lanDlEl = document.getElementById('lan-dl');
    const lanUlEl = document.getElementById('lan-ul');
    const lanProgressEl = document.getElementById('lan-progress');
    const lanStatusEl = document.getElementById('lan-status');

    // Reset UI and safeguard against null
    if (lanStatusEl) {
        lanStatusEl.className = 'status-badge testing';
        lanStatusEl.textContent = currentTranslations['status_testing'] || 'Testing';
    }
    if (lanPingEl) lanPingEl.textContent = '--';
    if (lanJitterDisplayEl) lanJitterDisplayEl.textContent = '--';
    if (lanDlEl) lanDlEl.textContent = '--';
    if (lanUlEl) lanUlEl.textContent = '--';
    if (lanProgressEl) lanProgressEl.style.width = '0%';
    
    if (uiCallbacks.onStart) uiCallbacks.onStart();

    try {
        // 1. measure Ping
        if (lanProgressEl) lanProgressEl.style.width = '10%';
        if (lanPingEl) {
            await measureLANPing(lanPingEl, lanJitterDisplayEl);
        }
        if (lanProgressEl) lanProgressEl.style.width = '33%';
        
        // 2. measure Download
        await sleep(500);
        if (lanDlEl) {
            await measureLANDownload(lanDlEl, lanSettings.DL_SIZE_MB);
        }
        if (lanProgressEl) lanProgressEl.style.width = '66%';
        
        // 3. measure Upload
        await sleep(500);
        if (lanUlEl) {
            await measureLANUpload(lanUlEl, lanSettings.UL_SIZE_MB);
        }
        if (lanProgressEl) lanProgressEl.style.width = '100%';

        if (lanStatusEl) {
            lanStatusEl.className = 'status-badge completed';
            lanStatusEl.textContent = currentTranslations['status_completed'] || 'Completed';
        }

        if (saveCallback && lanPingEl && lanDlEl && lanUlEl) {
            await saveCallback({
                ping: parseFloat(lanPingEl.textContent || '0') || 0,
                jitter: lanJitter,
                min_ping: lanMinPing,
                max_ping: lanMaxPing,
                download: parseFloat(lanDlEl.textContent || '0') || 0,
                upload: parseFloat(lanUlEl.textContent || '0') || 0
            });
        }

    } catch (e: any) {
        console.error(e);
        if (lanStatusEl) {
            lanStatusEl.className = 'status-badge error';
            lanStatusEl.textContent = currentTranslations['status_error'] || 'Error';
        }
        if (uiCallbacks.onError) uiCallbacks.onError(e);
    } finally {
        if (uiCallbacks.onEnd) uiCallbacks.onEnd();
    }
}

async function measureLANPing(pingEl: HTMLElement, jitterEl: HTMLElement | null) {
    pingEl.classList.add('testing-active');
    let totalLatency = 0;
    const pings = 5;
    let latencies: number[] = [];

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

async function measureLANDownload(dlEl: HTMLElement, sizeMB: number) {
    dlEl.classList.add('testing-active');
    const start = performance.now();
    const response = await fetch(`/api/lan/download?size=${sizeMB}`, { cache: 'no-store' });
    
    if (response.status === 409) {
        throw new Error(await response.text());
    }
    if (!response.ok) throw new Error('Download failed');
    
    if (!response.body) throw new Error('Response body is null');
    const reader = response.body.getReader();
    let receivedLength = 0;

    while(true) {
        const {done, value} = await reader.read();
        if (done) break;
        if (value) {
            receivedLength += value.length;
        }
    }

    const end = performance.now();
    const durationSeconds = (end - start) / 1000;
    const bitsLoaded = receivedLength * 8;
    const speedMbps = (bitsLoaded / durationSeconds) / 1000000;

    dlEl.textContent = speedMbps.toFixed(1);
    dlEl.classList.remove('testing-active');
}

async function measureLANUpload(ulEl: HTMLElement, sizeMB: number) {
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
