/**
 * History data fetching, table rendering, and averages
 */
import { formatSpeed, maskMAC } from './utils.js';

export let wanHistoryData = [];
export let lanHistoryData = [];
export let currentHistoryTab = 'wan';
export let currentPage = 1;
export const ITEMS_PER_PAGE = 5;

export async function fetchHistory(renderCallback, averagesCallback) {
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
        
        if (averagesCallback) averagesCallback();
        if (renderCallback) renderCallback();
    } catch (e) {
        console.error('Failed to fetch history:', e);
    }
}

export function updateAverages(appSettings) {
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

    document.getElementById('avg-wan-download').textContent = wanStats.dl;
    document.getElementById('avg-wan-upload').textContent = wanStats.ul;
    document.getElementById('avg-wan-ping').textContent = wanStats.ping;

    document.getElementById('avg-lan-download').textContent = lanStats.dl;
    document.getElementById('avg-lan-upload').textContent = lanStats.ul;
    document.getElementById('avg-lan-ping').textContent = lanStats.ping;
}

export function renderHistoryTable(appSettings, currentTranslations, detailsCallback, deleteCallback, unmaskCallback) {
    const isWan = currentHistoryTab === 'wan';
    const data = isWan ? wanHistoryData : lanHistoryData;
    
    document.getElementById('history-table-wan-container').style.display = isWan ? 'block' : 'none';
    document.getElementById('history-table-lan-container').style.display = !isWan ? 'block' : 'none';
    
    const tbodyId = isWan ? 'history-body-wan' : 'history-body-lan';
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    const allowDelete = appSettings.allow_delete === 'true';
    const actionHeaders = document.querySelectorAll('.column-actions');
    actionHeaders.forEach(h => {
        h.style.display = allowDelete ? 'table-cell' : 'none';
    });
    
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
                <td class="text-center">${item.ping_ms !== null ? item.ping_ms.toFixed(1) : '--'}</td>
                <td class="text-center">${formatSpeed(item.download_mbps, wanUnit)}</td>
                <td class="text-center">${formatSpeed(item.upload_mbps, wanUnit)}</td>
                <td class="text-center">${dateStr}</td>
                ${allowDelete ? `<td class="text-center column-actions"><button class="btn-icon danger delete-btn"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></td>` : ''}
            `;
            if (allowDelete) {
                tr.querySelector('.delete-btn').onclick = (e) => {
                    e.stopPropagation();
                    deleteCallback('wan', item.id);
                };
            }
        } else {
            const displayMAC = appSettings.mask_mac === 'true' ? maskMAC(item.mac_address) : item.mac_address;
            const connIcon = item.conn_type === 'Wi-Fi' ? '📶' : (item.conn_type === 'Ethernet' ? '🔌' : (item.conn_type === 'Localhost' ? '💻' : '❓'));
            tr.innerHTML = `
                <td>${item.ip_address}</td>
                <td class="mac-cell">${displayMAC}</td>
                <td class="text-center" title="${item.conn_type}">${connIcon}</td>
                <td class="text-center">${item.ping_ms !== null ? item.ping_ms.toFixed(1) : '--'}</td>
                <td class="text-center">${formatSpeed(item.download_mbps, lanUnit)}</td>
                <td class="text-center">${formatSpeed(item.upload_mbps, lanUnit)}</td>
                <td class="text-center">${dateStr}</td>
                ${allowDelete ? `<td class="text-center column-actions"><button class="btn-icon danger delete-btn"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></td>` : ''}
            `;
            
            if (allowDelete) {
                tr.querySelector('.delete-btn').onclick = (e) => {
                    e.stopPropagation();
                    deleteCallback('lan', item.id);
                };
            }

            if (appSettings.mask_mac === 'true') {
                 const macCell = tr.querySelector('.mac-cell');
                 macCell.style.cursor = 'pointer';
                 macCell.title = currentTranslations['tip_unmask_mac'] || 'Click to unmask';
                 macCell.onclick = (e) => {
                     e.stopPropagation();
                     unmaskCallback(item.mac_address, macCell);
                 };
            }
        }
        
        tr.style.cursor = 'pointer';
        tr.onclick = () => detailsCallback(item, isWan);
        
        tbody.appendChild(tr);
    });

    document.getElementById('page-current').textContent = currentPage;
    document.getElementById('page-total').textContent = totalPages;
    document.getElementById('btn-prev').disabled = currentPage === 1;
    document.getElementById('btn-next').disabled = currentPage === totalPages;
}

export function setCurrentPage(page) {
    currentPage = page;
}

export function setCurrentHistoryTab(tab) {
    currentHistoryTab = tab;
}
