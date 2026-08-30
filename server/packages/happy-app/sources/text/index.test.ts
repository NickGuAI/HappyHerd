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
        expect(t('happyHerd.automations.automationCount', { count: 1 })).toBe('1 automation');
        expect(t('happyHerd.automations.automationCount', { count: 2 })).toBe('2 automations');

        setCurrentLanguage('de');
        expect(t('happyHerd.automations.automationCount', { count: 1 })).toBe('1 Automatisierung');
        expect(t('happyHerd.automations.automationCount', { count: 2 })).toBe('2 Automatisierungen');

        setCurrentLanguage('cn');
        expect(t('happyHerd.automations.automationCount', { count: 1 })).toBe('1 个自动化');
        expect(t('happyHerd.automations.automationCount', { count: 2 })).toBe('2 个自动化');
    });

    it('preserves literal double-brace provider variables', () => {
        expect(t('settingsVoice.byoDescription')).toContain('{{initialConversationContext}}');
    });
});
