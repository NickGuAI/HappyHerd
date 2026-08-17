/** Cryptographic material for PKCE and proof-of-possession device redemption. */

import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto';

export interface DeviceAuthorizationMaterial {
  codeVerifier: string;
  codeChallenge: string;
  publicKey: string;
  privateKey: string;
}

export function sha256Base64Url(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('base64url');
}

export function createDeviceAuthorizationMaterial(): DeviceAuthorizationMaterial {
  const codeVerifier = randomBytes(64).toString('base64url');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    codeVerifier,
    codeChallenge: sha256Base64Url(codeVerifier),
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url'),
  };
}

export function createDeviceProof(
  requestId: string,
  deviceSecret: string,
  codeVerifier: string,
  privateKey: string,
): string {
  const payload = [
    'happyherd-device-token-v1',
    requestId,
    sha256Base64Url(deviceSecret),
    sha256Base64Url(codeVerifier),
  ].join('\n');
  return sign(
    null,
    Buffer.from(payload, 'utf8'),
    { key: Buffer.from(privateKey, 'base64url'), type: 'pkcs8', format: 'der' },
  ).toString('base64url');
}
