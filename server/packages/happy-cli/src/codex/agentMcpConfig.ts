import { parseGovernedToolManifestJson, type GovernedToolManifest } from './agentMcpManifest';

export type HappyHerdAgentMcpServerConfig = {
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled_tools: string[];
  required: true;
};

export type HappyHerdAgentSessionEnvironment = {
  brokerUrl: string;
  capabilityId: string;
  surfaceId: string;
  manifest: GovernedToolManifest;
  manifestJson: string;
};

export function readHappyHerdAgentSessionEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): HappyHerdAgentSessionEnvironment | null {
  const brokerUrl = env.HAPPYHERD_AGENT_BROKER_URL?.trim();
  const capabilityId = env.HAPPYHERD_AGENT_CAPABILITY_ID?.trim();
  const surfaceId = env.HAPPYHERD_AGENT_SURFACE_ID?.trim();
  const manifestJson = env.HAPPYHERD_AGENT_TOOL_MANIFEST_JSON?.trim();
  if (!brokerUrl && !capabilityId && !surfaceId && !manifestJson) return null;
  if (!brokerUrl || !capabilityId || !surfaceId || !manifestJson) {
    throw new Error('HappyHerd Agent broker URL, capability, surface, and tool manifest must be supplied together');
  }
  const url = new URL(brokerUrl);
  if (
    url.protocol !== 'http:'
    || !['127.0.0.1', 'localhost', '[::1]', 'happyherd-agent-broker.localhost'].includes(url.hostname)
    || url.pathname !== '/mcp'
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error('HappyHerd Agent broker URL must be a credential-free loopback HTTP /mcp endpoint');
  }
  if (capabilityId.length < 32 || capabilityId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(capabilityId)) {
    throw new Error('HappyHerd Agent capability has an invalid format');
  }
  if (!/^(?:dm:\d+|(?:thread|channel):\d+:\d+)$/.test(surfaceId)) {
    throw new Error('HappyHerd Agent Discord surface has an invalid format');
  }
  return {
    brokerUrl: url.toString(),
    capabilityId,
    surfaceId,
    manifest: parseGovernedToolManifestJson(manifestJson),
    manifestJson,
  };
}

export function buildHappyHerdAgentMcpServerConfig(options: {
  env?: NodeJS.ProcessEnv;
  nodeExecutable: string;
  entrypoint: string;
}): HappyHerdAgentMcpServerConfig | null {
  const session = readHappyHerdAgentSessionEnvironment(options.env ?? process.env);
  if (!session) return null;
  return {
    command: options.nodeExecutable,
    args: ['--no-warnings', '--no-deprecation', options.entrypoint],
    enabled_tools: session.manifest.tools.map((tool) => tool.name),
    required: true,
    env: {
      HAPPYHERD_AGENT_BROKER_URL: session.brokerUrl,
      HAPPYHERD_AGENT_CAPABILITY_ID: session.capabilityId,
      HAPPYHERD_AGENT_TOOL_MANIFEST_JSON: session.manifestJson,
      HAPPYHERD_AGENT_BROKER_PROXY_REQUIRED: '1',
    },
  };
}
