import axios from 'axios';

import { configuration } from '@/configuration';

export type SessionListRecord = {
    id: string;
    active: boolean;
    metadata: string;
    metadataVersion: number;
    agentState: string | null;
    agentStateVersion: number;
    seq: number;
    dataEncryptionKey: string | null;
};

type SessionListPage = {
    sessions?: SessionListRecord[];
    nextCursor?: string | null;
};

export async function loadSessionRecords(
    token: string,
    options: { exactId?: string; timeout?: number } = {},
): Promise<SessionListRecord[]> {
    const records: SessionListRecord[] = [];
    let cursor: string | undefined;

    do {
        const response = await axios.get<SessionListPage>(`${configuration.serverUrl}/v2/sessions`, {
            headers: {
                Authorization: `Bearer ${token}`,
                'X-Happy-Client': `cli-coding-session/${configuration.currentCliVersion}`,
            },
            params: {
                limit: 200,
                ...(cursor ? { cursor } : {}),
            },
            ...(options.timeout ? { timeout: options.timeout } : {}),
        });
        const page = response.data.sessions ?? [];
        if (options.exactId) {
            const matched = page.find((record) => record.id === options.exactId);
            if (matched) return [matched];
        } else {
            records.push(...page);
        }
        cursor = response.data.nextCursor ?? undefined;
    } while (cursor);

    return records;
}
