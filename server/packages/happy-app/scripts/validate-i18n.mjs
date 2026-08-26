import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const localeDirectory = resolve(root, 'sources/text/locales');
const generatedPath = resolve(root, 'sources/text/generated.ts');
const semanticExemptionsPath = resolve(root, 'sources/text/semantic-exemptions.json');
const languageCodes = ['en', 'cn', 'de'];
const catalogs = Object.fromEntries(await Promise.all(languageCodes.map(async (code) => [
    code,
    JSON.parse(await readFile(resolve(localeDirectory, `${code}.json`), 'utf8')),
])));
const semanticExemptions = JSON.parse(await readFile(semanticExemptionsPath, 'utf8'));
const protectedProductTokens = [
    'HappyHerd',
    'Claude Code',
    'OpenAI',
    'Anthropic',
    'ElevenLabs',
    'Codex',
    'Claude',
    'Gemini',
    'GitHub',
    'Mermaid',
    'AGENTS.md',
    'MCP',
    'Expo',
    'Rig',
    'Happy',
];

function isSelect(value) {
    return Boolean(value && typeof value === 'object' && value.select);
}

function flatten(value, prefix = '', output = new Map()) {
    for (const [key, child] of Object.entries(value)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof child === 'string' || isSelect(child)) {
            output.set(path, child);
        } else if (child && typeof child === 'object' && !Array.isArray(child)) {
            flatten(child, path, output);
        } else {
            throw new Error(`Invalid catalog value at ${path}`);
        }
    }
    return output;
}

function placeholders(message) {
    const withoutLiteralDoubleBraces = message.replace(/\{\{[^{}]+\}\}/g, '');
    return [...withoutLiteralDoubleBraces.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)]
        .map((match) => match[1])
        .sort();
}

function protectedFragments(message) {
    const fragments = new Set(protectedProductTokens.filter((token) => message.includes(token)));
    for (const match of message.matchAll(/\b[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*\b/g)) fragments.add(match[0]);
    for (const match of message.matchAll(/\{\{[^{}]+\}\}/g)) fragments.add(match[0]);
    for (const match of message.matchAll(/https?:\/\/[^\s)]+/g)) fragments.add(match[0]);
    for (const token of ['"allow"', '"deny"', 'message (string)', 'decision']) {
        if (message.includes(token)) fragments.add(token);
    }
    return [...fragments].sort();
}

function messageCases(message) {
    if (typeof message === 'string') return new Map([['message', message]]);
    return new Map(Object.entries(message.select.cases));
}

function assertSameArray(actual, expected, context) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${context}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

const flattened = Object.fromEntries(languageCodes.map((code) => [code, flatten(catalogs[code])]));
const canonicalKeys = [...flattened.en.keys()].sort();

if (semanticExemptions.schemaVersion !== 1 || !Array.isArray(semanticExemptions.exemptions)) {
    throw new Error('semantic-exemptions.json must use schemaVersion 1 with an exemptions array');
}

const exemptionIndex = new Map();
for (const exemption of semanticExemptions.exemptions) {
    if (!canonicalKeys.includes(exemption.key)) throw new Error(`Unknown semantic exemption key: ${exemption.key}`);
    if (!Array.isArray(exemption.locales) || exemption.locales.length === 0) {
        throw new Error(`Semantic exemption ${exemption.key} needs at least one locale`);
    }
    if (typeof exemption.reason !== 'string' || exemption.reason.trim().length < 20) {
        throw new Error(`Semantic exemption ${exemption.key} needs a specific reason`);
    }
    for (const locale of exemption.locales) {
        if (!languageCodes.slice(1).includes(locale)) throw new Error(`Invalid exemption locale ${locale}:${exemption.key}`);
        const id = `${locale}:${exemption.key}`;
        if (exemptionIndex.has(id)) throw new Error(`Duplicate semantic exemption: ${id}`);
        exemptionIndex.set(id, exemption.reason);
    }
}

for (const code of languageCodes.slice(1)) {
    assertSameArray([...flattened[code].keys()].sort(), canonicalKeys, `${code} key schema drift`);
}

