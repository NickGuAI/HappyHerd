import { isAbsolute } from 'node:path';
import { parseGovernedToolManifestJson } from './agentMcpManifest';

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
  return parseGovernedToolManifestJson(raw).tools
    .map((tool) => `mcp__happyherd_agent__${tool.name}`);
}

export function happyHerdAgentCodexPreToolDecision(
  input: unknown,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> | null {
  const record = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null;
  const allowedTools = happyHerdAgentAllowedCodexTools(env);
  if (
    record?.hook_event_name === 'PreToolUse'
    && typeof record.tool_name === 'string'
    && allowedTools.includes(record.tool_name)
  ) {
    return null;
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'This governed agent can use only the tools declared in its session manifest.',
    },
  };
}
