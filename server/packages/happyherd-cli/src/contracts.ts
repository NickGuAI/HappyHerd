/**
 * Strict wire contracts for issuer discovery and the HappyHerd device flow.
 * Protocol v1 deliberately keeps every authorization endpoint on the issuer
 * origin so a discovered document cannot redirect credentials elsewhere.
 */

export interface IssuerDiscovery {
  schemaVersion: 1;
  issuer: string;
  displayName: string;
  deviceAuthorizationEndpoint: string;
  tokenEndpoint: string;
  verificationUri: string;
}

export interface DeviceAuthorizationResponse {
  requestId: string;
  deviceSecret: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface SkillBundleDescriptor {
  url: string;
  sha256: string;
  manifestSha256: string;
}

export interface DeviceTokenResponse {
  tokenType: 'Bearer';
  accessToken: string;
  expiresAt: string;
  scopes: string[];
  skillBundle?: SkillBundleDescriptor;
}

export const MAX_ACCESS_TOKEN_BYTES = 4096;

export type DeviceFlowErrorCode =
  | 'authorization_pending'
  | 'slow_down'
  | 'access_denied'
  | 'expired_token'
  | 'invalid_grant';

export interface DeviceFlowError {
  error: DeviceFlowErrorCode;
  errorDescription?: string;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} keys must be exactly: ${wanted.join(', ')}`);
  }
}

function requiredString(value: unknown, label: string, maximum = 2048): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum
    || /[\u0000-\u001f\u007f-\u009f]/.test(value)
  ) {
    throw new Error(`${label} must be a non-empty string no longer than ${maximum} characters`);
  }
  return value;
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function normalizeIssuer(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('issuer must be an absolute URL');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('issuer must be an origin without credentials, path, query, or fragment');
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback(parsed.hostname))) {
    throw new Error('issuer must use HTTPS (HTTP is allowed only for a loopback issuer)');
  }
  return parsed.origin;
}

export function issuerEndpoint(value: unknown, issuer: string, label: string): string {
  const endpoint = new URL(requiredString(value, label));
  if (
    endpoint.origin !== issuer
    || endpoint.username
    || endpoint.password
    || endpoint.search
    || endpoint.hash
  ) {
    throw new Error(`${label} must be a same-origin URL without credentials, query, or fragment`);
  }
  return endpoint.toString();
}

export function parseIssuerDiscovery(value: unknown, expectedIssuer: string): IssuerDiscovery {
  const discovery = objectValue(value, 'issuer discovery');
  exactKeys(discovery, [
    'schemaVersion',
    'issuer',
    'displayName',
    'deviceAuthorizationEndpoint',
    'tokenEndpoint',
    'verificationUri',
  ], 'issuer discovery');
  if (discovery.schemaVersion !== 1) throw new Error('issuer discovery schemaVersion must equal 1');
  const issuer = normalizeIssuer(requiredString(discovery.issuer, 'issuer discovery issuer'));
  if (issuer !== expectedIssuer) throw new Error('issuer discovery issuer does not match the requested origin');
  return {
    schemaVersion: 1,
    issuer,
    displayName: requiredString(discovery.displayName, 'issuer discovery displayName', 120),
    deviceAuthorizationEndpoint: issuerEndpoint(
      discovery.deviceAuthorizationEndpoint,
      issuer,
      'deviceAuthorizationEndpoint',
    ),
    tokenEndpoint: issuerEndpoint(discovery.tokenEndpoint, issuer, 'tokenEndpoint'),
    verificationUri: issuerEndpoint(discovery.verificationUri, issuer, 'verificationUri'),
  };
}

export function parseDeviceAuthorizationResponse(
  value: unknown,
  discovery: IssuerDiscovery,
): DeviceAuthorizationResponse {
  const response = objectValue(value, 'device authorization response');
  exactKeys(response, [
    'requestId',
    'deviceSecret',
    'userCode',
    'verificationUri',
    'expiresIn',
    'interval',
  ], 'device authorization response');
  const expiresIn = response.expiresIn;
  const interval = response.interval;
  if (!Number.isInteger(expiresIn) || Number(expiresIn) < 1 || Number(expiresIn) > 600) {
    throw new Error('device authorization expiresIn must be an integer from 1 through 600 seconds');
  }
  if (!Number.isInteger(interval) || Number(interval) < 1 || Number(interval) > 30) {
    throw new Error('device authorization interval must be an integer from 1 through 30 seconds');
  }
  const verificationUri = issuerEndpoint(response.verificationUri, discovery.issuer, 'verificationUri');
  if (verificationUri !== discovery.verificationUri) {
    throw new Error('device authorization verificationUri does not match issuer discovery');
  }
  const requestId = requiredString(response.requestId, 'requestId', 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new Error('requestId must be a UUID');
  }
  const deviceSecret = requiredString(response.deviceSecret, 'deviceSecret', 1024);
  if (deviceSecret.length < 32) throw new Error('deviceSecret must contain at least 32 characters');
  const userCode = requiredString(response.userCode, 'userCode', 9);
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(userCode)) {
    throw new Error('userCode must contain exactly four uppercase letters or digits, a hyphen, and four uppercase letters or digits');
  }
  return {
    requestId,
    deviceSecret,
    userCode,
    verificationUri,
    expiresIn: Number(expiresIn),
    interval: Number(interval),
  };
}

function digest(value: unknown, label: string): string {
  const normalized = requiredString(value, label, 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error(`${label} must be a SHA-256 hex digest`);
  return normalized;
}

export function parseDeviceTokenResponse(
  value: unknown,
  discovery: IssuerDiscovery,
): DeviceTokenResponse {
  const response = objectValue(value, 'device token response');
  const expectedKeys = ['tokenType', 'accessToken', 'expiresAt', 'scopes'];
  if (Object.hasOwn(response, 'skillBundle')) expectedKeys.push('skillBundle');
  exactKeys(response, expectedKeys, 'device token response');
  if (response.tokenType !== 'Bearer') throw new Error('device token response tokenType must be Bearer');
  const accessToken = requiredString(response.accessToken, 'accessToken', MAX_ACCESS_TOKEN_BYTES);
  if (accessToken.length < 24) throw new Error('accessToken must contain at least 24 characters');
  if (Buffer.byteLength(accessToken, 'utf8') > MAX_ACCESS_TOKEN_BYTES) {
    throw new Error(`accessToken must contain at most ${MAX_ACCESS_TOKEN_BYTES} UTF-8 bytes`);
  }
  const expiresAt = requiredString(response.expiresAt, 'expiresAt', 64);
  if (!Number.isFinite(Date.parse(expiresAt))) throw new Error('expiresAt must be an ISO timestamp');
  if (
    !Array.isArray(response.scopes)
    || response.scopes.length > 256
    || response.scopes.some((scope) => (
      typeof scope !== 'string'
      || !scope
      || scope.length > 240
      || /[\u0000-\u001f\u007f-\u009f]/.test(scope)
    ))
  ) {
    throw new Error('scopes must be a bounded array of control-free strings');
  }
  const parsed: DeviceTokenResponse = {
    tokenType: 'Bearer',
    accessToken,
    expiresAt,
    scopes: [...new Set(response.scopes as string[])].sort(),
  };
  if (response.skillBundle !== undefined) {
    const bundle = objectValue(response.skillBundle, 'skillBundle');
    exactKeys(bundle, ['url', 'sha256', 'manifestSha256'], 'skillBundle');
    parsed.skillBundle = {
      url: issuerEndpoint(bundle.url, discovery.issuer, 'skillBundle.url'),
      sha256: digest(bundle.sha256, 'skillBundle.sha256'),
      manifestSha256: digest(bundle.manifestSha256, 'skillBundle.manifestSha256'),
    };
  }
  return parsed;
}

export function parseDeviceFlowError(value: unknown): DeviceFlowError {
  const response = objectValue(value, 'device flow error');
  const expectedKeys = ['error'];
  const hasSnakeDescription = Object.hasOwn(response, 'error_description');
  const hasCamelDescription = Object.hasOwn(response, 'errorDescription');
  if (hasSnakeDescription && hasCamelDescription) {
    throw new Error('device flow error must not contain both error description fields');
  }
  if (hasSnakeDescription) expectedKeys.push('error_description');
  if (hasCamelDescription) expectedKeys.push('errorDescription');
  exactKeys(response, expectedKeys, 'device flow error');
  const code = requiredString(response.error, 'device flow error code', 64);
  const codes: DeviceFlowErrorCode[] = [
    'authorization_pending',
    'slow_down',
    'access_denied',
    'expired_token',
    'invalid_grant',
  ];
  if (!codes.includes(code as DeviceFlowErrorCode)) throw new Error('issuer returned an unknown device flow error');
  return {
    error: code as DeviceFlowErrorCode,
    ...(!hasSnakeDescription && !hasCamelDescription
      ? {}
      : {
          errorDescription: requiredString(
            hasSnakeDescription ? response.error_description : response.errorDescription,
            'error_description',
            240,
          ),
        }),
  };
}
