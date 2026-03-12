/**
 * Chart.js integration and configuration
 */

export let wanChartInstance = null;
export let lanChartInstance = null;

export function renderHistoryChart(wanHistoryData, lanHistoryData, currentHistoryTab, appSettings, currentTranslations) {
    const wanChartWrapper = document.getElementById('wan-chart-wrapper');
    const lanChartWrapper = document.getElementById('lan-chart-wrapper');
    const wanCtx = document.getElementById('wanChart').getContext('2d');
    const lanCtx = document.getElementById('lanChart').getContext('2d');

    const formatDate = (rawDate) => {
        const dt = new Date(rawDate);
        return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    };

    const getChartOptions = (yTitle, yColor) => {
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
    };

    // --- WAN Chart ---
    if (wanHistoryData.length > 0) {
        wanChartWrapper.style.display = currentHistoryTab === 'wan' ? 'block' : 'none';
        let sortedWan = [...wanHistoryData].sort((a,b) => new Date(a.raw_date).getTime() - new Date(b.raw_date).getTime());
        if (sortedWan.length > 24) sortedWan = sortedWan.slice(-24);
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
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        borderWidth: 2, tension: 0.3, yAxisID: 'y'
                    },
                    {
                        label: ulLabel,
                        data: sortedWan.map(d => d.upload_mbps / wanDiv),
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        borderWidth: 2, tension: 0.3, yAxisID: 'y'
                    },
                    {
                        label: pingLabel,
                        data: sortedWan.map(d => d.ping_ms),
                        borderColor: '#fbbf24',
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
        let sortedLan = [...lanHistoryData].sort((a,b) => new Date(a.raw_date).getTime() - new Date(b.raw_date).getTime());
        if (sortedLan.length > 24) sortedLan = sortedLan.slice(-24);
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
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        borderWidth: 2, tension: 0.3, yAxisID: 'y'
                    },
                    {
                        label: ulLabelLan,
                        data: sortedLan.map(d => d.upload_mbps / lanDiv),
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        borderWidth: 2, tension: 0.3, yAxisID: 'y'
                    },
                    {
                        label: pingLabelLan,
                        data: sortedLan.map(d => d.ping_ms),
                        borderColor: '#fbbf24',
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
