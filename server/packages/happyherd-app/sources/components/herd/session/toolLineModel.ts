import type { ToolCall } from '@/sync/typesMessage';
import type { Metadata } from '@/sync/storageTypes';
import { resolvePath } from '@/utils/pathUtils';
import { t } from '@/text';
import { countContentStats, countPatchStats } from '@/components/diff/engine/stats';
import { getPatchChanges, getPatchInput, getPatchKindType } from '@/utils/codexPatchEntry';
import { materializeUnifiedDiffPatch } from '@/utils/codexUnifiedDiff';
import { getTerminalToolCommand, getToolActivityLabel, getToolSummaryDetail } from '@/utils/toolDisplay';

/**
 * The compact tool row of the session stream (UI overhaul): a verb in the
 * interface face followed by a monospaced argument, e.g. `Ran` `pnpm test` or
 * `Read` `src/app.ts`. It is derived from the same authoritative activity
 * label as before, so provider-supplied titles and descriptions still win and
 * are shown whole.
 */
export type ToolLineText = {
    verb: string;
    argument: string | null;
};

export function resolveToolLineText(
    tool: Pick<ToolCall, 'name' | 'title' | 'input' | 'description'>,
    metadata?: Metadata | null,
): ToolLineText {
    const label = getToolActivityLabel(tool);
    const command = getTerminalToolCommand(tool);
    if (command && label === command) {
        return { verb: t('toolGroup.ran'), argument: command };
    }
    const detail = getToolSummaryDetail({ ...tool, description: null });
    const suffix = detail ? `: ${detail}` : null;
    if (detail && suffix && label.length > suffix.length && label.endsWith(suffix)) {
        // File arguments read relative to the session folder, like tool headers.
        const argument = metadata && isPathDetail(tool.input, detail) ? resolvePath(detail, metadata) : detail;
        return { verb: label.slice(0, label.length - suffix.length), argument };
    }
    return { verb: label, argument: null };
}

function isPathDetail(input: unknown, detail: string): boolean {
    if (!input || typeof input !== 'object') return false;
    const record = input as Record<string, unknown>;
    return ['file_path', 'target_file', 'path', 'target_directory'].some((key) => (
        typeof record[key] === 'string' && (record[key] as string).trim() === detail
    ));
}

export type ToolLineStats = { additions: number; deletions: number };

function readString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

/** `+N −N` for tools that change files; null for everything else. */
export function resolveToolLineStats(tool: Pick<ToolCall, 'name' | 'input'>): ToolLineStats | null {
    const input = tool.input as Record<string, unknown> | null | undefined;
    if (!input || typeof input !== 'object') return null;
    try {
        if (tool.name === 'Edit') {
            const oldText = readString(input.old_string);
            const newText = readString(input.new_string);
            return oldText === null && newText === null ? null : countContentStats(oldText ?? '', newText ?? '');
        }
        if (tool.name === 'MultiEdit' && Array.isArray(input.edits)) {
            const total = { additions: 0, deletions: 0 };
            for (const edit of input.edits as Array<Record<string, unknown>>) {
                const stats = countContentStats(readString(edit?.old_string) ?? '', readString(edit?.new_string) ?? '');
                total.additions += stats.additions;
                total.deletions += stats.deletions;
            }
            return total;
        }
        if (tool.name === 'Write') {
            const content = readString(input.content);
            return content === null ? null : countContentStats('', content);
        }
        const changes = getPatchChanges(input);
        if (!changes) return null;
        const total = { additions: 0, deletions: 0 };
        let counted = false;
        for (const [file, change] of Object.entries(changes)) {
            const diffInput = getPatchInput(change);
            if (!diffInput) continue;
            const stats = diffInput.kind === 'patch'
                ? countPatchStats(materializeUnifiedDiffPatch(diffInput.patch, file, getPatchKindType(change)))
                : countContentStats(diffInput.oldText, diffInput.newText);
            total.additions += stats.additions;
            total.deletions += stats.deletions;
            counted = true;
        }
        return counted ? total : null;
    } catch {
        return null;
    }
}

/** Elapsed seconds, one decimal, as the running timer shows them. */
export function formatToolSeconds(milliseconds: number): string {
    return `${Math.max(0, milliseconds / 1000).toFixed(1)}s`;
}
