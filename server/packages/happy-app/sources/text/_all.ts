export type SupportedLanguage = 'en' | 'cn' | 'de';

export interface LanguageInfo {
    code: SupportedLanguage;
    nativeName: string;
    englishName: string;
}

export const SUPPORTED_LANGUAGES: Record<SupportedLanguage, LanguageInfo> = {
    en: { code: 'en', nativeName: 'English', englishName: 'English' },
    cn: { code: 'cn', nativeName: '中文', englishName: 'Chinese' },
    de: { code: 'de', nativeName: 'Deutsch', englishName: 'German' },
};

export const SUPPORTED_LANGUAGE_CODES = Object.keys(SUPPORTED_LANGUAGES) as SupportedLanguage[];
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

export function getLanguageNativeName(code: SupportedLanguage): string {
    return SUPPORTED_LANGUAGES[code].nativeName;
}

export function getLanguageEnglishName(code: SupportedLanguage): string {
    return SUPPORTED_LANGUAGES[code].englishName;
}
