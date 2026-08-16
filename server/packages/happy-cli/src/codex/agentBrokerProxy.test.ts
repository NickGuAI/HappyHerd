import { describe, expect, it } from 'vitest';
import { buildHappyHerdAgentBrokerDispatcher } from './agentBrokerProxy';

describe('buildHappyHerdAgentBrokerDispatcher', () => {
  it('stays inactive outside a HappyHerd Agent MCP child', () => {
    expect(buildHappyHerdAgentBrokerDispatcher({})).toBeUndefined();
  });

  it('requires the HappyHerd sandbox and its loopback proxy', async () => {
    expect(() => buildHappyHerdAgentBrokerDispatcher({
      HAPPYHERD_AGENT_BROKER_PROXY_REQUIRED: '1',
      HTTP_PROXY: 'http://127.0.0.1:1234',
    })).toThrow('only inside the HappyHerd sandbox');
    expect(() => buildHappyHerdAgentBrokerDispatcher({
      HAPPYHERD_AGENT_BROKER_PROXY_REQUIRED: '1',
      SANDBOX_RUNTIME: '1',
      HTTP_PROXY: 'https://proxy.example:1234',
    })).toThrow('credential-free loopback HTTP');

    const dispatcher = buildHappyHerdAgentBrokerDispatcher({
      HAPPYHERD_AGENT_BROKER_PROXY_REQUIRED: '1',
      SANDBOX_RUNTIME: '1',
      HTTP_PROXY: 'http://127.0.0.1:1234',
    });
    expect(dispatcher).toBeDefined();
    await dispatcher?.close();
  });
});
