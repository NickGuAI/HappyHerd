/**
 * PMAI MCP STDIO bridge.
 *
 * This process exposes exactly five PMAI skill-family tools to a Codex thread
 * and forwards calls to the loopback, actor-bound broker. It never receives a
 * PMAI provider credential or Discord bot token.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { PMAI_MCP_TOOLS } from './pmaiMcpTools';

function requiredEnvironment(): { brokerUrl: string; capabilityId: string } {
  const brokerUrl = process.env.PMAI_BROKER_URL?.trim();
  const capabilityId = process.env.PMAI_SESSION_CAPABILITY_ID?.trim();
  if (!brokerUrl || !capabilityId) {
    throw new Error('PMAI broker environment is incomplete');
  }
  const parsed = new URL(brokerUrl);
  if (
    parsed.protocol !== 'http:'
    || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
    || parsed.pathname !== '/mcp'
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error('PMAI broker must use a credential-free loopback HTTP /mcp endpoint');
  }
  if (capabilityId.length < 32 || capabilityId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(capabilityId)) {
    throw new Error('PMAI session capability has an invalid format');
  }
  return { brokerUrl: parsed.toString(), capabilityId };
}

async function main(): Promise<void> {
  const { brokerUrl, capabilityId } = requiredEnvironment();
  const server = new McpServer({ name: 'PMAI governed skills', version: '1.0.0' });

  for (const [toolName, family, description] of PMAI_MCP_TOOLS) {
    server.registerTool(
      toolName,
      {
        title: family,
        description,
        inputSchema: {
          operation: z.string().min(1).max(64),
          arguments: z.record(z.string(), z.unknown()).optional(),
        },
      },
      async ({ operation, arguments: toolArguments }) => {
        try {
          const response = await fetch(brokerUrl, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${capabilityId}`,
              'content-type': 'application/json',
              accept: 'application/json',
            },
            body: JSON.stringify({ family, operation, arguments: toolArguments ?? {} }),
            signal: AbortSignal.timeout(30_000),
          });
          const raw = await response.text();
          const body = raw ? JSON.parse(raw) as unknown : null;
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(body) }],
            isError: !response.ok,
          };
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                code: 'pmai_broker_unavailable',
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
  process.stderr.write(`[pmai-mcp] Fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
