import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { approvalBrowserCommand, connectIssuer, openApprovalUrl } from './deviceFlow';
import type { IssuerCredentialRecord, SecretStore } from './secretStore';

class TestSecretStore implements SecretStore {
  record: IssuerCredentialRecord | null = null;
  set(record: IssuerCredentialRecord): void { this.record = record; }
  get(): IssuerCredentialRecord | null { return this.record; }
  delete(): boolean { this.record = null; return true; }
  deleteAll(): number { const count = this.record ? 1 : 0; this.record = null; return count; }
  diagnostic(): string { return 'test'; }
}

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('generic issuer connection', () => {
  const requestId = '123e4567-e89b-42d3-a456-426614174000';

  it('opens Windows approval directly without a command-shell parser', () => {
    expect(approvalBrowserCommand('win32', 'https://issuer.example/approve?request=safe')).toEqual({
      command: 'rundll32.exe',
      args: ['url.dll,FileProtocolHandler', 'https://issuer.example/approve?request=safe'],
    });
  });

  it('keeps polling when a headless host cannot launch its URL opener', () => {
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = () => undefined;
    const spawnFailure = (() => child) as unknown as typeof import('node:child_process').spawn;
    openApprovalUrl('https://issuer.example/approve?request=safe', spawnFailure);
    expect(child.listenerCount('error')).toBe(1);
    expect(() => child.emit('error', new Error('opener unavailable'))).not.toThrow();
    const synchronousFailure = (() => { throw new Error('spawn unavailable'); }) as unknown as typeof import('node:child_process').spawn;
    expect(() => openApprovalUrl('https://issuer.example/approve?request=safe', synchronousFailure)).not.toThrow();
  });

  it('uses discovery, PKCE, one browser request identifier, and one successful redemption', async () => {
    const issuer = 'https://issuer.example';
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      json(200, {
        schemaVersion: 1,
        issuer,
        displayName: 'Example Organization',
        deviceAuthorizationEndpoint: `${issuer}/api/agent-toolkit/device-authorizations`,
        tokenEndpoint: `${issuer}/api/agent-toolkit/device-authorizations/token`,
        verificationUri: `${issuer}/agent-toolkit`,
      }),
      json(201, {
        requestId,
        deviceSecret: 's'.repeat(48),
        userCode: 'ABCD-EFGH',
        verificationUri: `${issuer}/agent-toolkit`,
        expiresIn: 600,
        interval: 1,
      }),
      json(400, { error: 'authorization_pending', error_description: 'approval is still pending' }),
      json(200, {
        tokenType: 'Bearer',
        accessToken: 'access-token-value-that-is-long-enough',
        expiresAt: '2027-01-01T00:00:00Z',
        scopes: ['records.read'],
        skillBundle: {
          url: `${issuer}/api/bundles/current`,
          sha256: 'a'.repeat(64),
          manifestSha256: 'b'.repeat(64),
        },
      }),
    ];
    const fetchImplementation = (async (input: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      const response = responses.shift();
      if (!response) throw new Error('unexpected request');
      return response;
    }) as typeof fetch;
    const opened: string[] = [];
    const events: string[] = [];
    const store = new TestSecretStore();
    const result = await connectIssuer({
      issuer,
      clientVersion: '1.2.1-beta.1',
      secretStore: store,
      fetch: fetchImplementation,
      openBrowser: (url) => opened.push(url),
      sleep: async () => undefined,
      now: () => Date.parse('2026-08-17T00:00:00Z'),
      onEvent: (event) => events.push([event.message, event.verificationUrl, event.userCode].filter(Boolean).join(' ')),
    });
    expect(calls).toHaveLength(4);
    expect(calls[0].url).toBe(`${issuer}/.well-known/happyherd.json`);
    const authorization = JSON.parse(String(calls[1].init?.body));
    expect(authorization.pkce.method).toBe('S256');
    expect(authorization.device.publicKey).toMatch(/^[A-Za-z0-9_-]+$/);
    const tokenRequest = JSON.parse(String(calls[3].init?.body));
    expect(tokenRequest).toEqual(expect.objectContaining({
      protocolVersion: 1,
      requestId,
      deviceSecret: 's'.repeat(48),
    }));
    expect(tokenRequest.deviceProof).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(opened).toEqual([`${issuer}/agent-toolkit?request=${requestId}`]);
    expect(opened[0]).not.toContain('ABCD-EFGH');
    expect(events.join(' ')).not.toContain(result.accessToken);
    expect(store.record).toEqual(result);
    expect(responses).toHaveLength(0);
  });

  it('stores a successful one-time token even when no Skill bundle is active', async () => {
    const issuer = 'https://issuer.example';
    const responses = [
      json(200, {
        schemaVersion: 1,
        issuer,
        displayName: 'Example Organization',
        deviceAuthorizationEndpoint: `${issuer}/api/agent-toolkit/device-authorizations`,
        tokenEndpoint: `${issuer}/api/agent-toolkit/device-authorizations/token`,
        verificationUri: `${issuer}/agent-toolkit`,
      }),
      json(201, {
        requestId,
        deviceSecret: 's'.repeat(48),
        userCode: 'ABCD-EFGH',
        verificationUri: `${issuer}/agent-toolkit`,
        expiresIn: 600,
        interval: 1,
      }),
      json(200, {
        tokenType: 'Bearer',
        accessToken: 'one-time-token-that-must-be-preserved',
        expiresAt: '2027-01-01T00:00:00Z',
        scopes: ['guide.read'],
      }),
    ];
    let calls = 0;
    const store = new TestSecretStore();
    const result = await connectIssuer({
      issuer,
      clientVersion: '1.2.1-beta.1',
      secretStore: store,
      fetch: (async () => {
        calls += 1;
        const response = responses.shift();
        if (!response) throw new Error('one-time token was polled more than once');
        return response;
      }) as typeof fetch,
      openBrowser: () => { throw new Error('headless opener unavailable'); },
      sleep: async () => undefined,
      now: () => Date.parse('2026-08-17T00:00:00Z'),
    });
    expect(calls).toBe(3);
    expect(responses).toHaveLength(0);
    expect(result).not.toHaveProperty('skillBundle');
    expect(result).not.toHaveProperty('devicePrivateKey');
    expect(store.record).toEqual(result);
  });
});
