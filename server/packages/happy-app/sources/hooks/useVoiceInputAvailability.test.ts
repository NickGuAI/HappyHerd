import { describe, expect, it } from 'vitest';
import { resolveVoiceInputAvailability } from './voiceInputAvailability';

describe('resolveVoiceInputAvailability', () => {
    it.each([
        { enabled: false, configured: false, available: false },
        { enabled: false, configured: true, available: false },
        { enabled: true, configured: false, available: false },
        { enabled: true, configured: true, available: true },
    ])('requires both the feature switch and masked key status: $enabled/$configured', ({ enabled, configured, available }) => {
        expect(resolveVoiceInputAvailability(enabled, configured)).toBe(available);
    });
});
