import { describe, expect, it } from 'vitest';
import { encodeBase64 } from '@/encryption/base64';

describe('voice dictation transport contract', () => {
    it('encodes binary audio without modifying a composer draft', () => {
        const draft = 'keep this draft';
        const audio = new Uint8Array([0, 1, 2, 250, 255]);
        expect(encodeBase64(audio)).toBe('AAEC+v8=');
        expect(draft).toBe('keep this draft');
    });
});
