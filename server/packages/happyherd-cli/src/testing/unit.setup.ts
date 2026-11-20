import { SESSION_SCOPED_ENV_KEYS } from '@/daemon/sessionEnvironment';
import { legacyEnvironmentKey } from '@/legacyCompatibility';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, expect, vi } from 'vitest';

const legacyHomeKey = legacyEnvironmentKey('HAPPYHERD_HOME_DIR')!;
const configuredHome = process.env.HAPPYHERD_HOME_DIR || process.env[legacyHomeKey];
const protectedHomes = [join(homedir(), '.happyherd'), join(homedir(), `.${legacyHomeKey.split('_')[0].toLowerCase()}`)];
if (configuredHome) protectedHomes.push(configuredHome.replace(/^~/, homedir()));
const unitHome = mkdtempSync(join(tmpdir(), 'happyherd-unit-'));
process.env.HAPPYHERD_HOME_DIR = unitHome;
process.env[legacyHomeKey] = unitHome;

let usedRealHome = false;
vi.mock('@/daemon/providerAccountWaits', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/daemon/providerAccountWaits')>();
    return {
        ...original,
        ProviderAccountWaits: class extends original.ProviderAccountWaits {
            constructor(...args: ConstructorParameters<typeof original.ProviderAccountWaits>) {
                if (protectedHomes.some((home) => resolve(args[0]) === resolve(home, 'provider-account-waits.json'))) {
                    usedRealHome = true;
                    throw new Error('A unit test tried to use the real HappyHerd home');
                }
                super(...args);
            }
        },
    };
});

afterEach(() => {
    expect(usedRealHome, 'A unit test tried to use the real HappyHerd home').toBe(false);
});
afterAll(() => rmSync(unitHome, { recursive: true, force: true }));

// A unit worker may be launched from inside a live HappyHerd session. Never
// let that parent session's reconnect, Commander, automation, or provider IDs
// become fixtures implicitly; tests that need them must opt in explicitly.
for (const key of SESSION_SCOPED_ENV_KEYS) {
    delete process.env[key];
}
