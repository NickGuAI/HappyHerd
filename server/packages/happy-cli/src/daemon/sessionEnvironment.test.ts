import { describe, expect, it } from 'vitest';
import {
    buildSessionChildEnvironment,
    pmaiSessionRuntimeEnvironment,
    sanitizeSessionEnvironment,
    SESSION_SCOPED_ENV_KEYS,
    sessionEnvironmentKeysToUnset,
    wrapTmuxCommandWithSessionEnvironmentSanitizer,
} from './sessionEnvironment';

function contaminatedEnvironment(): NodeJS.ProcessEnv {
    return {
        KEEP_ME: 'safe',
        ...Object.fromEntries(SESSION_SCOPED_ENV_KEYS.map((key) => [key, `stale-${key}`])),
    };
}

describe('sessionEnvironment', () => {
    it('removes all inherited session-scoped values without mutating the source', () => {
        const source = contaminatedEnvironment();

        const sanitized = sanitizeSessionEnvironment(source);

        expect(sanitized).toMatchObject({ KEEP_ME: 'safe' });
        for (const key of SESSION_SCOPED_ENV_KEYS) {
            expect(sanitized).not.toHaveProperty(key);
            expect(source[key]).toBe(`stale-${key}`);
        }
    });

    it('keeps explicit fork values after removing stale ambient values', () => {
        const childEnv = buildSessionChildEnvironment(contaminatedEnvironment(), {
            HAPPY_FORKED_FROM_SESSION_ID: 'new-parent-session',
            HAPPY_FORKED_FROM_MESSAGE_ID: 'new-parent-message',
            HAPPY_FORK_CODEX_THREAD_ID: 'new-codex-thread',
            HAPPY_SIDE_CHAT: '1',
        });

        expect(childEnv).toMatchObject({
            KEEP_ME: 'safe',
            HAPPY_FORKED_FROM_SESSION_ID: 'new-parent-session',
            HAPPY_FORKED_FROM_MESSAGE_ID: 'new-parent-message',
            HAPPY_FORK_CODEX_THREAD_ID: 'new-codex-thread',
            HAPPY_SIDE_CHAT: '1',
        });
        expect(childEnv).not.toHaveProperty('CODEX_THREAD_ID');
        expect(childEnv).not.toHaveProperty('HAPPY_RECONNECT_SESSION_ID');
    });

    it('replaces stale reconnect state with the values for the resumed session', () => {
        const childEnv = buildSessionChildEnvironment(contaminatedEnvironment(), {
            HAPPY_RECONNECT_SESSION_ID: 'new-session',
            HAPPY_RECONNECT_ENCRYPTION_KEY: 'new-key',
            HAPPY_RECONNECT_ENCRYPTION_VARIANT: 'dataKey',
            HAPPY_RECONNECT_SEQ: '12',
            HAPPY_RECONNECT_METADATA_VERSION: '13',
            HAPPY_RECONNECT_AGENT_STATE_VERSION: '14',
        });

        expect(childEnv).toMatchObject({
            HAPPY_RECONNECT_SESSION_ID: 'new-session',
            HAPPY_RECONNECT_ENCRYPTION_KEY: 'new-key',
            HAPPY_RECONNECT_ENCRYPTION_VARIANT: 'dataKey',
            HAPPY_RECONNECT_SEQ: '12',
            HAPPY_RECONNECT_METADATA_VERSION: '13',
            HAPPY_RECONNECT_AGENT_STATE_VERSION: '14',
        });
        expect(childEnv).not.toHaveProperty('HAPPY_FORK_CODEX_THREAD_ID');
        expect(childEnv).not.toHaveProperty('CODEX_THREAD_ID');
    });

    it('creates only the three validated PMAI session values', () => {
        expect(pmaiSessionRuntimeEnvironment({
            discordSurfaceId: 'thread:123:456',
            pmaiCapabilityId: 'A_32-character-capability-id-value-123',
            pmaiBrokerUrl: 'http://127.0.0.1:3210/mcp',
        })).toEqual({
            PMAI_DISCORD_SURFACE_ID: 'thread:123:456',
            PMAI_SESSION_CAPABILITY_ID: 'A_32-character-capability-id-value-123',
            PMAI_BROKER_URL: 'http://127.0.0.1:3210/mcp',
        });
    });

    it('rejects arbitrary fields and non-loopback PMAI brokers', () => {
        const base = {
            discordSurfaceId: 'dm:123',
            pmaiCapabilityId: 'A_32-character-capability-id-value-123',
            pmaiBrokerUrl: 'http://127.0.0.1:3210/mcp',
        };
        expect(() => pmaiSessionRuntimeEnvironment({
            ...base,
            OPENAI_API_KEY: 'not-allowed',
        })).toThrow('unsupported fields');
        expect(() => pmaiSessionRuntimeEnvironment({
            ...base,
            pmaiBrokerUrl: 'https://broker.example/mcp',
        })).toThrow('loopback HTTP /mcp endpoint');
    });

    it('does not leak automation provenance into an unrelated child', () => {
        const childEnv = buildSessionChildEnvironment(contaminatedEnvironment(), {
            HAPPYHERD_AUTOMATION_ID: 'new-automation',
            HAPPYHERD_AUTOMATION_KIND: 'heartbeat',
            HAPPYHERD_AUTOMATION_BOOTSTRAP_PATH: '/tmp/bootstrap.json',
            HAPPYHERD_AUTOMATION_BOOTSTRAP_HASH: 'abc123',
        });

        expect(childEnv).toMatchObject({
            HAPPYHERD_AUTOMATION_ID: 'new-automation',
            HAPPYHERD_AUTOMATION_KIND: 'heartbeat',
        });
        const unrelated = buildSessionChildEnvironment(childEnv);
        expect(unrelated).not.toHaveProperty('HAPPYHERD_AUTOMATION_ID');
        expect(unrelated).not.toHaveProperty('HAPPYHERD_AUTOMATION_BOOTSTRAP_PATH');
    });

    it('unsets inherited tmux values without removing an explicit fork value', () => {
        const explicitEnv = { HAPPY_FORK_CODEX_THREAD_ID: 'new-codex-thread' };
        const keysToUnset = sessionEnvironmentKeysToUnset(explicitEnv);
        const command = wrapTmuxCommandWithSessionEnvironmentSanitizer('node happy.mjs codex', explicitEnv);

        expect(keysToUnset).not.toContain('HAPPY_FORK_CODEX_THREAD_ID');
        expect(keysToUnset).toContain('CODEX_THREAD_ID');
        expect(command).toMatch(/^unset /);
        expect(command).toContain('CODEX_THREAD_ID');
        expect(command).not.toContain('unset HAPPY_FORK_CODEX_THREAD_ID');
        expect(command).toMatch(/node happy\.mjs codex$/);
    });
});
