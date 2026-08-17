import { createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createDeviceAuthorizationMaterial,
  createDeviceProof,
  sha256Base64Url,
} from './crypto';

describe('device authorization cryptography', () => {
  it('creates an RFC 7636 S256 challenge and verifiable device proof', () => {
    const material = createDeviceAuthorizationMaterial();
    expect(material.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(material.codeVerifier.length).toBeLessThanOrEqual(128);
    expect(material.codeChallenge).toBe(sha256Base64Url(material.codeVerifier));
    const requestId = 'request-123';
    const deviceSecret = 'device-secret-value';
    const proof = createDeviceProof(requestId, deviceSecret, material.codeVerifier, material.privateKey);
    const payload = [
      'happyherd-device-token-v1',
      requestId,
      sha256Base64Url(deviceSecret),
      sha256Base64Url(material.codeVerifier),
    ].join('\n');
    expect(verify(
      null,
      Buffer.from(payload),
      createPublicKey({ key: Buffer.from(material.publicKey, 'base64url'), type: 'spki', format: 'der' }),
      Buffer.from(proof, 'base64url'),
    )).toBe(true);
  });
});
