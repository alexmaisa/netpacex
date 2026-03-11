// NetPaceX Frontend Logic

// UI Elements: LAN
const btnLan = document.getElementById('btn-lan');
const lanStatus = document.getElementById('lan-status');
const lanPing = document.getElementById('lan-ping');
const lanDl = document.getElementById('lan-dl');
const lanUl = document.getElementById('lan-ul');
const lanProgress = document.getElementById('lan-progress');

let lanJitter = 0;
let lanMinPing = 0;
let lanMaxPing = 0;

// UI Elements: WAN
const btnWan = document.getElementById('btn-wan');
const wanStatus = document.getElementById('wan-status');
const wanServerInfo = document.getElementById('wan-server-info');
const wanPing = document.getElementById('wan-ping');
const wanDl = document.getElementById('wan-dl');
const wanUl = document.getElementById('wan-ul');
const wanProgress = document.getElementById('wan-progress');

// Settings
const LAN_DL_SIZE_MB = 20; // Size of payload for LAN Download test
const LAN_UL_SIZE_MB = 10; // Size of payload for LAN Upload test

// Settings State
let appSettings = {
    timezone: 'UTC',
    wan_unit: 'Mbps',
    lan_unit: 'Mbps',
    mask_mac: 'false'
};

let isPasswordProtected = false;

// -----------------------------------------------------------------
// Localization Init
// -----------------------------------------------------------------

let currentLang = localStorage.getItem('lang') || 'en';
let currentTranslations = {};
const langSelectBtn = document.getElementById('lang-select');
if(langSelectBtn) langSelectBtn.value = currentLang;

async function changeLanguage(lang) {
    try {
        const response = await fetch(`/locales/${lang}.json`);
        const translations = await response.json();
        
        localStorage.setItem('lang', lang);
        currentLang = lang;
        
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (translations[key]) {
                el.textContent = translations[key];
            }
        });

        currentTranslations = translations;

        // Re-render components that depend on currentTranslations
        if (typeof renderHistoryChart === 'function' && (wanHistoryData.length > 0 || lanHistoryData.length > 0)) {
            renderHistoryChart();
        }
        if (typeof renderHistoryTable === 'function' && (wanHistoryData.length > 0 || lanHistoryData.length > 0)) {
            renderHistoryTable();
        }
    } catch (e) {
        console.error('Failed to load translations:', e);
    }
}


