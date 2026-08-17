import { describe, expect, it } from 'vitest';
import {
  normalizeIssuer,
  parseDeviceAuthorizationResponse,
  parseDeviceTokenResponse,
  parseIssuerDiscovery,
} from './contracts';

const issuer = 'https://issuer.example';
const requestId = '123e4567-e89b-42d3-a456-426614174000';
const discovery = {
  schemaVersion: 1 as const,
  issuer,
  displayName: 'Example Organization',
  deviceAuthorizationEndpoint: `${issuer}/api/agent-toolkit/device-authorizations`,
  tokenEndpoint: `${issuer}/api/agent-toolkit/device-authorizations/token`,
  verificationUri: `${issuer}/agent-toolkit`,
};

describe('issuer and device contracts', () => {
  it('accepts only a clean HTTPS issuer origin', () => {
    expect(normalizeIssuer(`${issuer}/`)).toBe(issuer);
    expect(normalizeIssuer('http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000');
    expect(() => normalizeIssuer(`${issuer}/path`)).toThrow('without credentials, path, query, or fragment');
    expect(() => normalizeIssuer('http://issuer.example/')).toThrow('must use HTTPS');
  });

  it('pins every discovered endpoint to the requested issuer origin', () => {
    expect(parseIssuerDiscovery(discovery, issuer)).toEqual(discovery);
    expect(() => parseIssuerDiscovery({
      ...discovery,
      tokenEndpoint: 'https://other.example/token',
    }, issuer)).toThrow('same-origin');
    expect(() => parseIssuerDiscovery({ ...discovery, extra: true }, issuer)).toThrow('keys must be exactly');
  });

  it('enforces the ten-minute authorization ceiling', () => {
    const response = {
      requestId,
      deviceSecret: 's'.repeat(48),
      userCode: 'ABCD-EFGH',
      verificationUri: discovery.verificationUri,
      expiresIn: 600,
      interval: 5,
    };
    expect(parseDeviceAuthorizationResponse(response, discovery).expiresIn).toBe(600);
    expect(() => parseDeviceAuthorizationResponse({ ...response, expiresIn: 601 }, discovery)).toThrow('1 through 600');
    expect(() => parseDeviceAuthorizationResponse({ ...response, requestId: 'not-a-uuid' }, discovery)).toThrow('UUID');
    expect(() => parseDeviceAuthorizationResponse({ ...response, userCode: 'abcd-efgh' }, discovery)).toThrow('exactly four uppercase');
  });

  it('rejects a bundle URL carrying query data', () => {
    const response = {
      tokenType: 'Bearer',
      accessToken: 't'.repeat(48),
      expiresAt: '2026-12-01T00:00:00Z',
      scopes: ['records.read'],
      skillBundle: {
        url: `${issuer}/bundle.zip?credential=bad`,
        sha256: 'a'.repeat(64),
        manifestSha256: 'b'.repeat(64),
      },
    };
    expect(() => parseDeviceTokenResponse(response, discovery)).toThrow('without credentials, query, or fragment');
  });

  it('accepts an exact success contract while Skill distribution is paused', () => {
    const response = {
      tokenType: 'Bearer',
      accessToken: 't'.repeat(48),
      expiresAt: '2026-12-01T00:00:00Z',
      scopes: [],
    };
    expect(parseDeviceTokenResponse(response, discovery)).toEqual(response);
    expect(() => parseDeviceTokenResponse({ ...response, extra: true }, discovery)).toThrow('keys must be exactly');
    expect(() => parseDeviceTokenResponse({ ...response, scopes: ['unsafe\nvalue'] }, discovery)).toThrow('control-free');
    expect(() => parseDeviceTokenResponse({ ...response, accessToken: 't'.repeat(4097) }, discovery)).toThrow();
    expect(() => parseDeviceTokenResponse({ ...response, accessToken: 'é'.repeat(3000) }, discovery)).toThrow('UTF-8 bytes');
  });
});
