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
const MACOS_INDEX_ACCOUNT = 'issuer-index:v1';
const MAX_ISSUER_CREDENTIALS = 256;

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

interface MacosIssuerIndexSnapshot {
  serialized: string;
  issuers: string[];
}

function parseMacosIssuerIndex(serialized: string | null): string[] {
  if (serialized === null) throw new Error('the macOS issuer credential index is missing');
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error('the macOS issuer credential index is not valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('the macOS issuer credential index has an invalid shape');
  }
  const index = value as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(index).sort()) !== JSON.stringify(['schemaVersion', 'issuers'].sort())
    || index.schemaVersion !== 1
    || !Array.isArray(index.issuers)
    || index.issuers.length > MAX_ISSUER_CREDENTIALS
    || index.issuers.some((issuer) => typeof issuer !== 'string')
  ) throw new Error('the macOS issuer credential index failed validation');
  const issuers = (index.issuers as string[]).map((issuer) => normalizeIssuer(issuer));
  const canonical = [...new Set(issuers)].sort();
  if (JSON.stringify(issuers) !== JSON.stringify(canonical)) {
    throw new Error('the macOS issuer credential index failed validation');
  }
  return canonical;
}

function serializeMacosIssuerIndex(issuers: string[]): string {
  const normalized = issuers.map((issuer) => normalizeIssuer(issuer));
  const canonical = [...new Set(normalized)].sort();
  if (canonical.length > MAX_ISSUER_CREDENTIALS) {
    throw new Error(`the macOS issuer credential index cannot exceed ${MAX_ISSUER_CREDENTIALS} issuers`);
  }
  return JSON.stringify({ schemaVersion: 1, issuers: canonical });
}

export class KeyringSecretStore implements SecretStore {
  readonly #entryFactory: SecretEntryFactory;
  readonly #enumerate: SecretEnumeration;
  readonly #platform: NodeJS.Platform;

  constructor(
    entryFactory?: SecretEntryFactory,
    enumerate?: SecretEnumeration,
    platform: NodeJS.Platform = process.platform,
  ) {
    this.#platform = platform;
    const configuredPath = platform === 'darwin' ? process.env.HAPPYHERD_KEYRING_PATH : undefined;
    if (configuredPath !== undefined && (
      !isAbsolute(configuredPath)
      || resolve(configuredPath) !== configuredPath
      || !configuredPath.endsWith('/happyherd.keychain-db')
      || /[\u0000-\u001f\u007f-\u009f]/.test(configuredPath)
    )) throw new Error('the configured macOS service Keychain target is invalid');
    // The native macOS host publishes its private Keychain as the isolated
    // service user's complete User-domain search list before this process is
    // started. Using the normal User domain is intentional: the current
    // @napi-rs/keyring macOS target modifier accepts domain names, not paths.
    this.#entryFactory = entryFactory ?? ((service, account) => new Entry(service, account));
    this.#enumerate = enumerate ?? ((service) => findCredentials(service));
  }

