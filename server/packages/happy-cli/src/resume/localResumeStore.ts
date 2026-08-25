import axios, { AxiosError } from 'axios';

import { decodeBase64, decrypt, encodeBase64 } from '@/api/encryption';
import type { Metadata } from '@/api/types';
import { configuration } from '@/configuration';
import { persistSession, readCredentials, readPersistedSessions, type PersistedSession } from '@/persistence';

import {
    parseResumableMetadata,
    resolveReconnectableSession,
    resolveSessionRecordByPrefix,
    type ReconnectableHappySession,
} from './resolveHappySession';

type PersistedSessionRecord = PersistedSession & {
    id: string;
};

export class LocalResumeSessionError extends Error {
    constructor(
        message: string,
        public readonly code: 'not_found' | 'ambiguous' | 'unavailable',
    ) {
        super(message);
        this.name = 'LocalResumeSessionError';
    }
}

export type BackfilledReconnectableSession = {
    session: ReconnectableHappySession;
    persisted: PersistedSession;
};

function needsFreshMetadata(metadata: Metadata): boolean {
    if (metadata.flavor === 'codex') {
        return !metadata.codexThreadId;
    }
    if (metadata.flavor === 'claude' || !metadata.flavor) {
        return !metadata.claudeSessionId;
    }
    return false;
}

async function fetchServerMetadata(
    sessionId: string,
    encryptionKey: Uint8Array,
    encryptionVariant: 'legacy' | 'dataKey',
): Promise<Metadata | null> {
    const credentials = await readCredentials();
    if (!credentials) {
        return null;
    }

    try {
        const response = await axios.get(`${configuration.serverUrl}/v1/sessions`, {
            headers: {
                Authorization: `Bearer ${credentials.token}`,
                'X-Happy-Client': `cli-coding-session/${configuration.currentCliVersion}`,
            },
            timeout: 10_000,
        });
        const sessions = (response.data as { sessions?: Array<{ id: string; metadata: string }> }).sessions ?? [];
        const matched = sessions.find((session) => session.id === sessionId);
        if (!matched) {
            return null;
        }

        const decrypted = decrypt(encryptionKey, encryptionVariant, decodeBase64(matched.metadata));
        return parseResumableMetadata(sessionId, decrypted);
    } catch (error) {
        if (error instanceof AxiosError && error.response?.status === 401) {
            throw new LocalResumeSessionError(
                'Happy session lookup authentication expired. Run `happy auth login --force` in this environment.',
                'unavailable',
            );
        }
        return null;
    }
}

export async function resolveLocalReconnectableSession(sessionId: string): Promise<ReconnectableHappySession> {
    const records = Object.entries(readPersistedSessions()).map(([id, session]) => ({
        id,
        ...session,
    }));

    if (records.length === 0) {
        throw new LocalResumeSessionError(
            `Cannot resume Happy session "${sessionId}" on this machine: no local session encryption data found at ${configuration.sessionsFile}. Start a new Happy session on this machine to enable future resumes.`,
            'not_found',
        );
    }

    let matched: PersistedSessionRecord;
    try {
        matched = resolveSessionRecordByPrefix(records, sessionId);
    } catch (error) {
        const message = error instanceof Error ? error.message : `No Happy session found matching "${sessionId}"`;
        throw new LocalResumeSessionError(
            `${message}. Only sessions stored in ${configuration.sessionsFile} can be resumed without legacy account credentials.`,
            message.startsWith('Ambiguous') ? 'ambiguous' : 'not_found',
        );
    }

    const encryptionKey = decodeBase64(matched.encryptionKey);
    let metadata = parseResumableMetadata(matched.id, matched.metadata);
    if (needsFreshMetadata(metadata)) {
        metadata = await fetchServerMetadata(matched.id, encryptionKey, matched.encryptionVariant) ?? metadata;
    }

    return {
        id: matched.id,
        active: false,
        metadata,
        seq: matched.seq,
        metadataVersion: matched.metadataVersion,
        agentStateVersion: matched.agentStateVersion,
        encryptionKey,
        encryptionVariant: matched.encryptionVariant,
    };
}

export async function backfillReconnectableSessionForMachine(
    sessionId: string,
    machineId: string,
): Promise<BackfilledReconnectableSession> {
    const session = await resolveReconnectableSession(sessionId);
    if (!session.metadata.machineId) {
        throw new LocalResumeSessionError(
            `Cannot recover Happy session "${session.id}" because it does not identify its originating machine.`,
            'unavailable',
        );
    }
    if (session.metadata.machineId !== machineId) {
        throw new LocalResumeSessionError(
            `Cannot recover Happy session "${session.id}" because it belongs to another machine.`,
            'unavailable',
        );
    }

    const persisted: PersistedSession = {
        encryptionKey: encodeBase64(session.encryptionKey),
        encryptionVariant: session.encryptionVariant,
        seq: session.seq,
        metadataVersion: session.metadataVersion,
        agentStateVersion: session.agentStateVersion,
        metadata: session.metadata,
        savedAt: Date.now(),
    };
    if (!persistSession(session.id, persisted)) {
        throw new LocalResumeSessionError(
            `Cannot recover Happy session "${session.id}" because its reconnect record could not be persisted.`,
            'unavailable',
        );
    }
    return { session, persisted };
}
