import { beforeEach, describe, expect, it, vi } from 'vitest';

const persisted = vi.hoisted(() => new Map<string, string>());
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US', languageCode: 'en' }] }));
vi.mock('@/sync/persistence', () => ({ loadSettings: () => ({ settings: { preferredLanguage: null } }) }));
vi.mock('react-native-mmkv', () => ({ MMKV: class {
    getString(key: string) { return persisted.get(key); }
    set(key: string, value: string) { persisted.set(key, value); }
} }));

import { setCurrentLanguage } from '@/text';
import en from '@/text/locales/en.json';
import cn from '@/text/locales/cn.json';
import de from '@/text/locales/de.json';
import { getChangelogEntries, getLatestTitle } from './parser';
import { getLastViewedTitle, hasUnreadChangelog, setLastViewedTitle } from './storage';
import { getLocalizedChangelogEntry } from './localizedEntry';

const catalogs = { en, cn, de };
const canonical = getChangelogEntries().find(entry => entry.title === en.changelog.releases.upstreamSync4cf54d18.title)!;
const latestCanonical = getChangelogEntries().find(entry => entry.title === en.changelog.releases.upstreamSync99f415fa.title)!;
beforeEach(() => { persisted.clear(); setCurrentLanguage('en'); });

describe('localized October 1 release display', () => {
    it('matches the generated English release byte for byte', () => {
        expect(canonical).toBeDefined();
        expect(en.changelog.releases.upstreamSync4cf54d18).toEqual({ title: canonical.title, markdown: canonical.markdown });
        expect(getLocalizedChangelogEntry(canonical)).toEqual(canonical);
    });

    it.each(['en', 'cn', 'de'] as const)('renders the %s release catalog without changing canonical data or history', (locale) => {
        setCurrentLanguage(locale);
        const display = getLocalizedChangelogEntry(canonical);
        expect(display.title).toBe(catalogs[locale].changelog.releases.upstreamSync4cf54d18.title);
        expect(display.markdown).toBe(catalogs[locale].changelog.releases.upstreamSync4cf54d18.markdown);
        expect(display.summary).toBe(canonical.summary);
        expect(display.markdown.split('\n').filter(line => line.startsWith('- '))).toHaveLength(6);
        if (locale !== 'en') {
            expect(display.title).not.toBe(canonical.title);
            expect(display.markdown).not.toBe(canonical.markdown);
        }
        expect(canonical.title).toBe(en.changelog.releases.upstreamSync4cf54d18.title);
        expect(canonical.markdown).toBe(en.changelog.releases.upstreamSync4cf54d18.markdown);
        for (const historical of getChangelogEntries().filter(entry => entry !== canonical && entry !== latestCanonical)) {
            expect(getLocalizedChangelogEntry(historical)).toBe(historical);
        }
    });

    it.each(['en', 'cn', 'de'] as const)('keeps the canonical unread marker when displaying %s', (locale) => {
        const latest = getLatestTitle();
        expect(hasUnreadChangelog(latest)).toBe(true);
        setLastViewedTitle(latest);
        setCurrentLanguage(locale);
        getLocalizedChangelogEntry(canonical);
        expect(getLatestTitle()).toBe(latest);
        expect(getLastViewedTitle()).toBe(latest);
        expect(hasUnreadChangelog(latest)).toBe(false);
    });
});

describe('localized October 13 release display', () => {
    it('matches the generated English release byte for byte', () => {
        expect(latestCanonical).toBeDefined();
        expect(en.changelog.releases.upstreamSync99f415fa).toEqual({ title: latestCanonical.title, markdown: latestCanonical.markdown });
        expect(getLocalizedChangelogEntry(latestCanonical)).toEqual(latestCanonical);
    });

    it.each(['en', 'cn', 'de'] as const)('renders the %s release catalog without changing canonical data or history', (locale) => {
        setCurrentLanguage(locale);
        const display = getLocalizedChangelogEntry(latestCanonical);
        expect(display.title).toBe(catalogs[locale].changelog.releases.upstreamSync99f415fa.title);
        expect(display.markdown).toBe(catalogs[locale].changelog.releases.upstreamSync99f415fa.markdown);
        expect(display.summary).toBe(latestCanonical.summary);
        expect(display.markdown.split('\n').filter(line => line.startsWith('- '))).toHaveLength(4);
        if (locale !== 'en') {
            expect(display.title).not.toBe(latestCanonical.title);
            expect(display.markdown).not.toBe(latestCanonical.markdown);
        }
        expect(latestCanonical.title).toBe(en.changelog.releases.upstreamSync99f415fa.title);
        expect(latestCanonical.markdown).toBe(en.changelog.releases.upstreamSync99f415fa.markdown);
        for (const historical of getChangelogEntries().filter(entry => entry !== latestCanonical && entry !== canonical)) {
            expect(getLocalizedChangelogEntry(historical)).toBe(historical);
        }
    });
});