// -----------------------------------------------------------------
// Navigation & Views
// -----------------------------------------------------------------
function switchMainView(viewId) {
    // Update Tabs
    document.querySelectorAll('.main-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
    
    const tabIndex = viewId === 'test' ? 0 : (viewId === 'history' ? 1 : 2);
    const targetTab = document.querySelectorAll('.main-tabs .tab-btn')[tabIndex];
    if (targetTab) targetTab.classList.add('active');

    // Toggle Views
    document.getElementById('view-test').style.display = viewId === 'test' ? 'block' : 'none';
    document.getElementById('view-history').style.display = viewId === 'history' ? 'block' : 'none';
    document.getElementById('view-settings').style.display = viewId === 'settings' ? 'block' : 'none';

    if (viewId === 'history') {
        fetchHistory();
    } else if (viewId === 'settings') {
        renderSettings();
    }
}

function closeTestCard(type) {
    const launcher = document.getElementById('test-launcher');
    const resultsGrid = document.querySelector('.results-grid');
    const wanCard = document.getElementById('wan-card');
    const lanCard = document.getElementById('lan-card');

    launcher.style.display = 'grid';
    resultsGrid.style.display = 'none';
    
    // Reset status to idle for next time
    if (type === 'wan') {
        wanStatus.textContent = currentTranslations['status_idle'] || 'Idle';
        wanStatus.className = 'status-badge idle';
    } else {
        lanStatus.textContent = currentTranslations['status_idle'] || 'Idle';
        lanStatus.className = 'status-badge idle';
    }
}

function switchHistoryTab(tabId) {
    document.querySelectorAll('.history-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
    
    if (tabId === 'wan') {
        document.querySelectorAll('.history-tabs .tab-btn')[0].classList.add('active');
    } else {
        document.querySelectorAll('.history-tabs .tab-btn')[1].classList.add('active');
    }

    currentHistoryTab = tabId;
    currentPage = 1;
    renderHistoryTable();
}

// -----------------------------------------------------------------
// History & Pagination Logic
// -----------------------------------------------------------------
let wanHistoryData = [];
let lanHistoryData = [];
let currentHistoryTab = 'wan';
let currentPage = 1;
const ITEMS_PER_PAGE = 5;
let wanChartInstance = null;
let lanChartInstance = null;

async function fetchHistory() {
    try {
        const [wanRes, lanRes] = await Promise.all([
            fetch('/api/wan/history'),
            fetch('/api/lan/history')
        ]);
        
        if (wanRes.ok) {
            const data = await wanRes.json();
            wanHistoryData = Array.isArray(data) ? data : [];
        }
        if (lanRes.ok) {
            const data = await lanRes.json();
            lanHistoryData = Array.isArray(data) ? data : [];
        }
        
        updateAverages();
        renderHistoryChart();
        renderHistoryTable();
    } catch (e) {
        console.error('Failed to fetch history:', e);
    }
}

function renderHistoryChart() {
    const wanChartWrapper = document.getElementById('wan-chart-wrapper');
    const lanChartWrapper = document.getElementById('lan-chart-wrapper');
    const wanCtx = document.getElementById('wanChart').getContext('2d');
    const lanCtx = document.getElementById('lanChart').getContext('2d');

    // Helper for date formatting
    const formatDate = (rawDate) => {
        const dt = new Date(rawDate);
        return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    };

    // --- WAN Chart ---
    if (wanHistoryData.length > 0) {
        wanChartWrapper.style.display = currentHistoryTab === 'wan' ? 'block' : 'none';
        const sortedWan = [...wanHistoryData].sort((a,b) => new Date(a.raw_date).getTime() - new Date(b.raw_date).getTime());
        const labels = sortedWan.map(d => formatDate(d.raw_date));
        
        if (wanChartInstance) wanChartInstance.destroy();
        
        const wanUnit = appSettings.wan_unit;
        const wanDiv = wanUnit === 'Gbps' ? 1000 : 1;
        const dlLabel = (currentTranslations['lbl_download'] || 'Download') + ` (${wanUnit})`;
        const ulLabel = (currentTranslations['lbl_upload'] || 'Upload') + ` (${wanUnit})`;
        const pingLabel = (currentTranslations['lbl_ping'] || 'Ping') + ' (ms)';

        wanChartInstance = new Chart(wanCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: dlLabel,
                        data: sortedWan.map(d => d.download_mbps / wanDiv),
                        borderColor: '#3b82f6', // Blue
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        borderWidth: 2, tension: 0.3, yAxisID: 'y'
                    },
                    {
                        label: ulLabel,
                        data: sortedWan.map(d => d.upload_mbps / wanDiv),
                        borderColor: '#10b981', // Emerald
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        borderWidth: 2, tension: 0.3, yAxisID: 'y'
                    },
                    {
                        label: pingLabel,
                        data: sortedWan.map(d => d.ping_ms),
                        borderColor: '#fbbf24', // Yellow
                        backgroundColor: 'rgba(251, 191, 36, 0.1)',
                        borderWidth: 2, tension: 0.3, yAxisID: 'y1'
                    }
                ]
            },
            options: getChartOptions(currentTranslations['history_wan_title'] || 'Internet Speed Test History', '#3b82f6')
        });
    } else {
        wanChartWrapper.style.display = 'none';
    }

    // --- LAN Chart ---
    if (lanHistoryData.length > 0) {
        lanChartWrapper.style.display = currentHistoryTab === 'lan' ? 'block' : 'none';
        const sortedLan = [...lanHistoryData].sort((a,b) => new Date(a.raw_date).getTime() - new Date(b.raw_date).getTime());
        const labels = sortedLan.map(d => formatDate(d.raw_date));

        if (lanChartInstance) lanChartInstance.destroy();

        const lanUnit = appSettings.lan_unit;
        const lanDiv = lanUnit === 'Gbps' ? 1000 : 1;
        const dlLabelLan = (currentTranslations['lbl_download'] || 'Download') + ` (${lanUnit})`;
        const ulLabelLan = (currentTranslations['lbl_upload'] || 'Upload') + ` (${lanUnit})`;
        const pingLabelLan = (currentTranslations['lbl_ping'] || 'Ping') + ' (ms)';

        lanChartInstance = new Chart(lanCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: dlLabelLan,
                        data: sortedLan.map(d => d.download_mbps / lanDiv),
                        borderColor: '#3b82f6', // Blue
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        borderWidth: 2, tension: 0.3, yAxisID: 'y'
                    },
                    {
                        label: ulLabelLan,
                        data: sortedLan.map(d => d.upload_mbps / lanDiv),
                        borderColor: '#10b981', // Emerald
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        borderWidth: 2, tension: 0.3, yAxisID: 'y'
                    },
                    {
                        label: pingLabelLan,
                        data: sortedLan.map(d => d.ping_ms),
                        borderColor: '#fbbf24', // Yellow
                        backgroundColor: 'rgba(251, 191, 36, 0.1)',
                        borderWidth: 2, tension: 0.3, yAxisID: 'y1'
                    }
                ]
            },
            options: getChartOptions(currentTranslations['history_lan_title'] || 'LAN Speed Test History', '#3b82f6')
        });
    } else {
        lanChartWrapper.style.display = 'none';
    }
}

