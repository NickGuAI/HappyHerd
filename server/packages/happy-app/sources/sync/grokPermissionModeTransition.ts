import type { GrokPermissionModeTransitionReceipt } from '@slopus/happy-wire';

import { machineTransitionGrokPermissionMode } from './ops';

type TransitionDependencies = {
    request?: typeof machineTransitionGrokPermissionMode;
    commit: (permissionMode: string) => void;
};

/** Commit the composer selection only after the exact daemon confirms restart/resume. */
export async function transitionGrokPermissionModeAndCommit(
    machineId: string,
    sessionId: string,
    permissionMode: string,
    dependencies: TransitionDependencies,
): Promise<GrokPermissionModeTransitionReceipt> {
    const request = dependencies.request ?? machineTransitionGrokPermissionMode;
    const receipt = await request(machineId, sessionId, permissionMode);
    if (receipt.sessionId !== sessionId || receipt.permissionMode !== permissionMode) {
        throw new Error('Grok permission transition returned a mismatched receipt');
    }
    dependencies.commit(receipt.permissionMode);
    return receipt;
}
