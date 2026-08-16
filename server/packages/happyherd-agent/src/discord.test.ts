import { describe, expect, it } from 'vitest';
import { chunkDiscordMessage } from './discord';

describe('chunkDiscordMessage', () => {
  it('keeps every chunk within the requested Unicode code-point limit', () => {
    const input = `${'😀'.repeat(18)}\n${'x'.repeat(25)}`;
    const chunks = chunkDiscordMessage(input, 20);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => Array.from(chunk).length <= 20)).toBe(true);
    expect(chunks.join('').replaceAll('\n', '')).toBe(input.replaceAll('\n', ''));
  });

  it('returns a safe fallback for empty agent output', () => {
    expect(chunkDiscordMessage('')).toEqual(['No response was produced.']);
  });
});