function getChartOptions(yTitle, yColor) {
    const pingLabel = (currentTranslations['lbl_ping'] || 'Ping') + ' (ms)';
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { labels: { color: '#9ca3af', font: { family: 'Inter', size: 12 } } },
            tooltip: { mode: 'index', intersect: false }
        },
        scales: {
            x: {
                ticks: { color: '#9ca3af', autoSkip: true, maxTicksLimit: 8, maxRotation: 0 },
                grid: { color: 'rgba(255, 255, 255, 0.05)' }
            },
            y: {
                type: 'linear', display: true, position: 'left', beginAtZero: true,
                title: { display: true, text: yTitle, color: yColor },
                ticks: { color: '#9ca3af' },
                grid: { color: 'rgba(255, 255, 255, 0.05)' }
            },
            y1: {
                type: 'linear', display: true, position: 'right', beginAtZero: true,
                title: { display: true, text: pingLabel, color: '#fbbf24' },
                ticks: { color: '#9ca3af' },
                grid: { drawOnChartArea: false }
            }
        }
    };
}

function updateAverages() {
    const now = new Date();
    const twentyFourHoursAgo = now.getTime() - (24 * 60 * 60 * 1000);

    const filterLast24h = (data) => {
        return data.filter(d => new Date(d.raw_date).getTime() >= twentyFourHoursAgo);
    };

    const wan24 = filterLast24h(wanHistoryData);
    const lan24 = filterLast24h(lanHistoryData);

    const calcAvg = (data) => {
        if (data.length === 0) return { dl: '--', ul: '--', ping: '--' };
        const dl = data.reduce((sum, d) => sum + d.download_mbps, 0) / data.length;
        const ul = data.reduce((sum, d) => sum + d.upload_mbps, 0) / data.length;
        const ping = data.reduce((sum, d) => sum + d.ping_ms, 0) / data.length;
        return { dl: dl.toFixed(1), ul: ul.toFixed(1), ping: ping.toFixed(1) };
    };

    const wanStats = calcAvg(wan24);
    const lanStats = calcAvg(lan24);

    // Update WAN DOM
    document.getElementById('avg-wan-download').textContent = wanStats.dl;
    document.getElementById('avg-wan-upload').textContent = wanStats.ul;
    document.getElementById('avg-wan-ping').textContent = wanStats.ping;

    // Update LAN DOM
    document.getElementById('avg-lan-download').textContent = lanStats.dl;
    document.getElementById('avg-lan-upload').textContent = lanStats.ul;
    document.getElementById('avg-lan-ping').textContent = lanStats.ping;
}

