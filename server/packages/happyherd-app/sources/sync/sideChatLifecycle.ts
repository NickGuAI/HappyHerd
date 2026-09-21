export type SideChatOperationReceipt = {
    success: boolean;
    message?: string;
};

export type SideChatCloseTarget = {
    sessionId: string;
    machineId: string | null;
    active: boolean;
};

export type SideChatCloseDependencies = {
    stopOnMachine: (machineId: string, sessionId: string) => Promise<SideChatOperationReceipt>;
    stopSession: (sessionId: string) => Promise<SideChatOperationReceipt>;
    archive: (sessionId: string) => Promise<SideChatOperationReceipt>;
    refresh: () => Promise<unknown>;
};

export type SideChatCloseResult = {
    success: boolean;
    stopped: boolean;
    archived: boolean;
};

export function resolveSideChatCloseReconciliation(result: SideChatCloseResult): {
    restoreTab: boolean;
    error: 'archive-failed' | 'stop-unconfirmed' | null;
} {
    return {
        restoreTab: !result.archived,
        error: !result.archived
            ? 'archive-failed'
            : !result.stopped ? 'stop-unconfirmed' : null,
    };
}

async function receipt(
    operation: () => Promise<SideChatOperationReceipt>,
): Promise<SideChatOperationReceipt> {
    try {
        return await operation();
    } catch (error) {
        return {
            success: false,
            message: error instanceof Error ? error.message : 'Operation failed',
        };
    }
}

/**
 * Close one side-chat tab durably.
 *
 * Stopping the provider process and archiving the server session are separate
 * operations: a successful stop must not skip the archive, otherwise the tab
 * can reappear after the parent reloads. Refresh is best effort because the
 * normal session broadcast will reconcile the store if it fails.
 */
export async function closeSideChatSession(
    target: SideChatCloseTarget,
    dependencies: SideChatCloseDependencies,
): Promise<SideChatCloseResult> {
    const machineId = target.machineId;
    // `active` is server presence, not proof that the provider process exited.
    // In particular, sessionArchive deactivates before persisting metadata, so
    // a retry after a partial archive can observe active=false while the
    // provider is still running. Always retry the owning stop mechanisms.
    const daemonStop = machineId
        ? await receipt(() => dependencies.stopOnMachine(machineId, target.sessionId))
        : { success: false };
    const sessionStop = daemonStop.success
        ? null
        : await receipt(() => dependencies.stopSession(target.sessionId));
    const stopped = daemonStop.success || sessionStop?.success === true;

    const archive = await receipt(() => dependencies.archive(target.sessionId));
    try {
        await dependencies.refresh();
    } catch {
        // Broadcast sync reconciles shortly even if this refresh flaked.
    }

    return {
        success: stopped && archive.success,
        stopped,
        archived: archive.success,
    };
}
