import { create } from 'zustand';

/** One request to open the Focus setup; a new id reopens it with fresh choices. */
export type FocusSetupRequest = {
    id: number;
    projectId?: string;
};

/**
 * The Focus setup's opener (UI overhaul). The top bar's Focus control hosts
 * the setup, mounted once for every signed-in layout; the top bar, the
 * command palette and a project page open it here, as the mock's
 * `openSheet({ type: 'focus', project })` does.
 */
export const useFocusSetupRequest = create<{ request: FocusSetupRequest | null }>()(() => ({ request: null }));

let nextRequestId = 0;

/** Opens the Focus setup, preset to `projectId` when one is given. */
export function openFocusSetup(options: { projectId?: string } = {}): void {
    nextRequestId += 1;
    useFocusSetupRequest.setState({ request: { id: nextRequestId, projectId: options.projectId } });
}

export function closeFocusSetup(): void {
    useFocusSetupRequest.setState({ request: null });
}
