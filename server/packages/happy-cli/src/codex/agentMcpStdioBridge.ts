/**
 * Generic governed-tool MCP bridge for a HappyHerd Agent session.
 *
 * Tool names and families come from the validated, session-scoped manifest.
 * Calls are forwarded to the loopback capability broker; this process never
 * receives provider credentials or a Discord bot token.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { request } from 'undici';
import { z } from 'zod';
import { buildHappyHerdAgentBrokerDispatcher } from './agentBrokerProxy';
import { parseGovernedToolManifestJson, type GovernedToolManifest } from './agentMcpManifest';

function requiredEnvironment(): {
  brokerUrl: string;
  capabilityId: string;
  manifest: GovernedToolManifest;
} {
  const brokerUrl = process.env.HAPPYHERD_AGENT_BROKER_URL?.trim();
  const capabilityId = process.env.HAPPYHERD_AGENT_CAPABILITY_ID?.trim();
  const manifestJson = process.env.HAPPYHERD_AGENT_TOOL_MANIFEST_JSON?.trim();
  if (!brokerUrl || !capabilityId || !manifestJson) {
    throw new Error('HappyHerd Agent broker environment is incomplete');
  }
  const parsed = new URL(brokerUrl);
  if (
    parsed.protocol !== 'http:'
    || !['127.0.0.1', 'localhost', '[::1]', 'happyherd-agent-broker.localhost'].includes(parsed.hostname)
    || parsed.pathname !== '/mcp'
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error('HappyHerd Agent broker must use a credential-free loopback HTTP /mcp endpoint');
  }
  if (capabilityId.length < 32 || capabilityId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(capabilityId)) {
    throw new Error('HappyHerd Agent capability has an invalid format');
  }
  return {
    brokerUrl: parsed.toString(),
    capabilityId,
    manifest: parseGovernedToolManifestJson(manifestJson),
  };
}

async function main(): Promise<void> {
  const { brokerUrl, capabilityId, manifest } = requiredEnvironment();
  const dispatcher = buildHappyHerdAgentBrokerDispatcher();
  const server = new McpServer({ name: 'HappyHerd governed agent', version: '1.0.0' });

  for (const tool of manifest.tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.family,
        description: tool.description,
        inputSchema: {
          operation: z.string().min(1).max(64),
          arguments: z.record(z.string(), z.unknown()).optional(),
        },
      },
      async ({ operation, arguments: toolArguments }) => {
        try {
          const response = await request(brokerUrl, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${capabilityId}`,
              'content-type': 'application/json',
              accept: 'application/json',
            },
            body: JSON.stringify({ family: tool.family, operation, arguments: toolArguments ?? {} }),
            headersTimeout: 30_000,
            bodyTimeout: 30_000,
            ...(dispatcher ? { dispatcher } : {}),
          });
          const raw = await response.body.text();
          const body = raw ? JSON.parse(raw) as unknown : null;
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(body) }],
            isError: response.statusCode < 200 || response.statusCode >= 300,
          };
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                code: 'agent_broker_unavailable',
                errorType: error instanceof Error ? error.name : typeof error,
              }),
            }],
            isError: true,
          };
        }
      },
    );
  }

  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  process.stderr.write(`[happyherd-agent-mcp] Fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
