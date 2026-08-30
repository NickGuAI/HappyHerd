import { describe, expect, it } from 'vitest';
import { resolveVoiceInputAvailability } from './voiceInputAvailability';

describe('resolveVoiceInputAvailability', () => {
    it.each([
        { configured: false, available: false },
        { configured: true, available: true },
    ])('follows the server-owned masked key status: $configured', ({ configured, available }) => {
        expect(resolveVoiceInputAvailability(configured)).toBe(available);
    });
});
