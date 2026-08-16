/**
 * Environment variables that identify one particular Happy or provider
 * session. A daemon can live much longer than the session that created it, so
 * these must never flow from an ambient daemon environment into a new child.
 */
export const SESSION_SCOPED_ENV_KEYS = [
    'HAPPY_RECONNECT_SESSION_ID',
    'HAPPY_RECONNECT_ENCRYPTION_KEY',
    'HAPPY_RECONNECT_ENCRYPTION_VARIANT',
    'HAPPY_RECONNECT_SEQ',
    'HAPPY_RECONNECT_METADATA_VERSION',
    'HAPPY_RECONNECT_AGENT_STATE_VERSION',
    'HAPPY_FORKED_FROM_SESSION_ID',
    'HAPPY_FORKED_FROM_MESSAGE_ID',
    'HAPPY_FORK_CLAUDE_SESSION_ID',
    'HAPPY_FORK_CODEX_THREAD_ID',
    'HAPPY_SIDE_CHAT',
    'HAPPYHERD_CONTEXT_BUNDLE_PATH',
    'HAPPYHERD_CONTEXT_HASH',
    'HAPPYHERD_GLOBAL_AGENTS_PATH',
    'HAPPYHERD_GLOBAL_AGENTCONTEXT_PATH',
    'HAPPYHERD_PROJECT_GUIDANCE_PATH',
    'HAPPYHERD_COMMANDER_ID',
    'HAPPYHERD_COMMANDER_NAME',
    'HAPPYHERD_COMMANDER_PATH',
    'HAPPYHERD_COMMANDER_WORKSPACE',
    'HAPPYHERD_COMMANDER_AGENTCONTEXT_PATH',
    'HAPPYHERD_AUTOMATION_ID',
    'HAPPYHERD_AUTOMATION_KIND',
    'HAPPYHERD_AUTOMATION_BOOTSTRAP_PATH',
    'HAPPYHERD_AUTOMATION_BOOTSTRAP_HASH',
    'HAPPYHERD_AGENT_SURFACE_ID',
    'HAPPYHERD_AGENT_CAPABILITY_ID',
    'HAPPYHERD_AGENT_BROKER_URL',
    'HAPPYHERD_AGENT_TOOL_MANIFEST_JSON',
    'CODEX_THREAD_ID',
] as const;

export type HappyHerdAgentSessionRuntimeContext = {
    surfaceId: string;
    capabilityId: string;
    brokerUrl: string;
    tools: Array<{
        name: string;
        family: string;
        description: string;
    }>;
};

function requiredBoundedString(value: unknown, label: string): string {
    if (typeof value !== 'string') {
        throw new Error(`${label} is required`);
    }
    const normalized = value.trim();
    if (normalized.length === 0 || normalized.length > 512 || normalized.includes('\0')) {
        throw new Error(`${label} must be a non-empty string no longer than 512 characters`);
    }
    return normalized;
}

/**
 * Convert the only runtime context accepted from the encrypted machine RPC
 * into child-process environment. This is deliberately separate from the
 * generic environmentVariables path so session capabilities cannot arrive via
 * ambient daemon state or arbitrary key/value injection.
 */
