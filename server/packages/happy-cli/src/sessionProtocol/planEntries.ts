/** Standard ACP plan entries, also accepted by the existing TodoWrite view. */
export interface PlanEntry {
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    priority?: 'high' | 'medium' | 'low';
}

/** Invalid snapshots must not clear a previously valid plan. Empty arrays do. */
export function readPlanEntries(payload: unknown): PlanEntry[] | null {
    if (!payload || typeof payload !== 'object') return null;
    const entries = (payload as { entries?: unknown }).entries;
    if (!Array.isArray(entries)) return null;
    const result: PlanEntry[] = [];
    for (const value of entries) {
        if (!value || typeof value !== 'object') return null;
        const entry = value as Record<string, unknown>;
        if (typeof entry.content !== 'string'
            || typeof entry.status !== 'string'
            || !['pending', 'in_progress', 'completed'].includes(entry.status)
            || (entry.priority !== undefined && (typeof entry.priority !== 'string'
                || !['high', 'medium', 'low'].includes(entry.priority)))) {
            return null;
        }
        result.push({
            content: entry.content,
            status: entry.status as PlanEntry['status'],
            ...(entry.priority !== undefined ? { priority: entry.priority as PlanEntry['priority'] } : {}),
        });
    }
    return result;
}
