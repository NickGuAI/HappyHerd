import { describe, expect, it } from 'vitest';

import { SESSION_SCOPED_ENV_KEYS } from '@/daemon/sessionEnvironment';

describe('Vitest unit environment', () => {
    it('starts without any canonical session-scoped HappyHerd variables', () => {
        expect(SESSION_SCOPED_ENV_KEYS.filter((key) => process.env[key] !== undefined)).toEqual([]);
    });
});
