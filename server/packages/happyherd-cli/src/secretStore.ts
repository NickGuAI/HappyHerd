/**
 * Native OS secret-store boundary for issuer credentials. There is no
 * file-backed fallback: Keychain, Credential Manager, or Secret Service must
 * accept the value or connection publication fails closed.
 */

import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { Entry, findCredentials, type Credential } from '@napi-rs/keyring';
import {
  issuerEndpoint,
  MAX_ACCESS_TOKEN_BYTES,
  normalizeIssuer,
  type SkillBundleDescriptor,
} from './contracts';

const SERVICE = 'dev.happyherd.issuer.v1';

export interface IssuerCredentialRecord {
  schemaVersion: 1;
  issuer: string;
  tokenType: 'Bearer';
  accessToken: string;
  expiresAt: string;
  scopes: string[];
  connectedAt: string;
  skillBundle?: SkillBundleDescriptor;
}

export interface SecretEntry {
  setPassword(value: string): void;
  getPassword(): string | null;
  deletePassword(): boolean;
}

export type SecretEntryFactory = (service: string, account: string) => SecretEntry;
export type SecretEnumeration = (service: string) => Credential[];

export interface SecretStore {
  set(record: IssuerCredentialRecord): void;
  get(issuer: string): IssuerCredentialRecord | null;
  delete(issuer: string): boolean;
  deleteAll(): number;
  diagnostic(): string;
}

export function accountFor(issuer: string): string {
  return `issuer:${createHash('sha256').update(issuer).digest('hex').slice(0, 32)}`;
}

function parseRecord(serialized: string, issuer: string): IssuerCredentialRecord {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error('stored issuer credential is not valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('stored issuer credential has an invalid shape');
  }
  const record = value as Record<string, unknown>;
  const expectedKeys = [
    'schemaVersion',
    'issuer',
    'tokenType',
    'accessToken',
    'expiresAt',
    'scopes',
    'connectedAt',
  ];
  if (Object.hasOwn(record, 'skillBundle')) expectedKeys.push('skillBundle');
  const bundle = record.skillBundle;
  if (
    JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(expectedKeys.sort())
    || record.schemaVersion !== 1
    || record.issuer !== issuer
    || normalizeIssuer(issuer) !== issuer
    || record.tokenType !== 'Bearer'
    || typeof record.accessToken !== 'string'
    || record.accessToken.length < 24
    || Buffer.byteLength(record.accessToken, 'utf8') > MAX_ACCESS_TOKEN_BYTES
    || /[\u0000-\u001f\u007f-\u009f]/.test(record.accessToken)
    || typeof record.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(record.expiresAt))
    || !Array.isArray(record.scopes)
    || record.scopes.length > 256
    || record.scopes.some((scope) => (
      typeof scope !== 'string'
      || !scope
      || scope.length > 240
      || /[\u0000-\u001f\u007f-\u009f]/.test(scope)
    ))
    || typeof record.connectedAt !== 'string'
    || !Number.isFinite(Date.parse(record.connectedAt))
  ) throw new Error('stored issuer credential failed validation');
  if (bundle !== undefined) {
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
      throw new Error('stored issuer credential failed validation');
    }
    const descriptor = bundle as Record<string, unknown>;
    if (
      JSON.stringify(Object.keys(descriptor).sort()) !== JSON.stringify(['url', 'sha256', 'manifestSha256'].sort())
      || typeof descriptor.url !== 'string'
      || issuerEndpoint(descriptor.url, issuer, 'stored skillBundle.url') !== descriptor.url
      || typeof descriptor.sha256 !== 'string'
      || !/^[0-9a-f]{64}$/.test(descriptor.sha256)
      || typeof descriptor.manifestSha256 !== 'string'
      || !/^[0-9a-f]{64}$/.test(descriptor.manifestSha256)
    ) throw new Error('stored issuer credential failed validation');
  }
  return record as unknown as IssuerCredentialRecord;
}

export class KeyringSecretStore implements SecretStore {
  readonly #entryFactory: SecretEntryFactory;
  readonly #enumerate: SecretEnumeration;

