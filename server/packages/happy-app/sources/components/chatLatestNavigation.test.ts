import { describe, expect, it } from 'vitest';
import { countNewConversationMessages } from './chatLatestNavigation';

describe('countNewConversationMessages', () => {
    it('counts the new newest-first prefix', () => {
        expect(countNewConversationMessages(
            ['m3', 'm2', 'm1'],
            ['m5', 'm4', 'm3', 'm2', 'm1'],
        )).toBe(2);
    });

    it('does not count an older-page append', () => {
        expect(countNewConversationMessages(
            ['m3', 'm2', 'm1'],
            ['m3', 'm2', 'm1', 'm0'],
        )).toBe(0);
    });

    it('fails closed when no prior anchor remains', () => {
        expect(countNewConversationMessages(['old'], ['new'])).toBe(0);
    });
});
