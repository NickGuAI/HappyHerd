/** Generic issuer discovery and ten-minute, single-use device authorization. */

import { spawn } from 'node:child_process';
import {
  createDeviceAuthorizationMaterial,
  createDeviceProof,
} from './crypto';
import {
  normalizeIssuer,
  parseDeviceAuthorizationResponse,
  parseDeviceFlowError,
  parseDeviceTokenResponse,
  parseIssuerDiscovery,
  type DeviceTokenResponse,
  type IssuerDiscovery,
} from './contracts';
import type { IssuerCredentialRecord, SecretStore } from './secretStore';
import { readBoundedJson } from './boundedResponse';

const MAX_DEVICE_JSON_BYTES = 256 * 1024;

export interface ConnectEvent {
  type: 'approval' | 'pending' | 'connected';
  message: string;
  verificationUrl?: string;
  userCode?: string;
}

export interface ConnectOptions {
  issuer: string;
  clientVersion: string;
  secretStore: SecretStore;
  fetch?: typeof fetch;
  openBrowser?: (url: string) => void;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  onEvent?: (event: ConnectEvent) => void;
}

async function jsonResponse(response: Response, label: string): Promise<unknown> {
  return readBoundedJson(response, MAX_DEVICE_JSON_BYTES, label);
}

export function approvalBrowserCommand(platform: NodeJS.Platform, url: string): { command: string; args: string[] } {
  if (platform === 'darwin') return { command: 'open', args: [url] };
  if (platform === 'win32') {
    return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  }
  return { command: 'xdg-open', args: [url] };
}

export function openApprovalUrl(url: string, spawnImplementation: typeof spawn = spawn): void {
  const { command, args } = approvalBrowserCommand(process.platform, url);
  try {
    const child = spawnImplementation(command, args, { detached: true, stdio: 'ignore' });
    // A headless host may not have xdg-open (or another platform opener).
    // The URL and code were already printed, so opener failure must not abort
    // polling or consume the one-time device grant.
    child.once('error', () => undefined);
    child.unref();
  } catch {
    // Synchronous spawn setup failures have the same manual-open fallback.
  }
}

export async function discoverIssuer(
  issuerInput: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<IssuerDiscovery> {
  const issuer = normalizeIssuer(issuerInput);
  const response = await fetchImplementation(`${issuer}/.well-known/happyherd.json`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`issuer discovery failed with HTTP ${response.status}`);
  return parseIssuerDiscovery(await jsonResponse(response, 'issuer discovery'), issuer);
}

export async function connectIssuer(options: ConnectOptions): Promise<IssuerCredentialRecord> {
  const fetchImplementation = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now ?? Date.now;
  const discovery = await discoverIssuer(options.issuer, fetchImplementation);
  const material = createDeviceAuthorizationMaterial();
  const authorizationResponse = await fetchImplementation(discovery.deviceAuthorizationEndpoint, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      protocolVersion: 1,
      client: { name: 'HappyHerd', version: options.clientVersion },
      device: {
        platform: process.platform,
        architecture: process.arch,
        publicKey: material.publicKey,
      },
      pkce: { codeChallenge: material.codeChallenge, method: 'S256' },
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (authorizationResponse.status !== 201) {
    throw new Error(`device authorization failed with HTTP ${authorizationResponse.status}`);
  }
  const authorization = parseDeviceAuthorizationResponse(
    await jsonResponse(authorizationResponse, 'device authorization'),
    discovery,
  );
  const verificationUrl = new URL(authorization.verificationUri);
  verificationUrl.searchParams.set('request', authorization.requestId);
  options.onEvent?.({
    type: 'approval',
    message: `Approve this device with ${discovery.displayName}`,
    verificationUrl: verificationUrl.toString(),
    userCode: authorization.userCode,
  });
  try {
    (options.openBrowser ?? openApprovalUrl)(verificationUrl.toString());
  } catch {
    // Printing the URL and user code is the durable fallback. A custom opener
    // has the same fail-open-for-navigation contract as the platform opener:
    // browser launch failure must not consume or abandon the device request.
  }

  const deadline = now() + authorization.expiresIn * 1_000;
  let interval = authorization.interval * 1_000;
  while (now() < deadline) {
    await sleep(interval);
    const tokenResponse = await fetchImplementation(discovery.tokenEndpoint, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocolVersion: 1,
        requestId: authorization.requestId,
        deviceSecret: authorization.deviceSecret,
        codeVerifier: material.codeVerifier,
        deviceProof: createDeviceProof(
          authorization.requestId,
          authorization.deviceSecret,
          material.codeVerifier,
          material.privateKey,
        ),
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (tokenResponse.status === 200) {
      const token: DeviceTokenResponse = parseDeviceTokenResponse(
        await jsonResponse(tokenResponse, 'device token response'),
        discovery,
      );
      if (Date.parse(token.expiresAt) <= now()) {
        throw new Error('device token response is already expired');
      }
      const record: IssuerCredentialRecord = {
        schemaVersion: 1,
        issuer: discovery.issuer,
        tokenType: token.tokenType,
        accessToken: token.accessToken,
        expiresAt: token.expiresAt,
        scopes: token.scopes,
        connectedAt: new Date(now()).toISOString(),
        ...(token.skillBundle ? { skillBundle: token.skillBundle } : {}),
      };
      options.secretStore.set(record);
      options.onEvent?.({ type: 'connected', message: `Connected to ${discovery.displayName}` });
      return record;
    }
    if (tokenResponse.status !== 400 && tokenResponse.status !== 429) {
      throw new Error(`device token request failed with HTTP ${tokenResponse.status}`);
    }
    const deviceError = parseDeviceFlowError(await jsonResponse(tokenResponse, 'device token response'));
    if (deviceError.error === 'authorization_pending') {
      options.onEvent?.({ type: 'pending', message: 'Waiting for browser approval' });
      continue;
    }
    if (deviceError.error === 'slow_down') {
      interval += 5_000;
      continue;
    }
    throw new Error(`device authorization ended: ${deviceError.error}`);
  }
  throw new Error('device authorization expired before approval');
}