for (const key of canonicalKeys) {
    const canonical = flattened.en.get(key);
    for (const code of languageCodes.slice(1)) {
        const translated = flattened[code].get(key);
        if (isSelect(canonical) !== isSelect(translated)) {
            throw new Error(`${code}:${key} select shape differs from English`);
        }
        if (typeof canonical === 'string' && typeof translated === 'string') {
            assertSameArray(placeholders(translated), placeholders(canonical), `${code}:${key} placeholder drift`);
            continue;
        }
        if (isSelect(canonical) && isSelect(translated)) {
            if (canonical.select.param !== translated.select.param) {
                throw new Error(`${code}:${key} select parameter differs from English`);
            }
            const cases = Object.keys(canonical.select.cases).sort();
            assertSameArray(Object.keys(translated.select.cases).sort(), cases, `${code}:${key} select case drift`);
            for (const caseName of cases) {
                assertSameArray(
                    placeholders(translated.select.cases[caseName]),
                    placeholders(canonical.select.cases[caseName]),
                    `${code}:${key}.${caseName} placeholder drift`,
                );
            }
        }
    }
}

for (const key of canonicalKeys) {
    const canonicalCases = messageCases(flattened.en.get(key));
    for (const code of languageCodes.slice(1)) {
        const translatedCases = messageCases(flattened[code].get(key));
        for (const [caseName, canonical] of canonicalCases) {
            const translated = translatedCases.get(caseName);
            for (const fragment of protectedFragments(canonical)) {
                if (!translated.includes(fragment)) {
                    throw new Error(`${code}:${key}.${caseName} changed protected product/raw token ${JSON.stringify(fragment)}`);
                }
            }
        }
    }
}

const usedExemptions = new Set();
for (const code of languageCodes.slice(1)) {
    for (const key of canonicalKeys) {
        const id = `${code}:${key}`;
        const equalToEnglish = JSON.stringify(flattened[code].get(key)) === JSON.stringify(flattened.en.get(key));
        if (equalToEnglish && !exemptionIndex.has(id)) {
            throw new Error(`${id} silently equals English; translate it or add a reasoned semantic exemption`);
        }
        if (equalToEnglish) usedExemptions.add(id);
    }
}
for (const id of exemptionIndex.keys()) {
    if (!usedExemptions.has(id)) throw new Error(`Stale semantic exemption no longer equals English: ${id}`);
}

function paramsFor(value) {
    const names = new Set();
    if (typeof value === 'string') {
        placeholders(value).forEach((name) => names.add(name));
    } else {
        names.add(value.select.param);
        Object.values(value.select.cases).forEach((message) => {
            placeholders(message).forEach((name) => names.add(name));
        });
    }
    return [...names].sort();
}

const numericParameters = new Set([
    'count', 'hours', 'index', 'limit', 'max', 'maxMb', 'min', 'percent',
    'seconds', 'staged', 'unstaged',
]);
const booleanParameters = new Set(['enabled']);
const dynamicEntries = canonicalKeys
    .map((key) => [key, paramsFor(flattened.en.get(key))])
    .filter(([, params]) => params.length > 0);

function parameterType(name) {
    if (/^value\d+$/.test(name)) return 'string | number';
    if (numericParameters.has(name)) return 'number';
    if (booleanParameters.has(name)) return 'boolean';
    if (name === 'code' || name === 'version' || name === 'total' || name === 'used') return 'string | number';
    return 'string';
}

const generated = `// Generated by scripts/validate-i18n.mjs. Do not edit by hand.\n\n`
    + `export type TranslationKey =\n${canonicalKeys.map((key) => `    | ${JSON.stringify(key)}`).join('\n')};\n\n`
    + `export interface TranslationParamsByKey {\n${dynamicEntries.map(([key, params]) => (
        `    ${JSON.stringify(key)}: { ${params.map((name) => `${name}: ${parameterType(name)}`).join('; ')} };`
    )).join('\n')}\n}\n\n`
    + `export type TranslationKeyWithParams = keyof TranslationParamsByKey;\n`
    + `export type TranslationParams<K extends TranslationKey> = K extends TranslationKeyWithParams\n`
    + `    ? TranslationParamsByKey[K]\n`
    + `    : never;\n`;

if (process.argv.includes('--write')) {
    await writeFile(generatedPath, generated);
} else {
    const existing = await readFile(generatedPath, 'utf8').catch(() => '');
    if (existing !== generated) {
        throw new Error('Generated i18n types are stale. Run: pnpm i18n:generate');
    }
}

console.log(`[i18n] ${canonicalKeys.length} keys validated for ${languageCodes.join(', ')}`);
