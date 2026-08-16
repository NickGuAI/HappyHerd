import { describe, expect, it } from 'vitest';
import {
  buildHappyHerdAgentCodexAppServerArgs,
  happyHerdAgentAllowedCodexTools,
  happyHerdAgentCodexPreToolDecision,
} from './agentCodexPolicy';

const env = {
  HAPPYHERD_AGENT_TOOL_MANIFEST_JSON: JSON.stringify({
    schemaVersion: 1,
    tools: [{ name: 'guide', family: 'guide', description: 'Governed guidance' }],
  }),
};

describe('HappyHerd Agent Codex tool policy', () => {
  it('allows only manifest-declared MCP tools', () => {
    expect(happyHerdAgentAllowedCodexTools(env)).toEqual(['mcp__happyherd_agent__guide']);
    expect(happyHerdAgentCodexPreToolDecision({
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__happyherd_agent__guide',
    }, env)).toBeNull();
    expect(happyHerdAgentCodexPreToolDecision({
      hook_event_name: 'PreToolUse',
      tool_name: 'shell',
    }, env)).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
  });

  it('fails closed when the manifest is absent or the hook input is invalid', () => {
    expect(() => happyHerdAgentCodexPreToolDecision(null, {})).toThrow('manifest is missing');
    expect(happyHerdAgentCodexPreToolDecision(null, env)).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'deny' },
    });
  });

  it('builds a mandatory pre-tool hook and disables web search', () => {
    const path = '/opt/happy/bin/happyherd-agent-codex-policy.mjs';
    const args = buildHappyHerdAgentCodexAppServerArgs(path);
    expect(args).toContain('web_search="disabled"');
    expect(args.join(' ')).toContain(path);
  });
});
