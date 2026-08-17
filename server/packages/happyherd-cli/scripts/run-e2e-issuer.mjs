#!/usr/bin/env node

import { createHash, createPublicKey, verify } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || !process.argv[index + 1]) throw new Error(`--${name} is required`);
  return process.argv[index + 1];
}

function sha256Base64Url(value) { return createHash('sha256').update(value).digest('base64url'); }
function response(target, status, value, type = 'application/json') {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  target.writeHead(status, { 'content-type': type, 'content-length': String(bytes.length), 'cache-control': 'no-store' });
  target.end(bytes);
}
async function jsonBody(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 65536) throw new Error('request too large'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const fixture = JSON.parse(readFileSync(resolve(option('fixture')), 'utf8'));
const issuer = new URL(fixture.issuer);
const port = Number(issuer.port);
const requestId = '123e4567-e89b-42d3-a456-426614174000';
const deviceSecret = 'e2e-device-secret-value-that-is-long-enough';
let authorization = null;
const bundle = readFileSync(fixture.bundlePath);

const server = createServer(async (request, target) => {
  try {
    const url = new URL(request.url ?? '/', issuer.origin);
    if (request.method === 'GET' && url.pathname === '/.well-known/happyherd.json') {
      response(target, 200, {
        schemaVersion: 1,
        issuer: issuer.origin,
        displayName: 'HappyHerd E2E Issuer',
        deviceAuthorizationEndpoint: `${issuer.origin}/api/device-authorizations`,
        tokenEndpoint: `${issuer.origin}/api/device-authorizations/token`,
        verificationUri: `${issuer.origin}/approve`,
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/device-authorizations') {
      const body = await jsonBody(request);
      if (
        body.protocolVersion !== 1
        || body.client?.name !== 'HappyHerd'
        || typeof body.client?.version !== 'string'
        || body.device?.platform === undefined
        || typeof body.device?.publicKey !== 'string'
        || typeof body.pkce?.codeChallenge !== 'string'
        || body.pkce?.method !== 'S256'
      ) throw new Error('invalid device authorization request');
      authorization = { publicKey: body.device.publicKey, codeChallenge: body.pkce.codeChallenge };
      response(target, 201, {
        requestId,
        deviceSecret,
        userCode: 'E2E0-CODE',
        verificationUri: `${issuer.origin}/approve`,
        expiresIn: 600,
        interval: 1,
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/device-authorizations/token') {
      const body = await jsonBody(request);
      if (!authorization || body.protocolVersion !== 1 || body.requestId !== requestId || body.deviceSecret !== deviceSecret) throw new Error('invalid device grant');
      if (sha256Base64Url(body.codeVerifier) !== authorization.codeChallenge) throw new Error('PKCE verification failed');
      const payload = ['happyherd-device-token-v1', requestId, sha256Base64Url(deviceSecret), sha256Base64Url(body.codeVerifier)].join('\n');
      const publicKey = createPublicKey({ key: Buffer.from(authorization.publicKey, 'base64url'), type: 'spki', format: 'der' });
      if (!verify(null, Buffer.from(payload), publicKey, Buffer.from(body.deviceProof, 'base64url'))) throw new Error('device proof failed');
      response(target, 200, {
        tokenType: 'Bearer',
        accessToken: fixture.accessToken,
        expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
        scopes: ['guide.read'],
        skillBundle: {
          url: `${issuer.origin}/api/bundles/current`,
          sha256: fixture.bundleSha256,
          manifestSha256: fixture.manifestSha256,
        },
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/bundles/current') {
      if (request.headers.authorization !== `Bearer ${fixture.accessToken}`) { response(target, 401, { error: 'unauthorized' }); return; }
      response(target, 200, bundle, 'application/zip');
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/protected') {
      if (request.headers.authorization !== `Bearer ${fixture.accessToken}`) { response(target, 401, { error: 'unauthorized' }); return; }
      response(target, 200, { result: 'verified-e2e' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/approve') { response(target, 200, 'Approved by automated E2E fixture', 'text/plain'); return; }
    response(target, 404, { error: 'not_found' });
  } catch (error) {
    response(target, 400, { error: error instanceof Error ? error.message : 'fixture failure' });
  }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`issuer-ready ${issuer.origin}\n`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
