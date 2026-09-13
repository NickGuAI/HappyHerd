import {
    CredentialLoginFlowSchema,
    ManagedProviderAccountListSchema,
    type CredentialAccountRenameRequest,
    type CredentialAccountTarget,
    type CredentialLoginFlow,
    type CredentialLoginStartRequest,
    type ManagedProviderAccountSummary,
} from '@slopus/happy-wire';
import type { ZodType } from 'zod';

import { apiSocket } from './apiSocket';

async function credentialMachineRPC<T>(
    machineId: string,
    method: string,
    input: unknown,
    schema: ZodType<T>,
): Promise<T> {
    const response = await apiSocket.machineRPC<unknown, unknown>(machineId, method, input);
    const parsed = schema.safeParse(response);
    if (parsed.success) return parsed.data;
    if (response && typeof response === 'object' && 'error' in response && typeof response.error === 'string') {
        throw new Error(response.error);
    }
    throw parsed.error;
}

async function accountMutation(
    machineId: string,
    method: string,
    input: CredentialAccountTarget | CredentialAccountRenameRequest,
): Promise<ManagedProviderAccountSummary[]> {
    return (await credentialMachineRPC(machineId, method, input, ManagedProviderAccountListSchema)).accounts;
}

export async function listManagedCredentialAccounts(machineId: string): Promise<ManagedProviderAccountSummary[]> {
    const response = await credentialMachineRPC(
        machineId,
        'happyherd-credential-accounts-list',
        {},
        ManagedProviderAccountListSchema,
    );
    return response.accounts;
}

export const useManagedCredentialAccount = (machineId: string, input: CredentialAccountTarget) => (
    accountMutation(machineId, 'happyherd-credential-accounts-use', input)
);

export const renameManagedCredentialAccount = (
    machineId: string,
    input: CredentialAccountRenameRequest,
) => accountMutation(machineId, 'happyherd-credential-accounts-rename', input);

export const removeManagedCredentialAccount = (machineId: string, input: CredentialAccountTarget) => (
    accountMutation(machineId, 'happyherd-credential-accounts-remove', input)
);

export async function startManagedCredentialLogin(
    machineId: string,
    input: CredentialLoginStartRequest,
): Promise<CredentialLoginFlow> {
    return credentialMachineRPC(
        machineId,
        'happyherd-credential-auth-start',
        input,
        CredentialLoginFlowSchema,
    );
}

export async function getManagedCredentialLogin(
    machineId: string,
    id: string,
): Promise<CredentialLoginFlow> {
    return credentialMachineRPC(
        machineId,
        'happyherd-credential-auth-status',
        { id },
        CredentialLoginFlowSchema,
    );
}

export async function submitManagedCredentialLoginCode(
    machineId: string,
    id: string,
    code: string,
): Promise<CredentialLoginFlow> {
    return credentialMachineRPC(
        machineId,
        'happyherd-credential-auth-submit',
        { id, code },
        CredentialLoginFlowSchema,
    );
}

export async function cancelManagedCredentialLogin(
    machineId: string,
    id: string,
): Promise<CredentialLoginFlow> {
    return credentialMachineRPC(
        machineId,
        'happyherd-credential-auth-cancel',
        { id },
        CredentialLoginFlowSchema,
    );
}
