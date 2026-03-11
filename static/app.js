// NetPaceX Frontend Logic

// UI Elements: LAN
const btnLan = document.getElementById('btn-lan');
const lanStatus = document.getElementById('lan-status');
const lanPing = document.getElementById('lan-ping');
const lanDl = document.getElementById('lan-dl');
const lanUl = document.getElementById('lan-ul');
const lanProgress = document.getElementById('lan-progress');

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

// -----------------------------------------------------------------
// Localization Init
// -----------------------------------------------------------------

let currentLang = localStorage.getItem('lang') || 'en';
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
                // Also update placeholders or values if needed, but innerText is usually enough
            }
        });
    } catch (e) {
        console.error('Failed to load translations:', e);
    }
}

// Initialize Localization on page load
changeLanguage(currentLang);

// -----------------------------------------------------------------
// Navigation & Views
// -----------------------------------------------------------------
function switchMainView(viewId) {
    // Update Tabs
    document.querySelectorAll('.main-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
    
    if (viewId === 'test') {
        document.querySelectorAll('.main-tabs .tab-btn')[0].classList.add('active');
    } else {
        document.querySelectorAll('.main-tabs .tab-btn')[1].classList.add('active');
    }

    // Toggle Views
    document.getElementById('view-test').style.display = viewId === 'test' ? 'block' : 'none';
    document.getElementById('view-history').style.display = viewId === 'history' ? 'block' : 'none';

    if (viewId === 'history') {
        fetchHistory();
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
const ITEMS_PER_PAGE = 10;

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
        
        renderHistoryTable();
    } catch (e) {
        console.error('Failed to fetch history:', e);
    }
}

function renderHistoryTable() {
    const isWan = currentHistoryTab === 'wan';
    const data = isWan ? wanHistoryData : lanHistoryData;
    
    // Toggle Table Containers
    document.getElementById('history-table-wan-container').style.display = isWan ? 'block' : 'none';
    document.getElementById('history-table-lan-container').style.display = !isWan ? 'block' : 'none';
    
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
        const dateObj = new Date(item.test_date + 'Z'); 
        const dateStr = isNaN(dateObj.getTime()) ? item.test_date : dateObj.toLocaleString();

        if (isWan) {
            tr.innerHTML = `
                <td>${item.server_name}</td>
                <td>${item.ping_ms.toFixed(1)}</td>
                <td>${item.download_mbps.toFixed(1)}</td>
                <td>${item.upload_mbps.toFixed(1)}</td>
                <td>${dateStr}</td>
            `;
        } else {
            tr.innerHTML = `
                <td>${item.ip_address}</td>
                <td>${item.mac_address}</td>
                <td>${item.ping_ms.toFixed(1)}</td>
                <td>${item.download_mbps.toFixed(1)}</td>
                <td>${item.upload_mbps.toFixed(1)}</td>
                <td>${dateStr}</td>
            `;
        }
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
    // Reset UI
    lanStatus.className = 'status-badge testing';
    lanStatus.textContent = 'Testing';
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

        lanStatus.className = 'status-badge done';
        lanStatus.textContent = 'Completed';

        // Save LAN results to backend
        try {
            await fetch('/api/lan/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ping: parseFloat(lanPing.textContent) || 0,
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
        lanStatus.textContent = 'Error';
    } finally {
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

    for (let i = 0; i < pings; i++) {
        const start = performance.now();
        await fetch('/api/lan/ping', { cache: 'no-store' });
        const end = performance.now();
        totalLatency += (end - start);
    }

    const avgLatency = totalLatency / pings;
    lanPing.textContent = avgLatency.toFixed(1);
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
    // Reset UI
    wanStatus.className = 'status-badge testing';
    wanStatus.textContent = 'Testing';
    wanServerInfo.textContent = 'Locating best server...';
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
                wanStatus.className = 'status-badge done';
                wanStatus.textContent = 'Completed';
                eventSource.close();
                btnLan.disabled = false;
                btnWa.disabled = false;
                setTimeout(() => wanProgress.style.width = '0%', 2000);
                break;
            case 'error':
                console.error("WAN Error:", data);
                wanStatus.className = 'status-badge error';
                wanStatus.textContent = 'Error';
                wanServerInfo.textContent = data.info || data.value;
                eventSource.close();
                btnLan.disabled = false;
                btnWan.disabled = false;
                [wanPing, wanDl, wanUl].forEach(el => el.classList.remove('testing-active'));
                break;
        }
    };

    eventSource.onerror = function(err) {
        console.error("SSE Error:", err);
        wanStatus.className = 'status-badge error';
        wanStatus.textContent = 'Connection Lost';
        eventSource.close();
        btnLan.disabled = false;
        btnWan.disabled = false;
        [wanPing, wanDl, wanUl].forEach(el => el.classList.remove('testing-active'));
    };
}

// Ensure history is fetched at least once on startup
fetchHistory();
