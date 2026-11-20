import { describe, expect, it } from 'vitest';

import { SESSION_SCOPED_ENV_KEYS } from '@/daemon/sessionEnvironment';
import { configuration } from '@/configuration';
import { homedir } from 'node:os';
import { join } from 'node:path';

describe('Vitest unit environment', () => {
    it('starts without any canonical session-scoped HappyHerd variables', () => {
        expect(SESSION_SCOPED_ENV_KEYS.filter((key) => process.env[key] !== undefined)).toEqual([]);
    });
    it('uses a temporary CLI home', () => {
        expect(configuration.happyHomeDir).toBe(process.env.HAPPYHERD_HOME_DIR);
        expect(configuration.happyHomeDir).not.toBe(join(homedir(), '.happyherd'));
    });
});
