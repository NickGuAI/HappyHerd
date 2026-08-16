import { describe, expect, it } from 'vitest';
import { parseGovernedToolManifest, parseGovernedToolManifestJson } from './agentMcpManifest';

const manifest = {
  schemaVersion: 1,
  tools: [
    { name: 'guide', family: 'guide', description: 'Governed guidance' },
    { name: 'contacts', family: 'contacts', description: 'Scoped contacts' },
  ],
};

describe('governed MCP tool manifest', () => {
  it('accepts organization-neutral tool definitions', () => {
    expect(parseGovernedToolManifest(manifest).tools.map(({ name, family }) => ({ name, family }))).toEqual([
      { name: 'guide', family: 'guide' },
      { name: 'contacts', family: 'contacts' },
    ]);
  });

  it('rejects duplicates, extra fields, and oversized JSON', () => {
    expect(() => parseGovernedToolManifest({
      ...manifest,
      tools: [manifest.tools[0], manifest.tools[0]],
    })).toThrow('duplicate');
    expect(() => parseGovernedToolManifest({
      ...manifest,
      tools: [{ ...manifest.tools[0], command: 'rm' }],
    })).toThrow('unsupported fields');
    expect(() => parseGovernedToolManifest({
      ...manifest,
      source: 'ambient',
    })).toThrow('unsupported fields');
    expect(() => parseGovernedToolManifest({
      ...manifest,
      tools: [manifest.tools[0], { ...manifest.tools[1], family: manifest.tools[0].family }],
    })).toThrow('duplicate governed tool family');
    expect(() => parseGovernedToolManifestJson(' '.repeat(16_385))).toThrow('too large');
  });
});
