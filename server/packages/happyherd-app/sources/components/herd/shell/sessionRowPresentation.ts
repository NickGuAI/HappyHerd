import type { SessionRowData } from '@/sync/storage';
import { t } from '@/text';
import type { SessionState } from '@/utils/sessionUtils';

/** Status line key for a session waiting on the user; null otherwise. */
export function resolveHerdRowAttention(state: SessionState): 'status.permissionRequired' | 'status.inputRequired' | null {
    if (state === 'permission_required') return 'status.permissionRequired';
    if (state === 'input_required') return 'status.inputRequired';
    return null;
}

const AGENT_LABEL_KEYS = {
    claude: 'agentInput.agent.claude',
    codex: 'agentInput.agent.codex',
    gemini: 'agentInput.agent.gemini',
    grok: 'agentInput.agent.grok',
    dsh: 'agentInput.agent.dsh',
} as const;
type KnownAgent = keyof typeof AGENT_LABEL_KEYS;

function knownAgent(value: string | null | undefined): KnownAgent | null {
    const normalized = value?.trim().toLowerCase();
    return normalized && normalized in AGENT_LABEL_KEYS ? normalized as KnownAgent : null;
}

/**
 * The agent chip on a session row. Bots already name themselves on the row,
 * so they carry none. Claude and Codex are featured, as in the design.
 */
export function resolveHerdRowAgentLabel(
    session: Pick<SessionRowData, 'botId' | 'flavor' | 'providerKind' | 'identityLine'>,
): { label: string; featured: boolean } | null {
    if (session.botId) return null;
    const agent = knownAgent(session.flavor) ?? knownAgent(session.providerKind);
    if (agent) {
        return { label: t(AGENT_LABEL_KEYS[agent]), featured: agent === 'claude' || agent === 'codex' };
    }
    const provider = session.identityLine?.split(/\s+·\s+/).at(-1)?.trim();
    if (provider) return { label: provider, featured: false };
    const raw = session.flavor?.trim() || session.providerKind?.trim();
    return raw ? { label: raw, featured: false } : null;
}