  #unavailable(): Error {
    return new Error(this.#platform === 'linux'
      ? 'the durable Secret Service backend is unavailable; Linux keyutils fallback is forbidden'
      : 'the operating system secret store is unavailable');
  }

  #entry(account: string): SecretEntry {
    try {
      return this.#entryFactory(SERVICE, account);
    } catch {
      throw this.#unavailable();
    }
  }

  #entryValue(account: string): string | null {
    try {
      const value = this.#entry(account).getPassword();
      if (value !== null && typeof value !== 'string') {
        throw new Error('invalid secret-store value');
      }
      return value;
    } catch (error) {
      if (error instanceof Error && error.message === 'invalid secret-store value') {
        throw new Error('the operating system secret store returned an invalid credential');
      }
      throw this.#unavailable();
    }
  }

  #macosIndex(): MacosIssuerIndexSnapshot {
    let serialized = this.#entryValue(MACOS_INDEX_ACCOUNT);
    if (serialized === null) {
      const empty = serializeMacosIssuerIndex([]);
      try {
        this.#entry(MACOS_INDEX_ACCOUNT).setPassword(empty);
      } catch {
        throw new Error('the macOS issuer credential index could not be initialized');
      }
      serialized = this.#entryValue(MACOS_INDEX_ACCOUNT);
      if (serialized !== empty) {
        throw new Error('the macOS issuer credential index could not be verified');
      }
    }
    return { serialized, issuers: parseMacosIssuerIndex(serialized) };
  }

  #assertMacosMembership(issuer: string, serialized: string | null, issuers: string[]): void {
    if (issuers.includes(issuer) !== (serialized !== null)) {
      throw new Error('the macOS issuer credential and its protected index are inconsistent');
    }
  }

  #publishMacosIndex(issuers: string[]): void {
    const entry = this.#entry(MACOS_INDEX_ACCOUNT);
    const expected = serializeMacosIssuerIndex(issuers);
    entry.setPassword(expected);
    if (this.#entryValue(MACOS_INDEX_ACCOUNT) !== expected) {
      throw new Error('macOS issuer credential index publication mismatch');
    }
  }

  #restoreMacosState(
    account: string,
    credential: string | null,
    index: MacosIssuerIndexSnapshot,
  ): void {
    const entry = this.#entry(account);
    if (credential === null) {
      if (!entry.deletePassword()) throw new Error('credential rollback deletion was not acknowledged');
    }
    else entry.setPassword(credential);
    const indexEntry = this.#entry(MACOS_INDEX_ACCOUNT);
    indexEntry.setPassword(index.serialized);
    if (
      this.#entryValue(account) !== credential
      || this.#entryValue(MACOS_INDEX_ACCOUNT) !== index.serialized
    ) throw new Error('credential rollback mismatch');
  }

  #credentials(): Credential[] {
    if (this.#platform === 'darwin') {
      const index = this.#macosIndex();
      return index.issuers.map((issuer) => {
        const account = accountFor(issuer);
        const password = this.#entryValue(account);
        this.#assertMacosMembership(issuer, password, index.issuers);
        if (password === null) throw new Error('the macOS issuer credential index references a missing credential');
        parseRecord(password, issuer);
        return { account, password };
      });
    }
    let credentials: Credential[];
    try {
      credentials = this.#enumerate(SERVICE);
    } catch {
      throw this.#unavailable();
    }
    if (!Array.isArray(credentials) || credentials.some((credential) => (
      !credential
      || typeof credential.account !== 'string'
      || typeof credential.password !== 'string'
    ))) throw new Error('the operating system secret store returned an invalid credential inventory');
    return credentials;
  }

  #serialized(account: string): string | null {
    // keyring-node 1.3.0's macOS Entry operations honor the configured User
    // domain Keychain, while findCredentials performs a separate global
    // SecItem query and cannot target that isolated Keychain. Use the same
    // keyed API for publication and verification on macOS. A protected,
    // non-secret issuer index below preserves deterministic purge semantics.
    if (this.#platform === 'darwin') return this.#entryValue(account);
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
    const previousIndex = this.#platform === 'darwin' ? this.#macosIndex() : null;
    const previous = this.#serialized(account);
    if (previousIndex) this.#assertMacosMembership(issuer, previous, previousIndex.issuers);
    try {
      this.#entry(account).setPassword(serialized);
      if (this.#serialized(account) !== serialized) throw new Error('secret-store publication mismatch');
      if (previousIndex) this.#publishMacosIndex([...previousIndex.issuers, issuer]);
    } catch {
      try {
        if (previousIndex) this.#restoreMacosState(account, previous, previousIndex);
        else {
          const entry = this.#entry(account);
          if (previous === null) entry.deletePassword();
          else entry.setPassword(previous);
          if (this.#serialized(account) !== previous) throw new Error('credential rollback mismatch');
        }
      } catch {
        throw new Error(
          'the operating system secret store rejected the issuer credential and the previous state could not be restored; credential state is uncertain',
        );
      }
      throw new Error(previous === null
        ? (this.#platform === 'linux'
          ? 'the issuer credential did not reach durable Secret Service; volatile keyutils fallback was rejected, no plaintext copy was written, and no credential remains'
          : 'the operating system secret store did not verify the issuer credential publication; no plaintext copy was written and no credential remains')
        : 'the operating system secret store did not verify the issuer credential publication; the previous credential was restored');
    }
  }

  get(issuerInput: string): IssuerCredentialRecord | null {
    const issuer = normalizeIssuer(issuerInput);
    const index = this.#platform === 'darwin' ? this.#macosIndex() : null;
    const serialized = this.#serialized(accountFor(issuer));
    if (index) this.#assertMacosMembership(issuer, serialized, index.issuers);
    return serialized === null ? null : parseRecord(serialized, issuer);
  }

  delete(issuerInput: string): boolean {
    const issuer = normalizeIssuer(issuerInput);
    const account = accountFor(issuer);
    const previousIndex = this.#platform === 'darwin' ? this.#macosIndex() : null;
    const previous = this.#serialized(account);
    if (previousIndex) this.#assertMacosMembership(issuer, previous, previousIndex.issuers);
    if (previous === null) return false;
    try {
      if (!this.#entry(account).deletePassword()) throw new Error('credential deletion was not acknowledged');
      if (this.#serialized(account) !== null) {
        throw new Error('credential deletion mismatch');
      }
      if (previousIndex) {
        this.#publishMacosIndex(previousIndex.issuers.filter((candidate) => candidate !== issuer));
      }
    } catch {
      if (previousIndex) {
        try {
          this.#restoreMacosState(account, previous, previousIndex);
        } catch {
          throw new Error('the operating system secret store could not verify credential deletion and the previous state could not be restored; credential state is uncertain');
        }
        throw new Error('the operating system secret store could not verify credential deletion; the previous credential was restored');
      }
      throw new Error('the operating system secret store could not delete the issuer credential');
    }
    return true;
  }

  deleteAll(): number {
    if (this.#platform === 'darwin') {
      const index = this.#macosIndex();
      for (const issuer of index.issuers) {
        const account = accountFor(issuer);
        const serialized = this.#serialized(account);
        this.#assertMacosMembership(issuer, serialized, index.issuers);
        if (serialized === null) throw new Error('the macOS issuer credential index references a missing credential');
        parseRecord(serialized, issuer);
      }
      let removed = 0;
      for (const issuer of index.issuers) {
        try {
          if (!this.delete(issuer)) throw new Error('credential disappeared before verified deletion');
          removed += 1;
        } catch (error) {
          throw new Error(
            `issuer credential purge partially failed after removing ${removed} of ${index.issuers.length}; `
            + `${index.issuers.length - removed} credential(s) remain or require verification: `
            + (error instanceof Error ? error.message : String(error)),
          );
        }
      }
      return removed;
    }
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
    return this.#platform === 'darwin'
      ? (process.env.HAPPYHERD_KEYRING_PATH
        ? 'durable isolated macOS service Keychain ready'
        : 'macOS login Keychain ready')
      : this.#platform === 'win32'
        ? 'Windows Credential Manager ready'
        : 'durable Linux Secret Service ready; keyutils fallback disabled';
  }
}
