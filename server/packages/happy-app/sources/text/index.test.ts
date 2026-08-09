import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({
    getLocales: () => [{ languageTag: 'en-US', languageCode: 'en' }],
}));
vi.mock('@/sync/persistence', () => ({
    loadSettings: () => ({ settings: { preferredLanguage: null } }),
}));

import {
    getCurrentLanguage,
    resolveSupportedLanguage,
    setCurrentLanguage,
    t,
} from './index';

describe('JSON i18n runtime', () => {
    beforeEach(() => setCurrentLanguage('en'));

    it('normalizes supported and legacy locale identifiers', () => {
        expect(resolveSupportedLanguage('zh-CN')).toBe('cn');
        expect(resolveSupportedLanguage('zh-Hans')).toBe('cn');
        expect(resolveSupportedLanguage('de-DE')).toBe('de');
        expect(resolveSupportedLanguage('fr-FR')).toBe('en');
    });

    it('switches catalogs immediately without an application restart', () => {
        setCurrentLanguage('cn');
        expect(getCurrentLanguage()).toBe('cn');
        expect(t('happyHerd.composer.queueMessage')).toBe('排队消息');

        setCurrentLanguage('de');
        expect(t('happyHerd.composer.queueMessage')).toBe('Nachricht einreihen');
    });

    it('renders typed placeholders and plural cases from JSON', () => {
        expect(t('time.minutesAgo', { count: 1 })).toBe('1 minute ago');
        expect(t('time.minutesAgo', { count: 2 })).toBe('2 minutes ago');
    });

    it('preserves literal double-brace provider variables', () => {
        expect(t('settingsVoice.byoDescription')).toContain('{{initialConversationContext}}');
    });
});
