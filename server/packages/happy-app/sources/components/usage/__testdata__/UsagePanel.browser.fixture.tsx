import React from 'react';
import { createRoot } from 'react-dom/client';
import { UsagePanel } from '../UsagePanel';

const usageResponse = {
    usage: [{
        timestamp: Math.floor(Date.now() / 1000),
        tokens: { total: 350, claude: 100, codex: 200, grok: 50 },
        cost: { total: 0.12, claude: 0.1, grok: 0.02 },
        reportCount: 4,
    }],
    coverage: [
        { provider: 'claude', tokens: 'reported', cost: 'reported', limitations: [], costBasis: ['provider-estimate'] },
        { provider: 'codex', tokens: 'reported', cost: 'unavailable', limitations: ['cost-not-reported-by-provider'], costBasis: ['unavailable'] },
        { provider: 'grok', tokens: 'reported', cost: 'reported', limitations: [], costBasis: ['provider-reported'] },
        { provider: 'dsh', tokens: 'unavailable', cost: 'unavailable', limitations: ['tokens-not-reported-by-provider', 'cost-not-reported-by-provider'], costBasis: ['unavailable'] },
    ],
};

Object.assign(globalThis, {
    __USAGE_REQUESTS__: [] as unknown[],
    fetch: async (_url: string, options: { body?: string }) => {
        (globalThis as typeof globalThis & { __USAGE_REQUESTS__: unknown[] }).__USAGE_REQUESTS__.push(
            options.body ? JSON.parse(options.body) : null,
        );
        return {
            ok: true,
            status: 200,
            json: async () => usageResponse,
        };
    },
});

createRoot(document.getElementById('root')!).render(<UsagePanel />);
