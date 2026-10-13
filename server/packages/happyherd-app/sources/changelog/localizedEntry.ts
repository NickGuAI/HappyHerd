import { t } from '@/text';
import enCatalog from '@/text/locales/en.json';
import type { ChangelogEntry } from './types';

/** Localize display copy without changing canonical release/unread identity. */
export function getLocalizedChangelogEntry(entry: ChangelogEntry): ChangelogEntry {
    if (entry.title === enCatalog.changelog.releases.upstreamSync4cf54d18.title) {
        return {
            ...entry,
            title: t('changelog.releases.upstreamSync4cf54d18.title'),
            markdown: t('changelog.releases.upstreamSync4cf54d18.markdown'),
        };
    }
    if (entry.title !== enCatalog.changelog.releases.upstreamSync99f415fa.title) return entry;
    return {
        ...entry,
        title: t('changelog.releases.upstreamSync99f415fa.title'),
        markdown: t('changelog.releases.upstreamSync99f415fa.markdown'),
    };
}
