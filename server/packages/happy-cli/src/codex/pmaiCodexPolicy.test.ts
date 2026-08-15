import { describe, expect, it } from 'vitest';
import {
  buildPmaiCodexAppServerArgs,
  isAllowedPmaiCodexTool,
  pmaiCodexPreToolDecision,
  PMAI_CODEX_ALLOWED_TOOLS,
} from './pmaiCodexPolicy';

describe('PMAI Codex tool policy', () => {
  it('allows exactly the five PMAI MCP tools', () => {
    expect(PMAI_CODEX_ALLOWED_TOOLS).toHaveLength(5);
    for (const tool of PMAI_CODEX_ALLOWED_TOOLS) {
      expect(isAllowedPmaiCodexTool(tool)).toBe(true);
    }
    for (const tool of ['Bash', 'apply_patch', 'WebSearch', 'Agent', 'mcp__other__read']) {
      expect(isAllowedPmaiCodexTool(tool)).toBe(false);
    }
  });

  it('returns a fail-closed PreToolUse decision for every other local tool', () => {
    expect(pmaiCodexPreToolDecision({
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__pmai__pmai_guide',
    })).toBeNull();
    expect(pmaiCodexPreToolDecision({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
    })).toEqual(expect.objectContaining({
      hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' }),
    }));
    expect(pmaiCodexPreToolDecision(null)).toEqual(expect.objectContaining({
      hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' }),
    }));
  });

  it('forces hooks and disables hosted web search for app-server', () => {
    const args = buildPmaiCodexAppServerArgs('/opt/happy/bin/pmai-codex-policy.mjs');
    expect(args).toContain('--dangerously-bypass-hook-trust');
    expect(args).toContain('web_search="disabled"');
    expect(args).toContain('features.hooks=true');
    expect(args.join(' ')).toContain('hooks.PreToolUse');
    expect(args.join(' ')).toContain('/opt/happy/bin/pmai-codex-policy.mjs');
  });
});
