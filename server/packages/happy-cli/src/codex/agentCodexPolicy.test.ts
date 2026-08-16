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
  it('allows only collaboration tools and manifest-declared MCP tools', () => {
    expect(happyHerdAgentAllowedCodexTools(env)).toEqual([
      'spawn_agent',
      'send_message',
      'followup_task',
      'wait_agent',
      'interrupt_agent',
      'list_agents',
      'mcp__happyherd_agent__guide',
    ]);
    expect(happyHerdAgentCodexPreToolDecision({
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__happyherd_agent__guide',
    }, env)).toBeNull();
    for (const toolName of ['send_message', 'followup_task', 'wait_agent', 'interrupt_agent', 'list_agents']) {
      expect(happyHerdAgentCodexPreToolDecision({
        hook_event_name: 'PreToolUse',
        tool_name: toolName,
      }, env)).toBeNull();
    }
    expect(happyHerdAgentCodexPreToolDecision({
      hook_event_name: 'PreToolUse',
      tool_name: 'spawn_agent',
      tool_input: { message: 'Investigate the bounded question.', agent_type: 'worker' },
    }, env)).toBeNull();
  });

  it('keeps governed children on built-in roles and denies every other tool family', () => {
    expect(happyHerdAgentCodexPreToolDecision({
      hook_event_name: 'PreToolUse',
      tool_name: 'spawn_agent',
      tool_input: { message: 'Try a custom role.', agent_type: 'privileged-custom-role' },
    }, env)).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });

    for (const toolName of [
      'shell',
      'exec_command',
      'apply_patch',
      'web',
      'web_search',
      'mcp__other__guide',
      'mcp__happyherd_agent__undeclared',
    ]) {
      expect(happyHerdAgentCodexPreToolDecision({
        hook_event_name: 'PreToolUse',
        tool_name: toolName,
      }, env)).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
    }
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
