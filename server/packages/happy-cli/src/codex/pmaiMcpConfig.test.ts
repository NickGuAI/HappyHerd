import { describe, expect, it } from 'vitest';
import { buildPmaiMcpServerConfig } from './pmaiMcpConfig';

describe('buildPmaiMcpServerConfig', () => {
  it('returns no server outside a PMAI session', () => {
    expect(buildPmaiMcpServerConfig({
      env: {},
      nodeExecutable: '/usr/bin/node',
      entrypoint: '/opt/happy/pmai-mcp.mjs',
    })).toBeNull();
  });

  it('builds a fixed loopback MCP bridge without inheriting ambient secrets', () => {
    const capability = 'a'.repeat(43);
    expect(buildPmaiMcpServerConfig({
      env: {
        PMAI_BROKER_URL: 'http://127.0.0.1:3210/mcp',
        PMAI_SESSION_CAPABILITY_ID: capability,
        PMAI_DISCORD_SURFACE_ID: 'dm:123',
        DISCORD_TOKEN: 'must-not-flow',
      },
      nodeExecutable: '/usr/bin/node',
      entrypoint: '/opt/happy/pmai-mcp.mjs',
    })).toEqual({
      command: '/usr/bin/node',
      args: ['--no-warnings', '--no-deprecation', '/opt/happy/pmai-mcp.mjs'],
      enabled_tools: ['pmai_guide', 'pmai_crm', 'pmai_luma', 'pmai_discord', 'pmai_canva'],
      required: true,
      env: {
        PMAI_BROKER_URL: 'http://127.0.0.1:3210/mcp',
        PMAI_SESSION_CAPABILITY_ID: capability,
      },
    });
  });

  it('rejects partial or non-loopback configuration', () => {
    expect(() => buildPmaiMcpServerConfig({
      env: { PMAI_BROKER_URL: 'http://127.0.0.1:3210/mcp' },
      nodeExecutable: 'node',
      entrypoint: 'bridge',
    })).toThrow('must be supplied together');
    expect(() => buildPmaiMcpServerConfig({
      env: {
        PMAI_BROKER_URL: 'https://attacker.example/mcp',
        PMAI_SESSION_CAPABILITY_ID: 'a'.repeat(43),
        PMAI_DISCORD_SURFACE_ID: 'dm:123',
      },
      nodeExecutable: 'node',
      entrypoint: 'bridge',
    })).toThrow('loopback HTTP');
  });
});
