import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableUsageOutbox } from './usageOutbox';

describe('DurableUsageOutbox', () => {
    let root: string | undefined;

    afterEach(() => {
        if (root) rmSync(root, { recursive: true, force: true });
        root = undefined;
    });

    it('round-trips an exact report and its crash-consistent cumulative cursor', async () => {
        root = mkdtempSync(join(tmpdir(), 'happyherd-usage-outbox-'));
        const outbox = new DurableUsageOutbox(root, 'session/private');
        const record = {
            report: {
                key: 'usage-v2:grok:turn/private',
                provider: 'grok' as const,
                model: 'grok-code',
                source: 'acp-prompt-response',
                occurredAt: 1_788_436_800_000,
                tokens: { total: 12, input: 10, output: 2, cache_creation: 0, cache_read: 0 },
                cost: { total: 0.02 },
                costBasis: 'provider-reported' as const,
                tokensAvailable: true,
                costAvailable: true,
                limitations: [],
            },
            usageCursors: { acpCostUsd: { 'provider-session/private': 0.25 } },
        };

        await outbox.write(record);
        expect(outbox.load()).toEqual([record]);

        await outbox.remove(record.report.key);
        expect(outbox.load()).toEqual([]);
    });
});
