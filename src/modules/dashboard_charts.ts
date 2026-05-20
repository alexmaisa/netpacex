/**
 * Dashboard Diagnostic Charts Module
 * Renders success rates, engine statistics, and time-of-day ISP throttling analysis.
 */

declare const Chart: any;

import { WANHistoryItem } from './history';

let successChartInstance: any = null;
let engineChartInstance: any = null;
let timeChartInstance: any = null;

/**
 * Updates all three premium diagnostic charts on the dashboard.
 */
export function updateDashboardCharts(
    historyData: WANHistoryItem[],
    currentTranslations: Record<string, string>
) {
    const container = document.getElementById('dashboard-charts-container');
    if (!container) return;

    if (!historyData || historyData.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';

    // 1. Filter data: last 24 hours (or fallback to 7 days if < 2 tests in 24 hours)
    const nowTime = new Date().getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    let targetData = historyData.filter(d => (nowTime - new Date(d.raw_date).getTime()) <= oneDayMs);
    if (targetData.length < 2) {
        targetData = historyData.filter(d => (nowTime - new Date(d.raw_date).getTime()) <= sevenDaysMs);
    }

    if (targetData.length === 0) {
        // Fallback to all data if still empty
        targetData = historyData;
    }

    // Prepare translation variables
    const successLabel = currentTranslations['lbl_success'] || 'Success';
    const failedLabel = currentTranslations['lbl_failed'] || 'Failed';

    // ==========================================
    // CHART 1: 24h Success Rate (Doughnut)
    // ==========================================
    const successCanvas = document.getElementById('successRateChart') as HTMLCanvasElement | null;
    const successCtx = successCanvas?.getContext('2d');
    if (successCtx) {
        let successCount = 0;
        let failedCount = 0;

        targetData.forEach(d => {
            if (d.status === 'failed') {
                failedCount++;
            } else {
                successCount++; // Treats success and empty status (legacy) as success
            }
        });

        if (successChartInstance) successChartInstance.destroy();

        successChartInstance = new Chart(successCtx, {
            type: 'doughnut',
            data: {
                labels: [successLabel, failedLabel],
                datasets: [{
                    data: [successCount, failedCount],
                    backgroundColor: ['#10b981', '#ef4444'],
                    borderColor: 'rgba(255, 255, 255, 0.05)',
                    borderWidth: 2,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#9ca3af', font: { family: 'Inter', size: 11 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context: any) {
                                const total = successCount + failedCount;
                                const val = context.raw;
                                const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0';
                                return ` ${context.label}: ${val} (${pct}%)`;
                            }
                        }
                    }
                },
                cutout: '70%'
            }
        });
    }

    // ==========================================
    // CHART 2: Engine Performance (Doughnut)
    // ==========================================
    const engineCanvas = document.getElementById('engineStatsChart') as HTMLCanvasElement | null;
    const engineCtx = engineCanvas?.getContext('2d');
    if (engineCtx) {
        const counts = {
            mlab_success: 0, mlab_failed: 0,
            cloudflare_success: 0, cloudflare_failed: 0,
            ookla_success: 0, ookla_failed: 0
        };

        targetData.forEach(d => {
            const eng = (d.engine || 'ookla').toLowerCase();
            const isSuccess = d.status !== 'failed';

            if (eng === 'mlab') {
                if (isSuccess) counts.mlab_success++; else counts.mlab_failed++;
            } else if (eng === 'cloudflare') {
                if (isSuccess) counts.cloudflare_success++; else counts.cloudflare_failed++;
            } else {
                if (isSuccess) counts.ookla_success++; else counts.ookla_failed++;
            }
        });

        const labels: string[] = [];
        const data: number[] = [];
        const bgColors: string[] = [];

        const addSegment = (label: string, count: number, color: string) => {
            if (count > 0) {
                labels.push(label);
                data.push(count);
                bgColors.push(color);
            }
        };

        addSegment('M-Lab (Success)', counts.mlab_success, '#3b82f6');
        addSegment('M-Lab (Failed)', counts.mlab_failed, 'rgba(59, 130, 246, 0.35)');
        addSegment('Cloudflare (Success)', counts.cloudflare_success, '#8b5cf6');
        addSegment('Cloudflare (Failed)', counts.cloudflare_failed, 'rgba(139, 92, 246, 0.35)');
        addSegment('Ookla (Success)', counts.ookla_success, '#f59e0b');
        addSegment('Ookla (Failed)', counts.ookla_failed, 'rgba(245, 158, 11, 0.35)');

        // If completely empty, show placeholders
        if (data.length === 0) {
            labels.push('No Tests');
            data.push(1);
            bgColors.push('rgba(255, 255, 255, 0.05)');
        }

        if (engineChartInstance) engineChartInstance.destroy();

        engineChartInstance = new Chart(engineCtx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: bgColors,
                    borderColor: 'rgba(255, 255, 255, 0.05)',
                    borderWidth: 2,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#9ca3af', font: { family: 'Inter', size: 10 } }
                    }
                },
                cutout: '70%'
            }
        });
    }

    // ==========================================
    // CHART 3: Time-of-Day Performance (Bar)
    // ==========================================
    const timeCanvas = document.getElementById('timePerformanceChart') as HTMLCanvasElement | null;
    const timeCtx = timeCanvas?.getContext('2d');
    if (timeCtx) {
        // Group successful records into 4 blocks of time
        const blocks = {
            night: { dl: [] as number[], ul: [] as number[] },       // 00:00 - 05:59
            morning: { dl: [] as number[], ul: [] as number[] },     // 06:00 - 11:59
            afternoon: { dl: [] as number[], ul: [] as number[] },   // 12:00 - 17:59
            evening: { dl: [] as number[], ul: [] as number[] }      // 18:00 - 23:59
        };

        // Filter only success runs
        const successData = targetData.filter(d => d.status !== 'failed');

        successData.forEach(d => {
            const dt = new Date(d.raw_date);
            const hour = dt.getHours();
            const dl = d.download_mbps || 0;
            const ul = d.upload_mbps || 0;

            if (hour >= 0 && hour < 6) {
                blocks.night.dl.push(dl);
                blocks.night.ul.push(ul);
            } else if (hour >= 6 && hour < 12) {
                blocks.morning.dl.push(dl);
                blocks.morning.ul.push(ul);
            } else if (hour >= 12 && hour < 18) {
                blocks.afternoon.dl.push(dl);
                blocks.afternoon.ul.push(ul);
            } else {
                blocks.evening.dl.push(dl);
                blocks.evening.ul.push(ul);
            }
        });

        const getAvg = (arr: number[]) => {
            if (arr.length === 0) return 0;
            return arr.reduce((a, b) => a + b, 0) / arr.length;
        };

        const chartLabels = [
            currentTranslations['lbl_night'] || 'Night (00-06)',
            currentTranslations['lbl_morning'] || 'Morning (06-12)',
            currentTranslations['lbl_afternoon'] || 'Afternoon (12-18)',
            currentTranslations['lbl_evening'] || 'Evening (18-00)'
        ];

        const avgDlData = [
            getAvg(blocks.night.dl),
            getAvg(blocks.morning.dl),
            getAvg(blocks.afternoon.dl),
            getAvg(blocks.evening.dl)
        ];

        const avgUlData = [
            getAvg(blocks.night.ul),
            getAvg(blocks.morning.ul),
            getAvg(blocks.afternoon.ul),
            getAvg(blocks.evening.ul)
        ];

        if (timeChartInstance) timeChartInstance.destroy();

        timeChartInstance = new Chart(timeCtx, {
            type: 'bar',
            data: {
                labels: chartLabels,
                datasets: [
                    {
                        label: currentTranslations['lbl_download'] || 'Download',
                        data: avgDlData,
                        backgroundColor: '#3b82f6',
                        borderRadius: 4
                    },
                    {
                        label: currentTranslations['lbl_upload'] || 'Upload',
                        data: avgUlData,
                        backgroundColor: '#10b981',
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#9ca3af', font: { family: 'Inter', size: 10 } }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#9ca3af', font: { family: 'Inter', size: 9 } },
                        grid: { color: 'rgba(255, 255, 255, 0.03)' }
                    },
                    y: {
                        ticks: { color: '#9ca3af', font: { family: 'Inter', size: 10 } },
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        title: { display: true, text: 'Mbps', color: '#9ca3af' }
                    }
                }
            }
        });
    }
}
