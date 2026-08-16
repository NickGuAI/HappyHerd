import { describe, expect, it } from 'vitest';
import { parseHappyHerdAgentManifest, sessionToolManifest } from './manifest';
import { TEST_AGENT_MANIFEST } from './testManifest';

describe('HappyHerd Agent manifest', () => {
  it('accepts a bounded manifest and derives a capability-safe session surface', () => {
    const parsed = parseHappyHerdAgentManifest(TEST_AGENT_MANIFEST);
    expect(sessionToolManifest(parsed)).toEqual([
      { name: 'contacts', family: 'contacts', description: 'Scoped contact operations' },
      { name: 'events', family: 'events', description: 'Shared event reads and personal event writes' },
    ]);
  });

  it('rejects shared writes, remote URLs, traversal, and undeclared fields', () => {
    const operation = (overrides: Record<string, unknown>) => ({
      method: 'GET', path: '/api/items', scope: null, write: false, shared: true, ...overrides,
    });
    const candidate = (spec: Record<string, unknown>) => ({
      schemaVersion: 1,
      id: 'example-agent',
      displayName: 'Example',
      tools: [{
        name: 'guide', family: 'guide', description: 'Guidance', operations: { run: spec },
      }],
    });
    expect(() => parseHappyHerdAgentManifest(candidate(operation({ write: true })))).toThrow('shared writes');
    expect(() => parseHappyHerdAgentManifest(candidate(operation({ path: 'https://attacker.example/items' })))).toThrow('origin-relative');
    expect(() => parseHappyHerdAgentManifest(candidate(operation({ path: '/../secret' })))).toThrow('traversal');
    expect(() => parseHappyHerdAgentManifest(candidate({ ...operation({}), command: 'shell' }))).toThrow('unsupported fields');
  });
});
