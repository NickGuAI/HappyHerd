import { isAbsolute } from 'node:path';

export const PMAI_CODEX_ALLOWED_TOOLS = [
  'mcp__pmai__pmai_guide',
  'mcp__pmai__pmai_crm',
  'mcp__pmai__pmai_luma',
  'mcp__pmai__pmai_discord',
  'mcp__pmai__pmai_canva',
] as const;

export function buildPmaiCodexAppServerArgs(policyEntrypoint: string): string[] {
  if (!isAbsolute(policyEntrypoint) || policyEntrypoint.includes('\0')) {
    throw new Error('PMAI Codex policy entrypoint must be an absolute path');
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

export function isAllowedPmaiCodexTool(toolName: unknown): boolean {
  return typeof toolName === 'string'
    && (PMAI_CODEX_ALLOWED_TOOLS as readonly string[]).includes(toolName);
}

export function pmaiCodexPreToolDecision(input: unknown): Record<string, unknown> | null {
  const record = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null;
  if (record?.hook_event_name === 'PreToolUse' && isAllowedPmaiCodexTool(record.tool_name)) {
    return null;
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'This PMAI agent can use only the five governed PMAI tools.',
    },
  };
}
