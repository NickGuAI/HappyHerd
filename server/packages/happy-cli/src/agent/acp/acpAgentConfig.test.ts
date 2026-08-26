import { describe, expect, it } from 'vitest';
import {
  KNOWN_ACP_AGENTS,
  resolveAcpAgentConfig,
  resolveAcpLaunchConfig,
  sanitizeGrokChildEnvironment,
} from './acpAgentConfig';

describe('KNOWN_ACP_AGENTS', () => {
  it('defines built-in ACP command mappings', () => {
    expect(KNOWN_ACP_AGENTS).toEqual({
      gemini: { command: 'gemini', args: ['--experimental-acp'] },
      grok: { command: 'grok', args: ['--no-auto-update', 'agent', 'stdio'] },
      opencode: { command: 'opencode', args: ['acp'] },
    });
  });

  it('uses the exact GrokBuild ACP stdio invocation', () => {
    expect(resolveAcpAgentConfig(['grok'])).toEqual({
      agentName: 'grok',
      command: 'grok',
      args: ['--no-auto-update', 'agent', 'stdio'],
    });
  });
});

describe('resolveAcpAgentConfig', () => {
  it('resolves known agent names to predefined command + args', () => {
    expect(resolveAcpAgentConfig(['gemini'])).toEqual({
      agentName: 'gemini',
      command: 'gemini',
      args: ['--experimental-acp'],
    });
  });

  it('appends extra CLI args for known agent aliases', () => {
    expect(resolveAcpAgentConfig(['opencode', '--foo'])).toEqual({
      agentName: 'opencode',
      command: 'opencode',
      args: ['acp', '--foo'],
    });
  });

  it('strips legacy --acp for opencode compatibility', () => {
    expect(resolveAcpAgentConfig(['opencode', '--acp', '--foo'])).toEqual({
      agentName: 'opencode',
      command: 'opencode',
      args: ['acp', '--foo'],
    });
  });

  it('resolves custom command form with -- separator', () => {
    expect(resolveAcpAgentConfig(['--', 'custom-agent', '--flag'])).toEqual({
      agentName: 'custom-agent',
      command: 'custom-agent',
      args: ['--flag'],
    });
  });

  it('treats unknown agent names as direct commands', () => {
    expect(resolveAcpAgentConfig(['my-agent', '--x'])).toEqual({
      agentName: 'my-agent',
      command: 'my-agent',
      args: ['--x'],
    });
  });

  it('throws with helpful usage when no args are provided', () => {
    expect(() => resolveAcpAgentConfig([])).toThrow('Usage: happy acp <agent-name> or happy acp -- <command> [args]');
  });

  it('throws when separator form omits command', () => {
    expect(() => resolveAcpAgentConfig(['--'])).toThrow('Missing command after "--". Usage: happy acp -- <command> [args]');
  });
});

describe('resolveAcpLaunchConfig', () => {
  it.each([
    'default',
    'acceptEdits',
    'auto',
    'dontAsk',
    'bypassPermissions',
    'plan',
  ])('forwards GrokBuild launch mode %s without leaking Happy lifecycle flags', (permissionMode) => {
    const resolved = resolveAcpLaunchConfig([
      '--happy-starting-mode', 'remote',
      '--started-by', 'daemon',
      '--permission-mode', permissionMode,
      '--model', 'runtime-model',
      '--effort', 'runtime-effort',
      '--resume', 'provider-session',
    ], 'grok');

    expect(resolved).toEqual({
      agentName: 'grok',
      command: 'grok',
      args: [
        '--no-auto-update',
        '--permission-mode', permissionMode,
        'agent',
        'stdio',
      ],
      startedBy: 'daemon',
      verbose: false,
      permissionMode,
      model: 'runtime-model',
      effort: 'runtime-effort',
      resumeSessionId: 'provider-session',
    });
    expect(resolved.args).not.toContain('--happy-starting-mode');
    expect(resolved.args).not.toContain('--started-by');
    expect(resolved.args).not.toContain('--model');
    expect(resolved.args).not.toContain('--effort');
    expect(resolved.args).not.toContain('--resume');
  });

  it('rejects provider passthrough flags on the fixed GrokBuild alias', () => {
    expect(() => resolveAcpLaunchConfig(['--provider-flag'], 'grok'))
      .toThrow('Unexpected argument for happy grok: --provider-flag');
  });

  it('preserves provider flags for generic ACP commands', () => {
    expect(resolveAcpLaunchConfig(['gemini', '--model', 'provider-model'])).toMatchObject({
      agentName: 'gemini',
      args: ['--experimental-acp', '--model', 'provider-model'],
      model: undefined,
    });
  });
});

describe('sanitizeGrokChildEnvironment', () => {
  it('keeps process essentials and Grok auth without leaking arbitrary application credentials', () => {
    expect(sanitizeGrokChildEnvironment({
      HOME: '/home/user',
      PATH: '/usr/bin',
      XAI_API_KEY: 'xai-secret',
      GROK_HOME: '/home/user/.grok-work',
      USER_PROJECT_TOKEN: 'user-value',
      AWS_SECRET_ACCESS_KEY: 'aws-secret',
      GH_TOKEN: 'github-secret',
      TAVILY_API_KEY: 'tavily-secret',
      ANTHROPIC_AUTH_TOKEN: 'claude-secret',
      OPENAI_API_KEY: 'openai-secret',
      GEMINI_API_KEY: 'gemini-secret',
      HAPPY_RECONNECT_ENCRYPTION_KEY: 'happy-secret',
      HAPPYHERD_AGENT_CAPABILITY_ID: 'broker-secret',
    })).toEqual({
      HOME: '/home/user',
      PATH: '/usr/bin',
      XAI_API_KEY: 'xai-secret',
      GROK_HOME: '/home/user/.grok-work',
    });
  });
});