function renderHistoryTable() {
    const isWan = currentHistoryTab === 'wan';
    const data = isWan ? wanHistoryData : lanHistoryData;
    
    // Toggle Table Containers
    document.getElementById('history-table-wan-container').style.display = isWan ? 'block' : 'none';
    document.getElementById('history-table-lan-container').style.display = !isWan ? 'block' : 'none';
    
    // Toggle Chart Containers
    if (wanHistoryData.length > 0) {
        document.getElementById('wan-chart-wrapper').style.display = isWan ? 'block' : 'none';
    }
    if (lanHistoryData.length > 0) {
        document.getElementById('lan-chart-wrapper').style.display = !isWan ? 'block' : 'none';
    }
    
    const tbodyId = isWan ? 'history-body-wan' : 'history-body-lan';
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    const totalPages = Math.max(1, Math.ceil(data.length / ITEMS_PER_PAGE));
    if (currentPage > totalPages) currentPage = totalPages;
    
    const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
    const paginatedData = data.slice(startIdx, startIdx + ITEMS_PER_PAGE);
    
    paginatedData.forEach(item => {
        const tr = document.createElement('tr');
        const dateStr = item.test_date; 
        const wanUnit = appSettings.wan_unit || 'Mbps';
        const lanUnit = appSettings.lan_unit || 'Mbps';

        if (isWan) {
            tr.innerHTML = `
                <td>${item.server_name}</td>
                <td class="text-center">${item.ping_ms.toFixed(1)}</td>
                <td class="text-center">${formatSpeed(item.download_mbps, wanUnit)}</td>
                <td class="text-center">${formatSpeed(item.upload_mbps, wanUnit)}</td>
                <td class="text-center">${dateStr}</td>
            `;
        } else {
            const displayMAC = appSettings.mask_mac === 'true' ? maskMAC(item.mac_address) : item.mac_address;
            tr.innerHTML = `
                <td>${item.ip_address}</td>
                <td class="mac-cell">${displayMAC}</td>
                <td class="text-center">${item.ping_ms.toFixed(1)}</td>
                <td class="text-center">${formatSpeed(item.download_mbps, lanUnit)}</td>
                <td class="text-center">${formatSpeed(item.upload_mbps, lanUnit)}</td>
                <td class="text-center">${dateStr}</td>
            `;
            
            if (appSettings.mask_mac === 'true') {
                 const macCell = tr.querySelector('.mac-cell');
                 macCell.style.cursor = 'pointer';
                 macCell.title = currentTranslations['tip_unmask_mac'] || 'Click to unmask';
                 macCell.onclick = (e) => {
                     e.stopPropagation();
                     handleUnmaskMAC(item.mac_address, macCell);
                 };
            }
        }
        
        tr.style.cursor = 'pointer';
        tr.onclick = () => openDetailsModal(item, isWan);
        
        tbody.appendChild(tr);
    });

    // Update Pagination UI
    document.getElementById('page-current').textContent = currentPage;
    document.getElementById('page-total').textContent = totalPages;
    document.getElementById('btn-prev').disabled = currentPage === 1;
    document.getElementById('btn-next').disabled = currentPage === totalPages;
}

function prevPage() {
    if (currentPage > 1) {
        currentPage--;
        renderHistoryTable();
    }
}

function nextPage() {
    const isWan = currentHistoryTab === 'wan';
    const data = isWan ? wanHistoryData : lanHistoryData;
    const totalPages = Math.ceil(data.length / ITEMS_PER_PAGE);
    
    if (currentPage < totalPages) {
        currentPage++;
        renderHistoryTable();
    }
}

// Utility: Sleep
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Utility: Generate Payload (String)
function generatePayload(mb) {
    const sizeBytes = mb * 1024 * 1024;
    // We create a typed array of random data.
    // Int8Array is fine, we just need raw bytes.
    const arr = new Int8Array(sizeBytes);
    for (let i = 0; i < sizeBytes; i++) {
        arr[i] = Math.floor(Math.random() * 256) - 128;
    }
    return arr.buffer; // Return the ArrayBuffer
}

// -----------------------------------------------------------------
// LAN Test Logic
// -----------------------------------------------------------------