  constructor(
    entryFactory?: SecretEntryFactory,
    enumerate?: SecretEnumeration,
  ) {
    const configuredTarget = process.platform === 'darwin' ? process.env.HAPPYHERD_KEYRING_TARGET : undefined;
    if (configuredTarget !== undefined && (
      !isAbsolute(configuredTarget)
      || resolve(configuredTarget) !== configuredTarget
      || !configuredTarget.endsWith('/happyherd.keychain-db')
      || /[\u0000-\u001f\u007f-\u009f]/.test(configuredTarget)
    )) throw new Error('the configured macOS service Keychain target is invalid');
    this.#entryFactory = entryFactory ?? (configuredTarget
      ? (service, account) => Entry.withTarget(configuredTarget, service, account)
      : (service, account) => new Entry(service, account));
    this.#enumerate = enumerate ?? ((service) => findCredentials(service, configuredTarget));
  }

  #credentials(): Credential[] {
    let credentials: Credential[];
    try {
      credentials = this.#enumerate(SERVICE);
    } catch {
      throw new Error(process.platform === 'linux'
        ? 'the durable Secret Service backend is unavailable; Linux keyutils fallback is forbidden'
        : 'the operating system secret store is unavailable');
    }
    if (!Array.isArray(credentials) || credentials.some((credential) => (
      !credential
      || typeof credential.account !== 'string'
      || typeof credential.password !== 'string'
    ))) throw new Error('the operating system secret store returned an invalid credential inventory');
    return credentials;
  }

  #serialized(account: string): string | null {
    const matches = this.#credentials().filter((credential) => credential.account === account);
    if (matches.length > 1) throw new Error('the operating system secret store contains ambiguous issuer credentials');
    return matches[0]?.password ?? null;
  }

  set(record: IssuerCredentialRecord): void {
    const issuer = normalizeIssuer(record.issuer);
    const validated = parseRecord(JSON.stringify(record), issuer);
    const account = accountFor(issuer);
    const serialized = JSON.stringify(validated);
    // Enumeration is intentionally performed before and after publication.
    // On Linux, @napi-rs/keyring's enumerator talks directly to Secret Service
    // while Entry construction may otherwise fall back to volatile keyutils.
    // The postcondition therefore makes fallback detectable and forbidden.
    const previous = this.#serialized(account);
    try {
      this.#entryFactory(SERVICE, account).setPassword(serialized);
      if (this.#serialized(account) !== serialized) throw new Error('secret-store publication mismatch');
    } catch {
      try {
        const entry = this.#entryFactory(SERVICE, account);
        if (previous === null) entry.deletePassword();
        else entry.setPassword(previous);
        if (this.#serialized(account) !== previous) throw new Error('credential rollback mismatch');
      } catch {
        throw new Error(
          'the operating system secret store rejected the issuer credential and the previous state could not be restored; credential state is uncertain',
        );
      }
      throw new Error(previous === null
        ? (process.platform === 'linux'
          ? 'the issuer credential did not reach durable Secret Service; volatile keyutils fallback was rejected, no plaintext copy was written, and no credential remains'
          : 'the operating system secret store did not verify the issuer credential publication; no plaintext copy was written and no credential remains')
        : 'the operating system secret store did not verify the issuer credential publication; the previous credential was restored');
    }
  }

  get(issuerInput: string): IssuerCredentialRecord | null {
    const issuer = normalizeIssuer(issuerInput);
    const serialized = this.#serialized(accountFor(issuer));
    return serialized === null ? null : parseRecord(serialized, issuer);
  }

  delete(issuerInput: string): boolean {
    const issuer = normalizeIssuer(issuerInput);
    const account = accountFor(issuer);
    if (this.#serialized(account) === null) return false;
    try {
      this.#entryFactory(SERVICE, account).deletePassword();
    } catch {
      throw new Error('the operating system secret store could not delete the issuer credential');
    }
    if (this.#serialized(account) !== null) {
      throw new Error('the operating system secret store did not verify issuer credential deletion');
    }
    return true;
  }

  deleteAll(): number {
    const credentials = this.#credentials();
    const records = credentials.map((credential) => {
      let value: unknown;
      try { value = JSON.parse(credential.password); } catch { throw new Error('stored issuer credential is not valid JSON'); }
      if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as Record<string, unknown>).issuer !== 'string') {
        throw new Error('stored issuer credential has an invalid shape');
      }
      const issuer = normalizeIssuer((value as Record<string, unknown>).issuer as string);
      parseRecord(credential.password, issuer);
      if (credential.account !== accountFor(issuer)) throw new Error('stored issuer credential account does not match its issuer');
      return issuer;
    });
    let removed = 0;
    for (const issuer of records) {
      try {
        if (!this.delete(issuer)) throw new Error('credential disappeared before verified deletion');
        removed += 1;
      } catch (error) {
        throw new Error(
          `issuer credential purge partially failed after removing ${removed} of ${records.length}; `
          + `${records.length - removed} credential(s) remain or require verification: `
          + (error instanceof Error ? error.message : String(error)),
        );
      }
    }
    return removed;
  }

  diagnostic(): string {
    this.#credentials();
    return process.platform === 'darwin'
      ? (process.env.HAPPYHERD_KEYRING_TARGET
        ? 'durable isolated macOS service Keychain ready'
        : 'macOS login Keychain ready')
      : process.platform === 'win32'
        ? 'Windows Credential Manager ready'
        : 'durable Linux Secret Service ready; keyutils fallback disabled';
  }
}
