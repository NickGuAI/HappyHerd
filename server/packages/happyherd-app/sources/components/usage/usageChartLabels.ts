export function formatUsageChartLabel(
    timestamp: number,
    groupBy: 'hour' | 'day',
): string {
    const date = new Date(timestamp * 1000);

    return groupBy === 'hour'
        ? date.toLocaleTimeString('en-US', { hour: 'numeric' })
        : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
