import * as Localization from 'expo-localization';

import { loadSettings } from '@/sync/persistence';

import enCatalog from './locales/en.json';
import cnCatalog from './locales/cn.json';
import deCatalog from './locales/de.json';
import {
    type TranslationKey,
    type TranslationKeyWithParams,
    type TranslationParams,
} from './generated';
import {
    DEFAULT_LANGUAGE,
    SUPPORTED_LANGUAGES,
    type SupportedLanguage,
} from './_all';

type MessageSelect = {
    select: {
        param: string;
        cases: Record<string, string>;
    };
};
type Message = string | MessageSelect;
type MessageCatalog = Record<string, unknown>;
type MessageParams = Record<string, string | number | boolean>;

export type { TranslationKey, TranslationParams } from './generated';
export type { SupportedLanguage } from './_all';
export {
    DEFAULT_LANGUAGE,
    SUPPORTED_LANGUAGES,
    SUPPORTED_LANGUAGE_CODES,
    getLanguageEnglishName,
    getLanguageNativeName,
} from './_all';

const catalogs: Record<SupportedLanguage, MessageCatalog> = {
    en: enCatalog,
    cn: cnCatalog,
    de: deCatalog,
};

export function resolveSupportedLanguage(language: string | null | undefined): SupportedLanguage {
    if (!language) return DEFAULT_LANGUAGE;
    const normalized = language.trim().replace('_', '-').toLowerCase();
    if (normalized === 'cn' || normalized === 'zh' || normalized.startsWith('zh-')) return 'cn';
    if (normalized === 'de' || normalized.startsWith('de-')) return 'de';
    if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
    return DEFAULT_LANGUAGE;
}

function resolveDeviceLanguage(): SupportedLanguage {
    for (const locale of Localization.getLocales()) {
        const language = locale.languageTag || locale.languageCode;
        if (!language) continue;
        const resolved = resolveSupportedLanguage(language);
        if (resolved !== DEFAULT_LANGUAGE || language.toLowerCase().startsWith('en')) return resolved;
    }
    return DEFAULT_LANGUAGE;
}

const persistedLanguage = loadSettings().settings.preferredLanguage;
let currentLanguage: SupportedLanguage = persistedLanguage
    ? resolveSupportedLanguage(persistedLanguage)
    : resolveDeviceLanguage();

export function setCurrentLanguage(language: string | null | undefined): SupportedLanguage {
    currentLanguage = language ? resolveSupportedLanguage(language) : resolveDeviceLanguage();
    return currentLanguage;
}

export function getCurrentLanguage(): SupportedLanguage {
    return currentLanguage;
}

export function getAllTranslationKeys(): TranslationKey[] {
    return collectKeys(enCatalog) as TranslationKey[];
}

function collectKeys(catalog: MessageCatalog, prefix = '', output: string[] = []): string[] {
    for (const [key, value] of Object.entries(catalog)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string' || isSelect(value)) output.push(path);
        else if (value && typeof value === 'object') collectKeys(value as MessageCatalog, path, output);
    }
    return output;
}

function isSelect(value: unknown): value is MessageSelect {
    return Boolean(value && typeof value === 'object' && 'select' in value);
}

function lookup(catalog: MessageCatalog, key: string): Message | undefined {
    let value: unknown = catalog;
    for (const segment of key.split('.')) {
        if (!value || typeof value !== 'object' || !(segment in value)) return undefined;
        value = (value as MessageCatalog)[segment];
    }
    return typeof value === 'string' || isSelect(value) ? value : undefined;
}

function render(message: Message, params: MessageParams): string {
    let template: string;
    if (typeof message === 'string') {
        template = message;
    } else {
        const selector = params[message.select.param];
        const caseName = typeof selector === 'boolean'
            ? String(selector)
            : typeof selector === 'number' && selector === 1
                ? 'one'
                : 'other';
        template = message.select.cases[caseName]
            ?? message.select.cases.other
            ?? Object.values(message.select.cases)[0]
            ?? '';
    }
    return template.replace(/(?<!\{)\{([A-Za-z][A-Za-z0-9_]*)\}(?!\})/g, (placeholder, name) => (
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder
    ));
}

export function t<K extends TranslationKey>(
    key: K,
    ...args: K extends TranslationKeyWithParams ? [TranslationParams<K>] : []
): string {
    const message = lookup(catalogs[currentLanguage], key) ?? lookup(catalogs.en, key);
    if (!message) {
        console.warn(`[i18n] Missing English message for ${key}`);
        return 'Missing translation';
    }
    return render(message, (args[0] ?? {}) as MessageParams);
}
