import type { Config } from './config';
import {
    HappyHerdMachineSessionSettingsSchema,
    type HappyHerdMachineSessionSettings,
} from '@slopus/happy-wire';
import { loadConfig } from './config';
import type { Credentials } from './credentials';
import { requireCredentials } from './credentials';
import {
    getSessionMessages,
    listActiveSessions,
    listMachines,
    listSessions,
    type DecryptedMachine,
    type DecryptedMessage,
    type DecryptedSession,
} from './api';
import {
    callMachineRpc as invokeMachineRpc,
    resumeSessionOnMachine,
    spawnSessionOnMachine as invokeSpawnSessionOnMachine,
    type SupportedAgent,
    type SpawnSessionRuntimeContext,
} from './machineRpc';
import { SessionClient, type TurnResult } from './session';

export type HappyControlClientOptions = {
    config: Config;
    credentials: Credentials;
};

export type SpawnCodexSessionOptions = {
    machineId: string;
    directory: string;
    commanderId: string;
    approvedNewDirectoryCreation?: boolean;
    permissionMode?: string;
    modelMode?: string;
    effortLevel?: string;
    runtimeContext?: SpawnSessionRuntimeContext;
};

export type SpawnMachineSessionOptions = {
    directory: string;
    approvedNewDirectoryCreation: boolean;
    agent: SupportedAgent;
    permissionMode?: string;
    modelMode?: string;
    effortLevel?: string;
    commanderId?: string;
    runtimeContext?: SpawnSessionRuntimeContext;
    resumeClaudeSessionId?: string;
    resumeCodexThreadId?: string;
    parentSessionId?: string;
    isSideChat?: boolean;
};

export type ConfirmedMachineSession = {
    session: DecryptedSession;
    settings: HappyHerdMachineSessionSettings;
};

export type SendTurnOptions = {
    sessionId: string;
    text: string;
    localId: string;
    meta?: Record<string, unknown>;
    timeoutMs?: number;
};

