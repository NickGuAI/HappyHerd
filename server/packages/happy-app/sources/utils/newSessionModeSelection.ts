/**
 * Null-safe option selection for the new session composer.
 *
 * A Rig machine publishes its own catalog and the machine metadata schema
 * makes `operatingModes` / `models` optional, so `getRigMachineSessionCreation`
 * legitimately returns empty option arrays. `options[index] ?? options[0]` is
 * then `undefined`, and every consumer that dereferenced it crashed the whole
 * screen. Selections are nullable here so the composer degrades to "no picker,
 * no styling" instead — the same shape HomeDock already resolves its options in.
 */
import type { PermissionMode } from '@/components/modelModeOptions';

export type PermissionStyle = { color: string; icon: 'play-forward' | 'pause' };

type LaunchOption = {
    key: string;
    disabled?: boolean;
    unavailable?: boolean;
};

export type NewSessionLaunchSelectionError =
    | 'agent-unavailable'
    | 'permission-unavailable'
    | 'model-unavailable'
    | 'effort-unavailable';

/**
 * Submission guard for the full New Session screen.
 *
 * Recovery-only rows deliberately remain visible, but neither a restored
 * draft nor a capability update may turn one into a launchable selection.
 * Null keys are valid: a provider can expose no explicit override for a
 * dimension (most notably an empty effort catalog).
 */
export function validateNewSessionLaunchSelection({
    agentAvailable,
    permissionOptions,
    modelOptions,
    effortOptions,
    permissionKey,
    modelKey,
    effortKey,
}: {
    agentAvailable: boolean;
    permissionOptions: readonly LaunchOption[];
    modelOptions: readonly LaunchOption[];
    effortOptions: readonly LaunchOption[];
    permissionKey: string | null | undefined;
    modelKey: string | null | undefined;
    effortKey: string | null | undefined;
}): NewSessionLaunchSelectionError | null {
    if (!agentAvailable) return 'agent-unavailable';

    const unavailable = (
        options: readonly LaunchOption[],
        key: string | null | undefined,
    ) => {
        if (!key) return false;
        const option = options.find((candidate) => candidate.key === key);
        return !option || option.disabled === true || option.unavailable === true;
    };

    if (unavailable(permissionOptions, permissionKey)) return 'permission-unavailable';
    if (unavailable(modelOptions, modelKey)) return 'model-unavailable';
    if (unavailable(effortOptions, effortKey)) return 'effort-unavailable';
    return null;
}

/** The current option of an index-driven picker, or null when none is offered. */
export function resolveSelectedOption<T>(options: readonly T[], index: number): T | null {
    return options[index] ?? options[0] ?? null;
}

/**
 * Accent for permission modes that deviate from plain ask-first behaviour.
 * Returns null for the ambient `default` mode and for no selection at all.
 */
export function resolvePermissionStyle(
    permission: Pick<PermissionMode, 'key'> | null | undefined,
): PermissionStyle | null {
    switch (permission?.key) {
        case 'acceptEdits':
        case 'auto_edit':
            return { color: '#A78BFA', icon: 'play-forward' };
        case 'plan':
            return { color: '#5EABA4', icon: 'pause' };
        case 'dontAsk':
        case 'safe-yolo':
            return { color: '#FBBF24', icon: 'play-forward' };
        case 'bypassPermissions':
        case 'yolo':
            return { color: '#F87171', icon: 'play-forward' };
        case 'read-only':
            return { color: '#60A5FA', icon: 'pause' };
        default:
            return null;
    }
}
