import { PMAI_MCP_TOOLS } from './pmaiMcpTools';

export type PmaiMcpServerConfig = {
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled_tools: string[];
  required: true;
};

export type PmaiSessionEnvironment = {
  brokerUrl: string;
  capabilityId: string;
  surfaceId: string;
};

export function readPmaiSessionEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): PmaiSessionEnvironment | null {
  const brokerUrl = env.PMAI_BROKER_URL?.trim();
  const capabilityId = env.PMAI_SESSION_CAPABILITY_ID?.trim();
  const surfaceId = env.PMAI_DISCORD_SURFACE_ID?.trim();
  if (!brokerUrl && !capabilityId && !surfaceId) {
    return null;
  }
  if (!brokerUrl || !capabilityId || !surfaceId) {
    throw new Error('PMAI broker URL, session capability, and Discord surface must be supplied together');
  }
  const url = new URL(brokerUrl);
  if (
    url.protocol !== 'http:'
    || !['127.0.0.1', 'localhost', '[::1]', 'pmai-broker.localhost'].includes(url.hostname)
    || url.pathname !== '/mcp'
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error('PMAI broker URL must be a credential-free loopback HTTP /mcp endpoint');
  }
  if (capabilityId.length < 32 || capabilityId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(capabilityId)) {
    throw new Error('PMAI session capability has an invalid format');
  }
  if (!/^(?:dm:\d+|(?:thread|channel):\d+:\d+)$/.test(surfaceId)) {
    throw new Error('PMAI Discord surface has an invalid format');
  }
  return { brokerUrl: url.toString(), capabilityId, surfaceId };
}

export function buildPmaiMcpServerConfig(options: {
  env?: NodeJS.ProcessEnv;
  nodeExecutable: string;
  entrypoint: string;
}): PmaiMcpServerConfig | null {
  const session = readPmaiSessionEnvironment(options.env ?? process.env);
  if (!session) {
    return null;
  }
  return {
    command: options.nodeExecutable,
    args: ['--no-warnings', '--no-deprecation', options.entrypoint],
    enabled_tools: PMAI_MCP_TOOLS.map(([toolName]) => toolName),
    required: true,
    env: {
      PMAI_BROKER_URL: session.brokerUrl,
      PMAI_SESSION_CAPABILITY_ID: session.capabilityId,
      PMAI_BROKER_PROXY_REQUIRED: '1',
    },
  };
}