async function startLANTest() {
    const launcher = document.getElementById('test-launcher');
    const resultsGrid = document.querySelector('.results-grid');
    const wanCard = document.getElementById('wan-card');
    const lanCard = document.getElementById('lan-card');

    launcher.style.display = 'none';
    resultsGrid.style.display = 'grid';
    lanCard.style.display = 'flex';
    wanCard.style.display = 'none';

    // Hide close button during test
    const closeBtn = lanCard.querySelector('.card-close-btn');
    if (closeBtn) closeBtn.classList.remove('visible');

    // Reset UI
    lanStatus.className = 'status-badge testing';
    lanStatus.textContent = currentTranslations['status_testing'] || 'Testing';
    lanPing.textContent = '--';
    lanDl.textContent = '--';
    lanUl.textContent = '--';
    lanProgress.style.width = '0%';
    
    btnLan.disabled = true;
    btnWan.disabled = true;

    try {
        // 1. measure Ping
        lanProgress.style.width = '10%';
        await measureLANPing();
        lanProgress.style.width = '33%';
        
        // 2. measure Download
        await sleep(500); // Small pause for stability
        await measureLANDownload();
        lanProgress.style.width = '66%';
        
        // 3. measure Upload
        await sleep(500);
        await measureLANUpload();
        lanProgress.style.width = '100%';

        lanStatus.className = 'status-badge completed';
        lanStatus.textContent = currentTranslations['status_completed'] || 'Completed';

        // Save LAN results to backend
        try {
            await fetch('/api/lan/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ping: parseFloat(lanPing.textContent) || 0,
                    jitter: lanJitter,
                    min_ping: lanMinPing,
                    max_ping: lanMaxPing,
                    download: parseFloat(lanDl.textContent) || 0,
                    upload: parseFloat(lanUl.textContent) || 0
                })
            });
        } catch (saveErr) {
            console.error('Failed to save LAN results:', saveErr);
        }

    } catch (e) {
        console.error(e);
        lanStatus.className = 'status-badge error';
        lanStatus.textContent = currentTranslations['status_error'] || 'Error';
    } finally {
        // Show close button
        const closeBtn = document.querySelector('#lan-card .card-close-btn');
        if (closeBtn) closeBtn.classList.add('visible');

        btnLan.disabled = false;
        btnWan.disabled = false;
        // Turn off active colors
        [lanPing, lanDl, lanUl].forEach(el => el.classList.remove('testing-active'));
        setTimeout(() => lanProgress.style.width = '0%', 2000);
    }
}

async function measureLANPing() {
    lanPing.classList.add('testing-active');
    let totalLatency = 0;
    const pings = 5; // Do 5 pings and average
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
    lanPing.textContent = avgLatency.toFixed(1);
    
    lanMinPing = Math.min(...latencies);
    lanMaxPing = Math.max(...latencies);
    
    let jitterSum = 0;
    for (let i = 1; i < latencies.length; i++) {
        jitterSum += Math.abs(latencies[i] - latencies[i-1]);
    }
    lanJitter = pings > 1 ? (jitterSum / (pings - 1)) : 0;

    lanPing.classList.remove('testing-active');
}

async function measureLANDownload() {
    lanDl.classList.add('testing-active');
    
    const start = performance.now();
    const response = await fetch(`/api/lan/download?size=${LAN_DL_SIZE_MB}`, { cache: 'no-store' });
    
    if (!response.ok) throw new Error('Download failed');
    
    // Read the stream totally into memory to calculate speed
    const reader = response.body.getReader();
    let receivedLength = 0;

    while(true) {
        const {done, value} = await reader.read();
        if (done) break;
        receivedLength += value.length;
    }

    const end = performance.now();
    const durationSeconds = (end - start) / 1000;
    
    // Bytes to Megabits: (bytes * 8) / 1,000,000
    const bitsLoaded = receivedLength * 8;
    const speedMbps = (bitsLoaded / durationSeconds) / 1000000;

    lanDl.textContent = speedMbps.toFixed(1);
    lanDl.classList.remove('testing-active');
}

async function measureLANUpload() {
    lanUl.classList.add('testing-active');

    // Create a random ArrayBuffer
    const payload = generatePayload(LAN_UL_SIZE_MB);

    const start = performance.now();
    const response = await fetch('/api/lan/upload', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/octet-stream',
        },
        body: payload
    });

    if (!response.ok) throw new Error('Upload failed');
    
    const result = await response.json();
    const end = performance.now();
    
    const durationSeconds = (end - start) / 1000;
    const bitsLoaded = result.bytes * 8;
    const speedMbps = (bitsLoaded / durationSeconds) / 1000000;

    lanUl.textContent = speedMbps.toFixed(1);
    lanUl.classList.remove('testing-active');
}


// -----------------------------------------------------------------
// WAN Test Logic
// -----------------------------------------------------------------