export function happyHerdAgentSessionRuntimeEnvironment(
    value: unknown,
): Record<string, string> {
    if (value === undefined || value === null) {
        return {};
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('HappyHerd Agent runtime context must be an object');
    }
    const context = value as Record<string, unknown>;
    const expectedKeys = ['surfaceId', 'capabilityId', 'brokerUrl', 'tools'];
    const unexpectedKeys = Object.keys(context).filter((key) => !expectedKeys.includes(key));
    if (unexpectedKeys.length > 0) {
        throw new Error(`HappyHerd Agent runtime context contains unsupported fields: ${unexpectedKeys.join(', ')}`);
    }

    const surfaceId = requiredBoundedString(context.surfaceId, 'surfaceId');
    if (!/^(?:dm:\d+|(?:thread|channel):\d+:\d+)$/.test(surfaceId)) {
        throw new Error('surfaceId is not a supported Discord surface');
    }
    const capabilityId = requiredBoundedString(context.capabilityId, 'capabilityId');
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(capabilityId)) {
        throw new Error('capabilityId is not a valid capability identifier');
    }
    const rawBrokerUrl = requiredBoundedString(context.brokerUrl, 'brokerUrl');
    let brokerUrl: URL;
    try {
        brokerUrl = new URL(rawBrokerUrl);
    } catch {
        throw new Error('brokerUrl must be a valid URL');
    }
    if (
        brokerUrl.protocol !== 'http:'
        || !['127.0.0.1', 'localhost', '[::1]', 'happyherd-agent-broker.localhost'].includes(brokerUrl.hostname)
        || brokerUrl.pathname !== '/mcp'
        || brokerUrl.username
        || brokerUrl.password
        || brokerUrl.search
        || brokerUrl.hash
    ) {
        throw new Error('brokerUrl must be a credential-free loopback HTTP /mcp endpoint');
    }

    if (!Array.isArray(context.tools) || context.tools.length === 0 || context.tools.length > 32) {
        throw new Error('tools must contain between 1 and 32 governed tool definitions');
    }
    const seenNames = new Set<string>();
    const tools = context.tools.map((raw, index) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new Error(`tools[${index}] must be an object`);
        }
        const tool = raw as Record<string, unknown>;
        const keys = Object.keys(tool);
        if (keys.some((key) => !['name', 'family', 'description'].includes(key))) {
            throw new Error(`tools[${index}] contains unsupported fields`);
        }
        const name = requiredBoundedString(tool.name, `tools[${index}].name`);
        const family = requiredBoundedString(tool.family, `tools[${index}].family`);
        const description = requiredBoundedString(tool.description, `tools[${index}].description`);
        if (!/^[a-z][a-z0-9_]{0,63}$/.test(name)) {
            throw new Error(`tools[${index}].name is invalid`);
        }
        if (!/^[a-z][a-z0-9-]{0,63}$/.test(family)) {
            throw new Error(`tools[${index}].family is invalid`);
        }
        if (seenNames.has(name)) {
            throw new Error(`tools contains duplicate name ${name}`);
        }
        seenNames.add(name);
        return { name, family, description };
    });
    const toolManifestJson = JSON.stringify({ schemaVersion: 1, tools });
    if (Buffer.byteLength(toolManifestJson, 'utf8') > 16_384) {
        throw new Error('tool manifest is too large');
    }

    return {
        HAPPYHERD_AGENT_SURFACE_ID: surfaceId,
        HAPPYHERD_AGENT_CAPABILITY_ID: capabilityId,
        HAPPYHERD_AGENT_BROKER_URL: rawBrokerUrl,
        HAPPYHERD_AGENT_TOOL_MANIFEST_JSON: toolManifestJson,
    };
}

/**
 * Remove session-scoped state inherited from a parent process without
 * modifying the source environment.
 */
export function sanitizeSessionEnvironment<T extends Record<string, string>>(env: T): T;
export function sanitizeSessionEnvironment(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function sanitizeSessionEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const sanitized = { ...env };
    for (const key of SESSION_SCOPED_ENV_KEYS) {
        delete sanitized[key];
    }
    return sanitized;
}

/**
 * Build a child environment from clean ambient values plus explicit values for
 * the session being launched. Explicit values deliberately win so fork and
 * resume requests continue to work.
 */
export function buildSessionChildEnvironment(
    ambientEnv: NodeJS.ProcessEnv = process.env,
    explicitEnv: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
    return {
        ...sanitizeSessionEnvironment(ambientEnv),
        ...explicitEnv,
    };
}

/**
 * tmux windows inherit their server environment, including keys omitted from
 * `new-window -e`. These are the keys the shell must explicitly unset before
 * starting a child, unless this launch intentionally supplies a replacement.
 */
export function sessionEnvironmentKeysToUnset(explicitEnv: NodeJS.ProcessEnv = {}): string[] {
    return SESSION_SCOPED_ENV_KEYS.filter((key) => explicitEnv[key] === undefined);
}

export function wrapTmuxCommandWithSessionEnvironmentSanitizer(
    command: string,
    explicitEnv: NodeJS.ProcessEnv = {},
): string {
    const keysToUnset = sessionEnvironmentKeysToUnset(explicitEnv);
    if (keysToUnset.length === 0) {
        return command;
    }
    return `unset ${keysToUnset.join(' ')}; ${command}`;
}
