import { describe, expect, it, vi } from 'vitest';
import type { InitializeResponse, NewSessionRequest } from '@agentclientprotocol/sdk';

import { dispatchAcpSessionStart } from './AcpBackend';

const request: NewSessionRequest = {
  cwd: '/workspace',
  mcpServers: [],
};

function connection() {
  return {
    newSession: vi.fn(async () => ({ sessionId: 'new-session' })),
    loadSession: vi.fn(async () => ({})),
    unstable_resumeSession: vi.fn(async () => ({})),
  };
}

function initialize(agentCapabilities: InitializeResponse['agentCapabilities']): InitializeResponse {
  return {
    protocolVersion: 1,
    agentCapabilities,
  } as InitializeResponse;
}

describe('ACP session start dispatch', () => {
  it('uses session/resume when the provider advertises the nested resume capability', async () => {
    const acp = connection();

    await dispatchAcpSessionStart(
      acp as never,
      initialize({
        loadSession: false,
        sessionCapabilities: { resume: {} },
      } as InitializeResponse['agentCapabilities']),
      request,
      'dsh-session',
    );

    expect(acp.unstable_resumeSession).toHaveBeenCalledWith({
      ...request,
      sessionId: 'dsh-session',
    });
    expect(acp.loadSession).not.toHaveBeenCalled();
    expect(acp.newSession).not.toHaveBeenCalled();
  });

  it('keeps load-only providers on legacy session/load', async () => {
    const acp = connection();

    await dispatchAcpSessionStart(
      acp as never,
      initialize({ loadSession: true } as InitializeResponse['agentCapabilities']),
      request,
      'legacy-session',
    );

    expect(acp.loadSession).toHaveBeenCalledWith({
      ...request,
      sessionId: 'legacy-session',
    });
    expect(acp.unstable_resumeSession).not.toHaveBeenCalled();
    expect(acp.newSession).not.toHaveBeenCalled();
  });

  it('rejects restoration when neither ACP capability is advertised', async () => {
    const acp = connection();

    await expect(dispatchAcpSessionStart(
      acp as never,
      initialize({ loadSession: false } as InitializeResponse['agentCapabilities']),
      request,
      'unsupported-session',
    )).rejects.toThrow('does not advertise ACP session/resume or session/load support');

    expect(acp.unstable_resumeSession).not.toHaveBeenCalled();
    expect(acp.loadSession).not.toHaveBeenCalled();
    expect(acp.newSession).not.toHaveBeenCalled();
  });
});