function startWANTest() {
    const launcher = document.getElementById('test-launcher');
    const resultsGrid = document.querySelector('.results-grid');
    const wanCard = document.getElementById('wan-card');
    const lanCard = document.getElementById('lan-card');

    launcher.style.display = 'none';
    resultsGrid.style.display = 'grid';
    wanCard.style.display = 'flex';
    lanCard.style.display = 'none';

    // Hide close button during test
    const closeBtn = wanCard.querySelector('.card-close-btn');
    if (closeBtn) closeBtn.classList.remove('visible');

    // Reset UI
    wanStatus.className = 'status-badge testing';
    wanStatus.textContent = currentTranslations['status_testing'] || 'Testing';
    wanServerInfo.textContent = currentTranslations['msg_locating_server'] || 'Locating best server...';
    wanPing.textContent = '--';
    wanDl.textContent = '--';
    wanUl.textContent = '--';
    wanProgress.style.width = '10%';
    
    btnLan.disabled = true;
    btnWan.disabled = true;

    [wanPing, wanDl, wanUl].forEach(el => el.classList.remove('testing-active'));

    // We use Server-Sent Events (SSE) to get real-time progress from the Go backend
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
                    wanServerInfo.textContent = data.info;
                    wanProgress.style.width = '20%';
                }
                break;
            case 'ping':
                wanPing.textContent = data.value.toFixed(1);
                wanPing.classList.remove('testing-active');
                wanDl.classList.add('testing-active'); // Move active to next
                wanProgress.style.width = '40%';
                break;
            case 'download':
                wanDl.textContent = data.value.toFixed(1);
                wanDl.classList.remove('testing-active');
                wanUl.classList.add('testing-active'); // Move active to next
                wanProgress.style.width = '70%';
                break;
            case 'upload':
                wanUl.textContent = data.value.toFixed(1);
                wanUl.classList.remove('testing-active');
                wanProgress.style.width = '100%';
                break;
            case 'done':
                wanStatus.className = 'status-badge completed';
                wanStatus.textContent = currentTranslations['status_completed'] || 'Completed';
                eventSource.close();
                btnLan.disabled = false;
                btnWan.disabled = false;
                // Show close button
                const closeBtnDone = document.querySelector('#wan-card .card-close-btn');
                if (closeBtnDone) closeBtnDone.classList.add('visible');
                setTimeout(() => wanProgress.style.width = '0%', 2000);
                break;
            case 'error':
                console.error("WAN Error:", data);
                wanStatus.className = 'status-badge error';
                wanStatus.textContent = currentTranslations['status_error'] || 'Error';
                wanServerInfo.textContent = data.info || data.value;
                eventSource.close();
                btnLan.disabled = false;
                btnWan.disabled = false;
                // Show close button
                const closeBtnError = document.querySelector('#wan-card .card-close-btn');
                if (closeBtnError) closeBtnError.classList.add('visible');
                [wanPing, wanDl, wanUl].forEach(el => el.classList.remove('testing-active'));
                break;
        }
    };

    eventSource.onerror = function(err) {
        console.error("SSE Error:", err);
        wanStatus.className = 'status-badge error';
        wanStatus.textContent = currentTranslations['status_connection_lost'] || 'Connection Lost';
        eventSource.close();
        btnLan.disabled = false;
        btnWan.disabled = false;
        // Show close button
        const closeBtn = document.querySelector('#wan-card .card-close-btn');
        if (closeBtn) closeBtn.classList.add('visible');
        [wanPing, wanDl, wanUl].forEach(el => el.classList.remove('testing-active'));
    };
}

// -----------------------------------------------------------------
// Modal Logic
// -----------------------------------------------------------------

function openDetailsModal(item, isWan) {
    const modal = document.getElementById('details-modal');
    if (!modal) return;
    
    document.getElementById('modal-date').textContent = item.test_date || '--';
    const badge = document.getElementById('modal-badge');
    
    if (isWan) {
        document.getElementById('modal-title-target').textContent = currentTranslations['modal_title_wan'] || 'Internet Test Details';
        document.getElementById('modal-target').textContent = item.server_name || '--';
        badge.textContent = currentTranslations['badge_wan'] || 'Internet';
        badge.className = 'modal-badge';
    } else {
        document.getElementById('modal-title-target').textContent = currentTranslations['modal_title_lan'] || 'LAN Test Details';
        document.getElementById('modal-target').textContent = item.ip_address + (item.mac_address ? ' (' + item.mac_address + ')' : '');
        badge.textContent = currentTranslations['badge_lan'] || 'Local Network';
        badge.className = 'modal-badge lan';
    }
    
    document.getElementById('modal-download').textContent = item.download_mbps ? item.download_mbps.toFixed(1) : '0.0';
    document.getElementById('modal-upload').textContent = item.upload_mbps ? item.upload_mbps.toFixed(1) : '0.0';
    
    document.getElementById('modal-ping-avg').textContent = item.ping_ms ? item.ping_ms.toFixed(1) : '0.0';
    document.getElementById('modal-ping-jitter').textContent = item.jitter_ms ? item.jitter_ms.toFixed(1) : '0.0';
    document.getElementById('modal-ping-min').textContent = item.min_ping_ms ? item.min_ping_ms.toFixed(1) : '0.0';
    document.getElementById('modal-ping-max').textContent = item.max_ping_ms ? item.max_ping_ms.toFixed(1) : '0.0';
    
    modal.style.display = 'flex';
}

