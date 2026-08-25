import { describe, expect, it } from 'vitest';
import {
    buildSessionChildEnvironment,
    happyHerdAgentSessionRuntimeEnvironment,
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

    it('creates only the validated governed-agent session values', () => {
        const tools = [{ name: 'guide', family: 'guide', description: 'Governed guidance' }];
        expect(happyHerdAgentSessionRuntimeEnvironment({
            surfaceId: 'thread:123:456',
            capabilityId: 'A_32-character-capability-id-value-123',
            brokerUrl: 'http://happyherd-agent-broker.localhost:3210/mcp',
            tools,
        })).toEqual({
            HAPPYHERD_AGENT_SURFACE_ID: 'thread:123:456',
            HAPPYHERD_AGENT_CAPABILITY_ID: 'A_32-character-capability-id-value-123',
            HAPPYHERD_AGENT_BROKER_URL: 'http://happyherd-agent-broker.localhost:3210/mcp',
            HAPPYHERD_AGENT_TOOL_MANIFEST_JSON: JSON.stringify({ schemaVersion: 1, tools }),
        });
    });

    it('rejects arbitrary fields and non-loopback governed-agent brokers', () => {
        const base = {
            surfaceId: 'dm:123',
            capabilityId: 'A_32-character-capability-id-value-123',
            brokerUrl: 'http://127.0.0.1:3210/mcp',
            tools: [{ name: 'guide', family: 'guide', description: 'Governed guidance' }],
        };
        expect(() => happyHerdAgentSessionRuntimeEnvironment({
            ...base,
            OPENAI_API_KEY: 'not-allowed',
        })).toThrow('unsupported fields');
        expect(() => happyHerdAgentSessionRuntimeEnvironment({
            ...base,
            brokerUrl: 'https://broker.example/mcp',
        })).toThrow('loopback HTTP /mcp endpoint');
    });

    it('does not leak automation provenance into an unrelated child', () => {
        const childEnv = buildSessionChildEnvironment(contaminatedEnvironment(), {
            HAPPYHERD_AUTOMATION_ID: 'new-automation',
            HAPPYHERD_AUTOMATION_RUN_ID: 'new-run',
            HAPPYHERD_AUTOMATION_KIND: 'heartbeat',
            HAPPYHERD_AUTOMATION_TIMEOUT_MINUTES: '360',
            HAPPYHERD_AUTOMATION_BOOTSTRAP_PATH: '/tmp/bootstrap.json',
            HAPPYHERD_AUTOMATION_BOOTSTRAP_HASH: 'abc123',
        });

        expect(childEnv).toMatchObject({
            HAPPYHERD_AUTOMATION_ID: 'new-automation',
            HAPPYHERD_AUTOMATION_RUN_ID: 'new-run',
            HAPPYHERD_AUTOMATION_KIND: 'heartbeat',
            HAPPYHERD_AUTOMATION_TIMEOUT_MINUTES: '360',
        });
        const unrelated = buildSessionChildEnvironment(childEnv);
        expect(unrelated).not.toHaveProperty('HAPPYHERD_AUTOMATION_ID');
        expect(unrelated).not.toHaveProperty('HAPPYHERD_AUTOMATION_RUN_ID');
        expect(unrelated).not.toHaveProperty('HAPPYHERD_AUTOMATION_TIMEOUT_MINUTES');
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
