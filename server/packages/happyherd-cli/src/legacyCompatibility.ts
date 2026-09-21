/** Read-only migration boundary. These spellings are persisted/older-process data. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const legacyPrefix = 'HAPPY_';
const currentPrefix = 'HAPPYHERD_';

// Shared pairing protocol: shipped apps still parse this exact URI scheme.
// Switch the emitted scheme only after app readers support both generations.
export const TERMINAL_PAIRING_URI_PREFIX = 'happy://terminal?';

export function canonicalEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const result = { ...env };
    for (const [key, value] of Object.entries(env)) {
        if (key.startsWith(legacyPrefix)) {
            const canonical = currentPrefix + key.slice(legacyPrefix.length);
            if (result[canonical] === undefined) result[canonical] = value;
        }
    }
    return result;
}

export function legacyEnvironmentKey(key: string): string | undefined {
    return key.startsWith(currentPrefix) ? legacyPrefix + key.slice(currentPrefix.length) : undefined;
}

export function resolveCliHome(env: NodeJS.ProcessEnv, home: string): string {
    const configured = canonicalEnvironment(env).HAPPYHERD_HOME_DIR;
    if (configured) return configured.replace(/^~/, home);
    const canonical = join(home, '.happyherd');
    const legacy = join(home, '.happy');
    // Reuse the original home in place. No copying, credential import, or record rewriting.
    return existsSync(canonical) || !existsSync(legacy) ? canonical : legacy;
}

export function migrateCliSettings<T extends Record<string, unknown>>(raw: T): T {
    const result = { ...raw };
    if (result.daemonAutoStartWhenRunningHappyHerd === undefined && typeof raw.daemonAutoStartWhenRunningHappy === 'boolean') {
        Object.assign(result, { daemonAutoStartWhenRunningHappyHerd: raw.daemonAutoStartWhenRunningHappy });
    }
    return result;
}

// Every public bundle reaches configuration before reading CLI environment settings.
export function initializeCliEnvironment(): void {
    Object.assign(process.env, canonicalEnvironment(process.env));
}

export function stripLegacySystemBlocks(text: string): string {
    return text.replace(/\s*<happy-system>[\s\S]*?<\/happy-system>\s*/g, '\n\n').trim();
}
