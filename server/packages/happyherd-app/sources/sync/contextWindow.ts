import { ContextWindowResponseSchema, type ContextWindowRequest, type ContextWindowResponse } from '@happyherd/wire';
import { apiSocket } from './apiSocket';
import type { Machine, Session } from './storageTypes';
import { isMachineOnline } from '@/utils/machineUtils';
import { isRigMetadata } from './rig';

export type ContextWindowResult = ContextWindowResponse | { type: 'error'; reason: 'offline' };

/** Uses the same account-owned encrypted machine RPC as the rewind reader. */
export async function readSessionContextWindow(session: Session, machine: Machine | null | undefined): Promise<ContextWindowResult> {
    const metadata = session.metadata;
    const provider = isRigMetadata(metadata) ? 'rig' : metadata?.flavor || 'claude';
    if (!['claude', 'codex', 'rig', 'agy'].includes(provider)) {
        return { type: 'error', reason: 'unsupported' };
    }
    if (!metadata?.machineId || !machine || !isMachineOnline(machine)) {
        return { type: 'error', reason: 'offline' };
    }
    if (!metadata.path || !((provider === 'rig' || provider === 'agy') ? session.id : provider === 'claude' ? metadata.claudeSessionId : metadata.codexThreadId)) {
        return { type: 'error', reason: 'missing' };
    }
    try {
        // Native Rig resolves the remote session ID in its own persisted
        // bridge mapping. Model flavor and CLI state homes are not native identity.
        const request: ContextWindowRequest = provider === 'rig' ? {
            provider, directory: metadata.path, sessionId: session.id,
        } : provider === 'agy' ? {
            // Preserve the owning session and machine; a cwd cache is not a
            // native identity and another provider's state is not a fallback.
            provider, directory: metadata.path, sessionId: session.id, homeDir: metadata.homeDir,
        } : {
            provider,
            directory: metadata.path,
            claudeSessionId: metadata.claudeSessionId,
            codexThreadId: metadata.codexThreadId,
            codexHome: typeof metadata.codexHome === 'string' ? metadata.codexHome : undefined,
            homeDir: metadata.homeDir,
        };
        return ContextWindowResponseSchema.parse(await apiSocket.machineRPC(
            metadata.machineId, 'session-context-window', request,
        ));
    } catch {
        return { type: 'error', reason: 'unreadable' };
    }
}
