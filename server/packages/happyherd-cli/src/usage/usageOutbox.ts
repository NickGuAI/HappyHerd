import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentState } from '@/api/types';
import { atomicFileWrite } from '@/utils/fileAtomic';
import type { ProviderUsageReport } from './providerUsage';

export type DurableUsageOutboxRecord = {
    report: ProviderUsageReport;
    usageCursors?: AgentState['usageCursors'];
};

function hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

export class DurableUsageOutbox {
    private readonly directory: string;

    constructor(happyHomeDir: string, sessionId: string) {
        this.directory = join(happyHomeDir, 'runtime', 'usage-outbox', hash(sessionId));
    }

    load(): DurableUsageOutboxRecord[] {
        if (!existsSync(this.directory)) return [];
        const records: DurableUsageOutboxRecord[] = [];
        for (const filename of readdirSync(this.directory).filter((name) => name.endsWith('.json'))) {
            try {
                const parsed = JSON.parse(readFileSync(join(this.directory, filename), 'utf8')) as DurableUsageOutboxRecord;
                if (!parsed?.report || typeof parsed.report.key !== 'string') continue;
                records.push(parsed);
            } catch {
                // Ignore a malformed orphan. Atomic writes ensure an active
                // enqueue never exposes a partially written JSON file.
            }
        }
        return records.sort((left, right) => left.report.occurredAt - right.report.occurredAt);
    }

    async write(record: DurableUsageOutboxRecord): Promise<void> {
        await mkdir(this.directory, { recursive: true });
        await atomicFileWrite(this.pathFor(record.report.key), JSON.stringify(record));
    }

    async remove(key: string): Promise<void> {
        try {
            await unlink(this.pathFor(key));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
    }

    private pathFor(key: string): string {
        return join(this.directory, `${hash(key)}.json`);
    }
}
