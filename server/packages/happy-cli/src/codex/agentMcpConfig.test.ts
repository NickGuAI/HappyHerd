import { describe, expect, it } from 'vitest';
import { buildHappyHerdAgentMcpServerConfig } from './agentMcpConfig';

const capability = 'a'.repeat(43);
const manifestJson = JSON.stringify({
  schemaVersion: 1,
  tools: [
    { name: 'guide', family: 'guide', description: 'Governed guidance' },
    { name: 'contacts', family: 'contacts', description: 'Scoped contacts' },
  ],
});

describe('HappyHerd Agent MCP config', () => {
  it('returns no server outside a governed agent session', () => {
    expect(buildHappyHerdAgentMcpServerConfig({
      env: {},
      nodeExecutable: '/usr/bin/node',
      entrypoint: '/opt/happy/happyherd-agent-mcp.mjs',
    })).toBeNull();
  });

  it('builds a required manifest-only MCP server', () => {
    expect(buildHappyHerdAgentMcpServerConfig({
      env: {
        HAPPYHERD_AGENT_BROKER_URL: 'http://happyherd-agent-broker.localhost:3210/mcp',
        HAPPYHERD_AGENT_CAPABILITY_ID: capability,
        HAPPYHERD_AGENT_SURFACE_ID: 'dm:123',
        HAPPYHERD_AGENT_TOOL_MANIFEST_JSON: manifestJson,
      },
      nodeExecutable: '/usr/bin/node',
      entrypoint: '/opt/happy/happyherd-agent-mcp.mjs',
    })).toEqual({
      command: '/usr/bin/node',
      args: ['--no-warnings', '--no-deprecation', '/opt/happy/happyherd-agent-mcp.mjs'],
      enabled_tools: ['guide', 'contacts'],
      required: true,
      env: {
        HAPPYHERD_AGENT_BROKER_URL: 'http://happyherd-agent-broker.localhost:3210/mcp',
        HAPPYHERD_AGENT_CAPABILITY_ID: capability,
        HAPPYHERD_AGENT_TOOL_MANIFEST_JSON: manifestJson,
        HAPPYHERD_AGENT_BROKER_PROXY_REQUIRED: '1',
      },
    });
  });

  it('fails closed for partial or remote context', () => {
    expect(() => buildHappyHerdAgentMcpServerConfig({
      env: { HAPPYHERD_AGENT_BROKER_URL: 'http://127.0.0.1:3210/mcp' },
      nodeExecutable: '/usr/bin/node',
      entrypoint: '/opt/happy/happyherd-agent-mcp.mjs',
    })).toThrow('must be supplied together');
    expect(() => buildHappyHerdAgentMcpServerConfig({
      env: {
        HAPPYHERD_AGENT_BROKER_URL: 'https://attacker.example/mcp',
        HAPPYHERD_AGENT_CAPABILITY_ID: capability,
        HAPPYHERD_AGENT_SURFACE_ID: 'dm:123',
        HAPPYHERD_AGENT_TOOL_MANIFEST_JSON: manifestJson,
      },
      nodeExecutable: '/usr/bin/node',
      entrypoint: '/opt/happy/happyherd-agent-mcp.mjs',
    })).toThrow('loopback');
  });
});
