/**
 * Shared utility functions
 */

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function formatSpeed(mbps, unit) {
    if (mbps === null || mbps === undefined) return '--';
    if (unit === 'Gbps') {
        return (mbps / 1000).toFixed(3);
    }
    return mbps.toFixed(1);
}

export function maskMAC(mac) {
    if (!mac || mac === 'Unknown MAC' || mac.includes('Localhost')) return mac;
    return 'XX:XX:XX:XX:XX:XX';
}

export function generatePayload(mb) {
    const sizeBytes = mb * 1024 * 1024;
    const arr = new Int8Array(sizeBytes);
    for (let i = 0; i < sizeBytes; i++) {
        arr[i] = Math.floor(Math.random() * 256) - 128;
    }
    return arr.buffer;
}
