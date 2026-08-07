import { describe, expect, it } from 'vitest';

import { assertGeminiCommanderSupport } from './runGemini';

describe('Gemini Commander support gate', () => {
  it('allows ordinary Gemini sessions', () => {
    expect(() => assertGeminiCommanderSupport({})).not.toThrow();
  });

  it('fails closed when Commander instructions cannot be delivered at system priority', () => {
    expect(() => assertGeminiCommanderSupport({
      HAPPYHERD_COMMANDER_ID: 'athena',
    })).toThrow(/Gemini Commander sessions are disabled/);
  });
});
