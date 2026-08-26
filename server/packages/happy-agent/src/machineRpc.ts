import { io, Socket } from 'socket.io-client';
import type { Config } from './config';
import type { DecryptedMachine } from './api';
import { decodeBase64, encodeBase64, encrypt, decrypt } from './encryption';

export type SupportedAgent = 'claude' | 'codex' | 'gemini' | 'agy';

export type SpawnSessionRuntimeContext = {
    surfaceId: string;
    capabilityId: string;
    brokerUrl: string;
    tools: Array<{
        name: string;
        family: string;
        description: string;
    }>;
};

export type SpawnSessionOnMachineOptions = {
    directory: string;
    approvedNewDirectoryCreation?: boolean;
    agent?: SupportedAgent;
    providerToken?: string;
    permissionMode?: string;
    modelMode?: string;
    effortLevel?: string;
    commanderId?: string;
    runtimeContext?: SpawnSessionRuntimeContext;
};

export type SpawnMachineSessionResult =
    | { type: 'success'; sessionId: string }
    | { type: 'requestToApproveDirectoryCreation'; directory: string }
    | { type: 'error'; errorMessage: string };

type RpcAck = {
    ok: boolean;
    result?: string;
    error?: string;
};

function waitForConnect(socket: Socket, timeoutMs = 10_000): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (socket.connected) {
            resolve();
            return;
        }

        const timeout = setTimeout(() => {
            socket.off('connect', onConnect);
            socket.off('connect_error', onError);
            reject(new Error('Timeout waiting for socket connection'));
        }, timeoutMs);

        const onConnect = () => {
            clearTimeout(timeout);
            socket.off('connect_error', onError);
            resolve();
        };

        const onError = (error: Error) => {
            clearTimeout(timeout);
            socket.off('connect', onConnect);
            reject(error);
        };

        socket.once('connect', onConnect);
        socket.once('connect_error', onError);
    });
}

function normalizeRpcError(error: string | undefined, machineId: string): string {
    if (!error) {
        return 'RPC call failed';
    }
    if (error === 'RPC method not available') {
        return `Machine ${machineId} is offline or its daemon is not connected.`;
    }
    return error;
}

function requireBoundedContextValue(value: string | undefined, label: string): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    const normalized = value.trim();
    if (normalized.length === 0 || normalized.length > 512 || normalized.includes('\0')) {
        throw new Error(`${label} must be a non-empty string no longer than 512 characters`);
    }
    return normalized;
}

function normalizedRuntimeContext(
    context: SpawnSessionRuntimeContext | undefined,
): SpawnSessionRuntimeContext | undefined {
    if (!context) {
        return undefined;
    }
    if (!Array.isArray(context.tools) || context.tools.length === 0 || context.tools.length > 32) {
        throw new Error('tools must contain between 1 and 32 governed tool definitions');
    }
    const tools = context.tools.map((tool, index) => ({
        name: requireBoundedContextValue(tool?.name, `tools[${index}].name`)!,
        family: requireBoundedContextValue(tool?.family, `tools[${index}].family`)!,
        description: requireBoundedContextValue(tool?.description, `tools[${index}].description`)!,
    }));
    return {
        surfaceId: requireBoundedContextValue(context.surfaceId, 'surfaceId')!,
        capabilityId: requireBoundedContextValue(context.capabilityId, 'capabilityId')!,
        brokerUrl: requireBoundedContextValue(context.brokerUrl, 'brokerUrl')!,
        tools,
    };
}

export async function spawnSessionOnMachine(
    config: Config,
    machine: DecryptedMachine,
    token: string,
    options: SpawnSessionOnMachineOptions,
): Promise<SpawnMachineSessionResult> {
    const socket = io(config.serverUrl, {
        auth: {
            token,
        },
        path: '/v1/updates',
        transports: ['websocket'],
        autoConnect: false,
        reconnection: false,
    });

    socket.connect();

    try {
        await waitForConnect(socket);

        const params = encodeBase64(
            encrypt(machine.encryption.key, machine.encryption.variant, {
                type: 'spawn-in-directory',
                directory: options.directory,
                approvedNewDirectoryCreation: options.approvedNewDirectoryCreation ?? false,
                token: options.providerToken,
                agent: options.agent,
                permissionMode: options.permissionMode,
                modelMode: options.modelMode,
                effortLevel: options.effortLevel,
                commanderId: options.commanderId,
                runtimeContext: normalizedRuntimeContext(options.runtimeContext),
            }),
        );

        const response = await socket.timeout(30_000).emitWithAck('rpc-call', {
            method: `${machine.id}:spawn-happy-session`,
            params,
        }) as RpcAck;

        if (!response.ok) {
            throw new Error(normalizeRpcError(response.error, machine.id));
        }
        if (!response.result) {
            throw new Error('RPC call returned no result');
        }

        const decrypted = decrypt(
            machine.encryption.key,
            machine.encryption.variant,
            decodeBase64(response.result),
        );

        if (decrypted == null || typeof decrypted !== 'object' || Array.isArray(decrypted)) {
            throw new Error('RPC call returned invalid data');
        }

        if ('error' in decrypted && typeof decrypted.error === 'string') {
            throw new Error(String(decrypted.error));
        }

        if (
            !('type' in decrypted)
            || (
                decrypted.type !== 'success'
                && decrypted.type !== 'requestToApproveDirectoryCreation'
                && decrypted.type !== 'error'
            )
        ) {
            throw new Error('RPC call returned unexpected data');
        }

        return decrypted as SpawnMachineSessionResult;
    } finally {
        socket.close();
    }
}

export async function resumeSessionOnMachine(
    config: Config,
    machine: DecryptedMachine,
    token: string,
    sessionId: string,
    runtimeContext?: SpawnSessionRuntimeContext,
): Promise<SpawnMachineSessionResult> {
    const socket = io(config.serverUrl, {
        auth: {
            token,
        },
        path: '/v1/updates',
        transports: ['websocket'],
        autoConnect: false,
        reconnection: false,
    });

    socket.connect();

    try {
        await waitForConnect(socket);

        const params = encodeBase64(
            encrypt(machine.encryption.key, machine.encryption.variant, {
                sessionId,
                runtimeContext: normalizedRuntimeContext(runtimeContext),
            }),
        );

        const response = await socket.timeout(30_000).emitWithAck('rpc-call', {
            method: `${machine.id}:resume-happy-session`,
            params,
        }) as RpcAck;

        if (!response.ok) {
            throw new Error(normalizeRpcError(response.error, machine.id));
        }
        if (!response.result) {
            throw new Error('RPC call returned no result');
        }

        const decrypted = decrypt(
            machine.encryption.key,
            machine.encryption.variant,
            decodeBase64(response.result),
        );

        if (decrypted == null || typeof decrypted !== 'object' || Array.isArray(decrypted)) {
            throw new Error('RPC call returned invalid data');
        }

        if ('error' in decrypted && typeof decrypted.error === 'string') {
            throw new Error(String(decrypted.error));
        }

        if (
            !('type' in decrypted)
            || (
                decrypted.type !== 'success'
                && decrypted.type !== 'requestToApproveDirectoryCreation'
                && decrypted.type !== 'error'
            )
        ) {
            throw new Error('RPC call returned unexpected data');
        }

        return decrypted as SpawnMachineSessionResult;
    } finally {
        socket.close();
    }
}
