import { t, type TranslationKey } from '@/text';
import { getHarnessName } from '@/utils/harnessCatalog';

/**
 * Display labels for a launch choice (UI overhaul): what the composer chips,
 * the Streamline summary and the Advanced form show for the agent, model and
 * permission mode. The key still goes to the launch; only the label changes.
 */

type Choice = { key: string; name: string };

/** The app's own copy for the permission modes it knows, by mode key. */
const PERMISSION_MODE_COPY: Record<string, TranslationKey> = {
    default: 'agentInput.permissionMode.default',
    acceptEdits: 'agentInput.permissionMode.acceptEdits',
    plan: 'agentInput.permissionMode.plan',
    dontAsk: 'agentInput.permissionMode.dontAsk',
    bypassPermissions: 'agentInput.permissionMode.bypassPermissions',
    'read-only': 'agentInput.codexPermissionMode.readOnly',
    'safe-yolo': 'agentInput.codexPermissionMode.safeYolo',
    yolo: 'agentInput.codexPermissionMode.yolo',
};

/** "default permissions", "accept edits": the app's copy, else the name the machine advertises. */
export function getPermissionModeDisplayName(mode: Choice): string {
    const copy = PERMISSION_MODE_COPY[mode.key];
    return copy ? t(copy) : mode.name || mode.key;
}

/** Use the catalog's display name verbatim, or its exact model ID when unnamed. */
export function getModelDisplayName(model: Choice): string {
    return model.name || model.key;
}

/** The harness on a chip: "Claude" rather than the product name "Claude Code". */
export function getHarnessChipName(key: string): string {
    return key === 'claude' ? 'Claude' : getHarnessName(key);
}
