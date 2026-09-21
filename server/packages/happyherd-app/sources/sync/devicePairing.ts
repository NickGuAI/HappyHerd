import {
    DevicePairingCheckResponseSchema,
    DevicePairingConfirmResponseSchema,
    DevicePairingIdentitySchema,
} from '@happyherd/wire';
import { apiSocket } from '@/sync/apiSocket';
import type { Machine } from '@/sync/storageTypes';

async function pairingRPC(machineId: string, method: string, params: object): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            apiSocket.machineRPC(machineId, method, params),
            new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Device unavailable')), 8000); }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

export type PairingFailure = 'invalid' | 'not_found' | 'expired' | 'cancelled' | 'used' | 'collision' | 'unavailable' | 'network' | 'identity';
export type PairingTarget = { machineId: string; host: string; expiresAt: number };
export type PairingCheck = { status: 'pending'; target: PairingTarget } | { status: PairingFailure };
export type PairingConfirmation = { status: 'connected'; machineId: string; host: string } | { status: PairingFailure };

/** Accept only the documented whole-code formats; never truncate or discard letters. */
export function normalizeDevicePairingCode(value: string): string | null {
    const trimmed = value.trim();
    if (/^\d{8}$/.test(trimmed)) return trimmed;
    if (/^\d{4}[- ]\d{4}$/.test(trimmed)) return trimmed.replace(/[- ]/, '');
    return null;
}

export async function checkDevicePairing(machines: Machine[], code: string): Promise<PairingCheck> {
    if (!normalizeDevicePairingCode(code)) return { status: 'invalid' };
    const eligible = machines.filter((machine) => machine.metadata?.devicePairingProtocolVersion === 1);
    if (eligible.length === 0) return { status: 'unavailable' };
    const responses = await Promise.allSettled(eligible.map(async (machine) => {
        const response = DevicePairingCheckResponseSchema.parse(await pairingRPC(
            machine.id, 'happyherd-device-pairing-check', { code: normalizeDevicePairingCode(code)! },
        ));
        if (response.status === 'pending' && response.machineId !== machine.id) throw new Error('Device identity mismatch');
        return response;
    }));
    const matches = responses.flatMap((response) => response.status === 'fulfilled' && response.value.status === 'pending' ? [response.value] : []);
    if (matches.length > 1) return { status: 'collision' };
    if (matches.length === 1) {
        const { machineId, host, expiresAt } = matches[0];
        return { status: 'pending', target: { machineId, host, expiresAt } };
    }
    for (const status of ['expired', 'used', 'cancelled'] as const) {
        if (responses.some((response) => response.status === 'fulfilled' && response.value.status === status)) return { status };
    }
    if (responses.some((response) => response.status === 'rejected')) return { status: 'network' };
    return { status: 'not_found' };
}

export async function confirmDevicePairing(target: PairingTarget, code: string, requestId: string): Promise<PairingConfirmation> {
    try {
        const response = DevicePairingConfirmResponseSchema.parse(await pairingRPC(
            target.machineId, 'happyherd-device-pairing-confirm', { code, requestId },
        ));
        if (response.status === 'connected' && (response.machineId !== target.machineId || response.host !== target.host)) return { status: 'identity' };
        return response;
    } catch {
        // Do not surface raw transport errors: they can contain RPC payloads.
        return { status: 'network' };
    }
}

export async function verifyDeviceIdentity(machineId: string): Promise<boolean> {
    try {
        const identity = DevicePairingIdentitySchema.parse(await pairingRPC(machineId, 'happyherd-device-pairing-identity', {}));
        return identity.machineId === machineId;
    } catch {
        return false;
    }
}
