import { isAbsolute } from 'node:path';
import { parseGovernedToolManifestJson } from './agentMcpManifest';

const CODEX_COLLABORATION_TOOLS = [
  'spawn_agent',
  'send_message',
  'followup_task',
  'wait_agent',
  'interrupt_agent',
  'list_agents',
] as const;

const GOVERNED_SUBAGENT_ROLES = new Set(['default', 'worker', 'explorer']);

export function buildHappyHerdAgentCodexAppServerArgs(policyEntrypoint: string): string[] {
  if (!isAbsolute(policyEntrypoint) || policyEntrypoint.includes('\0')) {
    throw new Error('HappyHerd Agent Codex policy entrypoint must be an absolute path');
  }
  const command = JSON.stringify(policyEntrypoint);
  const hook = `hooks.PreToolUse=[{matcher="*",hooks=[{type="command",command=${command},timeout=5}]}]`;
  return [
    '--dangerously-bypass-hook-trust',
    '-c',
    'web_search="disabled"',
    '-c',
    'features.hooks=true',
    '-c',
    hook,
  ];
}

export function happyHerdAgentAllowedCodexTools(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = env.HAPPYHERD_AGENT_TOOL_MANIFEST_JSON?.trim();
  if (!raw) throw new Error('HappyHerd Agent tool manifest is missing');
  return [
    ...CODEX_COLLABORATION_TOOLS,
    ...parseGovernedToolManifestJson(raw).tools
      .map((tool) => `mcp__happyherd_agent__${tool.name}`),
  ];
}

function governedSpawnAgentInput(input: unknown): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const agentType = (input as Record<string, unknown>).agent_type;
  return agentType === undefined
    || (typeof agentType === 'string' && GOVERNED_SUBAGENT_ROLES.has(agentType));
}

export function happyHerdAgentCodexPreToolDecision(
  input: unknown,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> | null {
  const record = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null;
  const allowedTools = happyHerdAgentAllowedCodexTools(env);
  const toolName = typeof record?.tool_name === 'string' ? record.tool_name : null;
  if (
    record?.hook_event_name === 'PreToolUse'
    && toolName !== null
    && allowedTools.includes(toolName)
    && (toolName !== 'spawn_agent' || governedSpawnAgentInput(record.tool_input))
  ) {
    return null;
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'This governed agent can use only built-in subagents and the tools declared in its session manifest.',
    },
  };
}
