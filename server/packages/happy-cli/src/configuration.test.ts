import { describe, expect, it } from 'vitest';
import { runtimeCliVersion } from './configuration';

describe('runtimeCliVersion', () => {
  it('adds immutable HappyHerd release identity without changing source runs', () => {
    expect(runtimeCliVersion('1.2.3')).toBe('1.2.3');
    expect(runtimeCliVersion('1.2.3', 'a'.repeat(40))).toBe(`1.2.3+happyherd.${'a'.repeat(40)}`);
    expect(() => runtimeCliVersion('1.2.3', 'not-a-commit')).toThrow('full lowercase Git commit SHA');
  });
});
