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

const CLAUDE_MODEL_SLUG = /^claude-(fable|opus|sonnet|haiku)-(\d+)(?:-(\d+))?(\[1m\])?$/;

/**
 * "Opus 5.5": the name the machine catalog advertises when it differs from the
 * key. Claude's catalog advertises the model ID itself, so its IDs are read as
 * family and version.
 */
export function getModelDisplayName(model: Choice): string {
    if (model.name && model.name !== model.key) return model.name;
    const match = CLAUDE_MODEL_SLUG.exec(model.key);
    if (!match) return model.name || model.key;
    const [, family, major, minor, longContext] = match;
    const version = minor ? `${major}.${minor}` : major;
    return `${family[0].toUpperCase()}${family.slice(1)} ${version}${longContext ? ' 1M' : ''}`;
}

/** The harness on a chip: "Claude" rather than the product name "Claude Code". */
export function getHarnessChipName(key: string): string {
    return key === 'claude' ? 'Claude' : getHarnessName(key);
}
