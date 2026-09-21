import { describe, expect, it } from 'vitest';
import { runtimeCliVersion } from './configuration';

describe('runtimeCliVersion', () => {
  it('uses the independently installed package version', () => {
    expect(runtimeCliVersion('1.2.3')).toBe('1.2.3');
  });
});