function resolveById<T extends { id: string }>(items: T[], value: string, label: string): T {
    const exact = items.find((item) => item.id === value);
    if (exact) {
        return exact;
    }
    const matches = items.filter((item) => item.id.startsWith(value));
    if (matches.length === 0) {
        throw new Error(`No ${label} found matching "${value}"`);
    }
    if (matches.length > 1) {
        throw new Error(`Ambiguous ${label} "${value}" matches ${matches.length} records`);
    }
    return matches[0];
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HappyControlClient {
    readonly config: Config;
    readonly credentials: Credentials;

    constructor(options: HappyControlClientOptions) {
        this.config = options.config;
        this.credentials = options.credentials;
    }

    static fromEnvironment(): HappyControlClient {
        const config = loadConfig();
        return new HappyControlClient({
            config,
            credentials: requireCredentials(config),
        });
    }

    listSessions(): Promise<DecryptedSession[]> {
        return listSessions(this.config, this.credentials);
    }

    listActiveSessions(): Promise<DecryptedSession[]> {
        return listActiveSessions(this.config, this.credentials);
    }

    listMachines(): Promise<DecryptedMachine[]> {
        return listMachines(this.config, this.credentials);
    }

    async resolveSession(sessionId: string): Promise<DecryptedSession> {
        return resolveById(await this.listSessions(), sessionId, 'session');
    }

    async resolveMachine(machineId: string): Promise<DecryptedMachine> {
        return resolveById(await this.listMachines(), machineId, 'machine');
    }

    createSessionClient(session: DecryptedSession): SessionClient {
        return new SessionClient({
            sessionId: session.id,
            encryptionKey: session.encryption.key,
            encryptionVariant: session.encryption.variant,
            token: this.credentials.token,
            serverUrl: this.config.serverUrl,
            initialAgentState: session.agentState,
            initialSequence: session.seq,
        });
    }

    callMachineRpc<TResult = unknown>(
        machine: DecryptedMachine,
        method: string,
        params: Record<string, unknown>,
    ): Promise<TResult> {
        return invokeMachineRpc<TResult>(
            this.config,
            machine,
            this.credentials.token,
            method,
            params,
        );
    }

    async waitForSession(sessionId: string, timeoutMs = 15_000): Promise<DecryptedSession> {
        const deadline = Date.now() + timeoutMs;
        let lastError: unknown;
        do {
            try {
                return await this.resolveSession(sessionId);
            } catch (error) {
                lastError = error;
                await delay(250);
            }
        } while (Date.now() < deadline);

        const detail = lastError instanceof Error ? `: ${lastError.message}` : '';
        throw new Error(`Timed out waiting for HappyHerd session ${sessionId}${detail}`);
    }

    async spawnCodexSession(options: SpawnCodexSessionOptions): Promise<DecryptedSession> {
        const machine = await this.resolveMachine(options.machineId);
        return this.spawnSessionOnMachine(machine, {
            directory: options.directory,
            approvedNewDirectoryCreation: options.approvedNewDirectoryCreation ?? false,
            agent: 'codex',
            permissionMode: options.permissionMode,
            modelMode: options.modelMode,
            effortLevel: options.effortLevel,
            commanderId: options.commanderId,
            runtimeContext: options.runtimeContext,
        });
    }

    async spawnSessionOnMachine(
        machine: DecryptedMachine,
        options: SpawnMachineSessionOptions,
    ): Promise<DecryptedSession> {
        const result = await this.requestMachineSession(machine, options);
        return this.waitForSession(result.sessionId);
    }

    async spawnSessionOnMachineConfirmed(
        machine: DecryptedMachine,
        options: SpawnMachineSessionOptions,
    ): Promise<ConfirmedMachineSession> {
        const result = await this.requestMachineSession(machine, options);
        const confirmedSettings = HappyHerdMachineSessionSettingsSchema.safeParse(result.settings);
        if (!confirmedSettings.success) {
            throw new Error(`Session ${result.sessionId} did not return confirmed machine-session settings`);
        }
        const session = await this.waitForSession(result.sessionId);
        const metadata = session.metadata && typeof session.metadata === 'object' && !Array.isArray(session.metadata)
            ? session.metadata as Record<string, unknown>
            : null;
        const persistedSettings = HappyHerdMachineSessionSettingsSchema.safeParse(metadata?.spawnSettings);
        if (!persistedSettings.success) {
            throw new Error(`Session ${result.sessionId} did not persist its confirmed machine-session settings`);
        }
        if (JSON.stringify(persistedSettings.data) !== JSON.stringify(confirmedSettings.data)) {
            throw new Error(`Session ${result.sessionId} persisted settings that do not match the target daemon receipt`);
        }
        return { session, settings: confirmedSettings.data };
    }

    private async requestMachineSession(
        machine: DecryptedMachine,
        options: SpawnMachineSessionOptions,
    ) {
        const result = await invokeSpawnSessionOnMachine(
            this.config,
            machine,
            this.credentials.token,
            {
                directory: options.directory,
                approvedNewDirectoryCreation: options.approvedNewDirectoryCreation,
                agent: options.agent,
                permissionMode: options.permissionMode,
                modelMode: options.modelMode,
                effortLevel: options.effortLevel,
                commanderId: options.commanderId,
                runtimeContext: options.runtimeContext,
                resumeClaudeSessionId: options.resumeClaudeSessionId,
                resumeCodexThreadId: options.resumeCodexThreadId,
                parentSessionId: options.parentSessionId,
                isSideChat: options.isSideChat,
            },
        );

        if (result.type === 'requestToApproveDirectoryCreation') {
            throw new Error(`Directory creation requires approval: ${result.directory}`);
        }
        if (result.type === 'error') {
            throw new Error(result.errorMessage);
        }
        return result;
    }

    async resumeSession(
        sessionId: string,
        runtimeContext?: SpawnSessionRuntimeContext,
    ): Promise<DecryptedSession> {
        const session = await this.resolveSession(sessionId);
        const metadata = session.metadata as { machineId?: unknown } | null;
        if (typeof metadata?.machineId !== 'string' || metadata.machineId.length === 0) {
            throw new Error(`Session ${session.id} has no machine binding`);
        }
        const machine = await this.resolveMachine(metadata.machineId);
        const result = await resumeSessionOnMachine(
            this.config,
            machine,
            this.credentials.token,
            session.id,
            runtimeContext,
        );
        if (result.type !== 'success') {
            const detail = result.type === 'error'
                ? result.errorMessage
                : `directory approval requested for ${result.directory}`;
            throw new Error(`Unable to resume HappyHerd session ${session.id}: ${detail}`);
        }
        return this.waitForSession(result.sessionId);
    }

    async sendTurn(options: SendTurnOptions): Promise<TurnResult> {
        const session = await this.resolveSession(options.sessionId);
        const client = this.createSessionClient(session);
        try {
            await client.waitForConnect();
            const result = client.waitForTurnResult({
                timeoutMs: options.timeoutMs,
                afterSeq: client.getLatestSequence(),
            });
            client.sendMessage(options.text, options.meta, options.localId);
            return await result;
        } finally {
            client.close();
        }
    }

    async getSessionMessages(sessionId: string): Promise<DecryptedMessage[]> {
        const session = await this.resolveSession(sessionId);
        return getSessionMessages(
            this.config,
            this.credentials,
            session.id,
            session.encryption,
        );
    }
}

export type {
    Config,
    Credentials,
    DecryptedMachine,
    DecryptedMessage,
    DecryptedSession,
    SpawnSessionRuntimeContext,
    TurnResult,
};
