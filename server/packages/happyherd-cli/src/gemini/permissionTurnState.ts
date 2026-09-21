import type { PermissionMode } from '@/api/types';

const GEMINI_PERMISSION_MODES: readonly PermissionMode[] = [
    'default',
    'read-only',
    'safe-yolo',
    'yolo',
];

type PermissionModeSink = {
    setPermissionMode(mode: PermissionMode): void;
};

type AbortablePermissionRequests = {
    abortAll(): void;
};

/**
 * Keep the Human's latest picker selection separate from the permission mode
 * of the provider turn that is currently running. A queued selection becomes
 * effective only when that exact queued turn is dequeued.
 */
export class GeminiPermissionTurnState {
    private selectedMode: PermissionMode | undefined;

    selectForQueue(requestedMode: unknown): PermissionMode {
        if (typeof requestedMode === 'string') {
            if (!GEMINI_PERMISSION_MODES.includes(requestedMode as PermissionMode)) {
                throw new Error(`Unsupported Gemini permission mode: ${requestedMode}`);
            }
            this.selectedMode = requestedMode as PermissionMode;
        }

        this.selectedMode ??= 'default';
        return this.selectedMode;
    }

    async applyAfterPreviousTurn(
        mode: PermissionMode,
        sink: PermissionModeSink,
        disposePrevious: (() => Promise<void>) | null = null,
    ): Promise<void> {
        if (disposePrevious) {
            await disposePrevious();
        }
        sink.setPermissionMode(mode);
    }
}

/** Settle Human-facing approval state before asking the provider to cancel. */
export async function abortGeminiPermissionRequests(
    permissionRequests: AbortablePermissionRequests,
    cancelProvider: (() => Promise<void>) | null,
): Promise<void> {
    permissionRequests.abortAll();
    if (cancelProvider) {
        await cancelProvider();
    }
}
