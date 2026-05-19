/**
 * History data fetching, table rendering, and averages
 */
import { formatSpeed } from './utils';

export interface WANHistoryItem {
    id: number;
    server_name: string;
    ping_ms: number | null;
    jitter_ms: number | null;
    min_ping_ms: number | null;
    max_ping_ms: number | null;
    download_mbps: number;
    upload_mbps: number;
    test_date: string;
    raw_date: string;
    [key: string]: any;
}

export let wanHistoryData: WANHistoryItem[] = [];
export let currentPage: number = 1;
export const ITEMS_PER_PAGE: number = 5;

export async function fetchHistory(renderCallback?: () => void, averagesCallback?: () => void) {
    try {
        const wanRes = await fetch('/api/wan/history');
        
        if (wanRes.ok) {
            const data = await wanRes.json();
            wanHistoryData = Array.isArray(data) ? data : [];
        }
        
        if (averagesCallback) averagesCallback();
        if (renderCallback) renderCallback();
    } catch (e) {
        console.error('Failed to fetch history:', e);
    }
}

export function updateAverages(appSettings: any) {
    const now = new Date();
    const twentyFourHoursAgo = now.getTime() - (24 * 60 * 60 * 1000);

    const filterLast24h = <T extends { raw_date: string }>(data: T[]): T[] => {
        return data.filter(d => new Date(d.raw_date).getTime() >= twentyFourHoursAgo);
    };

    const wan24 = filterLast24h(wanHistoryData);

    const calcStats = (data: WANHistoryItem[]) => {
        if (data.length === 0) {
            return {
                avgDl: '--',
                avgUl: '--',
                avgPing: '--',
                avgJitter: '--'
            };
        }

        const sumDl = data.reduce((sum, d) => sum + d.download_mbps, 0);
        const sumUl = data.reduce((sum, d) => sum + d.upload_mbps, 0);
        const sumPing = data.reduce((sum, d) => sum + (d.ping_ms || 0), 0);
        const sumJitter = data.reduce((sum, d) => sum + (d.jitter_ms || 0), 0);

        const avgDl = sumDl / data.length;
        const avgUl = sumUl / data.length;
        const avgPing = sumPing / data.length;
        const avgJitter = sumJitter / data.length;

        return {
            avgDl: avgDl.toFixed(1),
            avgUl: avgUl.toFixed(1),
            avgPing: avgPing.toFixed(1),
            avgJitter: avgJitter.toFixed(1)
        };
    };

    const wanStats = calcStats(wan24);

    const avgWanDl = document.getElementById('avg-wan-download');
    if (avgWanDl) avgWanDl.textContent = wanStats.avgDl;
    
    const avgWanUl = document.getElementById('avg-wan-upload');
    if (avgWanUl) avgWanUl.textContent = wanStats.avgUl;
    
    const avgWanPing = document.getElementById('avg-wan-ping');
    if (avgWanPing) avgWanPing.textContent = wanStats.avgPing;

    const avgWanJitter = document.getElementById('avg-wan-jitter');
    if (avgWanJitter) avgWanJitter.textContent = wanStats.avgJitter;
}

export function renderHistoryTable(
    appSettings: any,
    currentTranslations: Record<string, string>,
    detailsCallback: (item: any, isWan: boolean) => void,
    deleteCallback: (type: 'wan' | 'lan' | string, id: number) => void,
    unmaskCallback: (mac: string, cell: HTMLElement) => void
) {
    const tbody = document.getElementById('history-body-wan');
    if (!tbody) return;

    const allowDelete = appSettings.allow_delete === 'true';
    const actionHeaders = document.querySelectorAll('.column-actions');
    actionHeaders.forEach(h => {
        if (h instanceof HTMLElement) h.style.display = allowDelete ? 'table-cell' : 'none';
    });
    
    tbody.innerHTML = '';
    
    const totalPages = Math.max(1, Math.ceil(wanHistoryData.length / ITEMS_PER_PAGE));
    if (currentPage > totalPages) currentPage = totalPages;
    
    const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
    const paginatedData = wanHistoryData.slice(startIdx, startIdx + ITEMS_PER_PAGE);
    
    paginatedData.forEach(item => {
        const tr = document.createElement('tr');
        const dateStr = item.test_date; 
        const wanUnit = appSettings.wan_unit || 'Mbps';

        tr.innerHTML = `
            <td>${item.server_name}</td>
            <td class="text-center">${item.ping_ms !== null ? item.ping_ms.toFixed(1) : '--'}</td>
            <td class="text-center">${formatSpeed(item.download_mbps, wanUnit)}</td>
            <td class="text-center">${formatSpeed(item.upload_mbps, wanUnit)}</td>
            <td class="text-center">${dateStr}</td>
            ${allowDelete ? `<td class="text-center column-actions"><button class="btn-icon danger delete-btn"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></td>` : ''}
        `;
        if (allowDelete) {
            const btn = tr.querySelector('.delete-btn');
            if (btn instanceof HTMLElement) {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    deleteCallback('wan', item.id);
                };
            }
        }
        
        tr.style.cursor = 'pointer';
        tr.onclick = () => detailsCallback(item, true);
        
        tbody.appendChild(tr);
    });

    const pageCurrent = document.getElementById('page-current');
    if (pageCurrent) pageCurrent.textContent = String(currentPage);
    
    const pageTotal = document.getElementById('page-total');
    if (pageTotal) pageTotal.textContent = String(totalPages);
    
    const btnPrev = document.getElementById('btn-prev') as HTMLButtonElement | null;
    if (btnPrev) btnPrev.disabled = currentPage === 1;
    
    const btnNext = document.getElementById('btn-next') as HTMLButtonElement | null;
    if (btnNext) btnNext.disabled = currentPage === totalPages;
}

export function setCurrentPage(page: number) {
    currentPage = page;
}