function closeDetailsModal() {
    const modal = document.getElementById('details-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Initial App setup
async function initApp() {
    await changeLanguage(currentLang);
    await loadSettings();
    await checkAuthStatus();
    // Fetch history ONLY after settings are loaded to ensure masks/units are correct
    fetchHistory();
}
initApp();
// -----------------------------------------------------------------
// Settings & Security Logic
// -----------------------------------------------------------------

async function loadSettings() {
    try {
        const res = await fetch('/api/settings');
        if (res.ok) {
            appSettings = await res.json();
            updateUnitLabels();
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
}

async function checkAuthStatus() {
    try {
        const res = await fetch('/api/auth/check');
        if (res.ok) {
            const data = await res.json();
            isPasswordProtected = data.password_enabled;
        }
    } catch (e) {
        console.error('Failed to check auth status:', e);
    }
}

function renderSettings() {
    const tzSelect = document.getElementById('set-timezone');
    const maskMacToggle = document.getElementById('set-mask-mac');

    // Load Timezones if empty
    if (tzSelect.options.length === 0) {
        fetch('/api/timezones').then(res => res.json()).then(tzs => {
            tzs.forEach(tz => {
                const opt = document.createElement('option');
                opt.value = tz;
                opt.textContent = tz;
                tzSelect.appendChild(opt);
            });
            tzSelect.value = appSettings.timezone;
        });
    } else {
        tzSelect.value = appSettings.timezone;
    }

    // Set Radio Buttons
    const wanRadios = document.querySelectorAll('input[name="wan_unit"]');
    const lanRadios = document.querySelectorAll('input[name="lan_unit"]');
    
    wanRadios.forEach(r => r.checked = r.value === appSettings.wan_unit);
    lanRadios.forEach(r => r.checked = r.value === appSettings.lan_unit);

    maskMacToggle.checked = appSettings.mask_mac === 'true';
}

function updateSetting(key, value) {
    appSettings[key] = String(value);
}

async function saveAllSettings() {
    const btn = document.querySelector('#view-settings .btn.primary');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = currentTranslations['btn_saving'] || 'Saving...';

    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(appSettings)
        });
        if (res.ok) {
            showToast(currentTranslations['msg_settings_saved'] || 'Settings saved successfully');
            updateUnitLabels();
            // Refresh history to apply mask/timezone changes
            await fetchHistory();
        } else {
            showToast('Error saving settings', 'error');
        }
    } catch (e) {
        console.error('Failed to save settings:', e);
        showToast('Connection error', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

function updateUnitLabels() {
    const wanUnits = document.querySelectorAll('#wan-card .unit, #avg-wan-download + small, #avg-wan-upload + small, .unit-wan');
    const lanUnits = document.querySelectorAll('#lan-card .unit, #avg-lan-download + small, #avg-lan-upload + small, .unit-lan');
    
    wanUnits.forEach(el => el.textContent = appSettings.wan_unit);
    lanUnits.forEach(el => el.textContent = appSettings.lan_unit);
}

function formatSpeed(mbps, unit) {
    if (unit === 'Gbps') {
        return (mbps / 1000).toFixed(3);
    }
    return mbps.toFixed(1);
}

function maskMAC(mac) {
    if (!mac || mac === 'Unknown MAC' || mac.includes('Localhost')) return mac;
    return 'XX:XX:XX:XX:XX:XX';
}

// Security Modal Logic
let securityCallback = null;

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
            const password = pwdInput.value;
            try {
                const res = await fetch('/api/auth/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password })
                });
                if (res.ok) {
                    executeSecurityAction();
                } else {
                    pwdInput.classList.add('error-shake');
                    setTimeout(() => pwdInput.classList.remove('error-shake'), 500);
                }
            } catch (e) {
                console.error('Verification failed:', e);
            }
        } else {
            executeSecurityAction();
        }
    };
}

function executeSecurityAction() {
    if (securityCallback) securityCallback();
    closeSecurityModal();
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

function showToast(msg, type = 'success') {
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
    
    // Auto remove after 3.5 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}
