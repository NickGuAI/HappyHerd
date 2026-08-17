import { describe, expect, it } from 'vitest';
import {
  KeyringSecretStore,
  type IssuerCredentialRecord,
  type SecretEntry,
  type SecretEnumeration,
} from './secretStore';

class MemoryEntry implements SecretEntry {
  constructor(private readonly values: Map<string, string>, private readonly key: string) {}
  setPassword(value: string): void { this.values.set(this.key, value); }
  getPassword(): string | null { return this.values.get(this.key) ?? null; }
  deletePassword(): boolean { return this.values.delete(this.key); }
}

const record: IssuerCredentialRecord = {
  schemaVersion: 1,
  issuer: 'https://issuer.example',
  tokenType: 'Bearer',
  accessToken: 'token-value-that-is-long-enough',
  expiresAt: '2027-01-01T00:00:00Z',
  scopes: ['records.read'],
  connectedAt: '2026-08-17T00:00:00Z',
  skillBundle: {
    url: 'https://issuer.example/api/bundles/current',
    sha256: 'a'.repeat(64),
    manifestSha256: 'b'.repeat(64),
  },
};

function memoryEnumeration(values: Map<string, string>): SecretEnumeration {
  return (service) => [...values.entries()]
    .filter(([key]) => key.startsWith(`${service}:`))
    .map(([key, password]) => ({ account: key.slice(service.length + 1), password }));
}

function macosStore(
  values: Map<string, string>,
  factory: (service: string, account: string) => SecretEntry = (
    service,
    account,
  ) => new MemoryEntry(values, `${service}:${account}`),
): KeyringSecretStore {
  return new KeyringSecretStore(
    factory,
    () => { throw new Error('macOS global enumeration must not be used'); },
    'darwin',
  );
}

describe('OS secret-store boundary', () => {
  it('round-trips a credential without a file fallback', () => {
    const values = new Map<string, string>();
    const store = new KeyringSecretStore(
      (service, account) => new MemoryEntry(values, `${service}:${account}`),
      memoryEnumeration(values),
    );
    store.set(record);
    expect(store.get(record.issuer)).toEqual(record);
    expect(store.delete(record.issuer)).toBe(true);
    expect(store.get(record.issuer)).toBeNull();
  });

  it('fails closed when the OS backend rejects a write', () => {
    const store = new KeyringSecretStore(() => ({
      setPassword: () => { throw new Error('locked'); },
      getPassword: () => null,
      deletePassword: () => false,
    }), () => []);
    expect(() => store.set(record)).toThrow('no plaintext copy was written');
  });

  it('rejects credentials that cannot fit the native launcher environment boundary', () => {
    const store = new KeyringSecretStore(
      () => new MemoryEntry(new Map(), 'unused'),
      () => [],
    );
    expect(() => store.set({ ...record, accessToken: 't'.repeat(4097) })).toThrow('failed validation');
  });

  it('rejects a write that landed only in a fallback store', () => {
    const fallback = new Map<string, string>();
    const store = new KeyringSecretStore(
      (service, account) => new MemoryEntry(fallback, `${service}:${account}`),
      () => [],
    );
    expect(() => store.set(record)).toThrow(/did not reach durable Secret Service|did not verify/);
    expect(fallback.size).toBe(0);
  });

  it('restores the previous credential when overwrite publication cannot be verified', () => {
    const values = new Map<string, string>();
    let setCalls = 0;
    let failNextEnumeration = false;
    const store = new KeyringSecretStore(
      (service, account) => ({
        setPassword: (value) => {
          setCalls += 1;
          values.set(`${service}:${account}`, value);
          if (setCalls === 2) failNextEnumeration = true;
        },
        getPassword: () => values.get(`${service}:${account}`) ?? null,
        deletePassword: () => values.delete(`${service}:${account}`),
      }),
      (service) => {
        if (failNextEnumeration) { failNextEnumeration = false; return []; }
        return memoryEnumeration(values)(service);
      },
    );
    store.set(record);
    const replacement = { ...record, accessToken: 'replacement-token-that-is-long-enough' };
    expect(() => store.set(replacement)).toThrow('previous credential was restored');
    expect(store.get(record.issuer)).toEqual(record);
  });

  it('reports uncertain state without leaking either secret when overwrite rollback fails', () => {
    const values = new Map<string, string>();
    let setCalls = 0;
    let failNextEnumeration = false;
    const store = new KeyringSecretStore(
      (service, account) => ({
        setPassword: (value) => {
          setCalls += 1;
          if (setCalls === 3) throw new Error('injected restore failure');
          values.set(`${service}:${account}`, value);
          if (setCalls === 2) failNextEnumeration = true;
        },
        getPassword: () => values.get(`${service}:${account}`) ?? null,
        deletePassword: () => values.delete(`${service}:${account}`),
      }),
      (service) => {
        if (failNextEnumeration) { failNextEnumeration = false; return []; }
        return memoryEnumeration(values)(service);
      },
    );
    store.set(record);
    const replacementToken = 'replacement-token-that-is-long-enough';
    let message = '';
    try { store.set({ ...record, accessToken: replacementToken }); } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('credential state is uncertain');
    expect(message).not.toContain(record.accessToken);
    expect(message).not.toContain(replacementToken);
  });

  it('enumerates and deletes every verified issuer credential for uninstall', () => {
    const values = new Map<string, string>();
    const factory = (service: string, account: string) => new MemoryEntry(values, `${service}:${account}`);
    const store = new KeyringSecretStore(factory, memoryEnumeration(values));
    store.set(record);
    store.set({
      ...record,
      issuer: 'https://second.example',
      skillBundle: { ...record.skillBundle!, url: 'https://second.example/api/bundles/current' },
    });
    expect(store.deleteAll()).toBe(2);
    expect(values.size).toBe(0);
  });

  it('uses keyed macOS Keychain operations and a protected issuer index', () => {
    const values = new Map<string, string>();
    const store = macosStore(values);
    const second = {
      ...record,
      issuer: 'https://second.example',
      skillBundle: { ...record.skillBundle!, url: 'https://second.example/api/bundles/current' },
    };
    store.set(record);
    store.set(second);
    expect(store.get(record.issuer)).toEqual(record);
    expect(store.get(second.issuer)).toEqual(second);
    expect(store.diagnostic()).toMatch(/macOS .*Keychain ready/);
    expect(store.deleteAll()).toBe(2);
    expect(values.size).toBe(1);
    expect([...values.values()]).toEqual(['{"schemaVersion":1,"issuers":[]}']);
  });

  it('rolls a macOS credential back when its protected index cannot be published', () => {
    const values = new Map<string, string>();
    let indexWrites = 0;
    const store = macosStore(values, (service, account) => ({
      setPassword: (value) => {
        if (account === 'issuer-index:v1' && ++indexWrites === 2) throw new Error('injected index failure');
        values.set(`${service}:${account}`, value);
      },
      getPassword: () => values.get(`${service}:${account}`) ?? null,
      deletePassword: () => values.delete(`${service}:${account}`),
    }));
    expect(() => store.set(record)).toThrow('no plaintext copy was written');
    expect(values.size).toBe(1);
    expect([...values.values()]).toEqual(['{"schemaVersion":1,"issuers":[]}']);
  });

  it('reports uncertain macOS state when credential rollback is not acknowledged', () => {
    const values = new Map<string, string>();
    let indexWrites = 0;
    const store = macosStore(values, (service, account) => ({
      setPassword: (value) => {
        if (account === 'issuer-index:v1' && ++indexWrites === 2) throw new Error('injected index failure');
        values.set(`${service}:${account}`, value);
      },
      getPassword: () => values.get(`${service}:${account}`) ?? null,
      deletePassword: () => false,
    }));
    let message = '';
    try { store.set(record); } catch (error) { message = error instanceof Error ? error.message : String(error); }
    expect(message).toContain('credential state is uncertain');
    expect(message).not.toContain(record.accessToken);
  });

  it('does not report a missing and unwritable macOS index as ready', () => {
    const store = macosStore(new Map(), () => ({
      setPassword: () => { throw new Error('locked'); },
      getPassword: () => null,
      deletePassword: () => false,
    }));
    expect(() => store.diagnostic()).toThrow('could not be initialized');
  });

  it('fails closed when a macOS issuer index and credential disagree', () => {
    const values = new Map<string, string>();
    const store = macosStore(values);
    store.set(record);
    const indexKey = [...values.keys()].find((key) => key.endsWith(':issuer-index:v1'));
    expect(indexKey).toBeDefined();
    values.delete(indexKey!);
    expect(() => store.get(record.issuer)).toThrow('inconsistent');
  });

  it('restores every macOS credential when an indexed purge fails', () => {
    const values = new Map<string, string>();
    const setup = macosStore(values);
    setup.set(record);
    setup.set({
      ...record,
      issuer: 'https://second.example',
      skillBundle: { ...record.skillBundle!, url: 'https://second.example/api/bundles/current' },
    });
    let credentialDeletes = 0;
    const store = macosStore(values, (service, account) => ({
      setPassword: (value) => { values.set(`${service}:${account}`, value); },
      getPassword: () => values.get(`${service}:${account}`) ?? null,
      deletePassword: () => {
        if (account.startsWith('issuer:')) {
          credentialDeletes += 1;
          if (credentialDeletes === 2) throw new Error('injected purge failure');
        }
        return values.delete(`${service}:${account}`);
      },
    }));
    expect(() => store.deleteAll()).toThrow('partially failed after removing 1 of 2');
    expect(store.get(record.issuer)).toBeNull();
    expect(store.get('https://second.example')?.issuer).toBe('https://second.example');
  });

  it('does not accept an unacknowledged macOS credential deletion', () => {
    const values = new Map<string, string>();
    const setup = macosStore(values);
    setup.set(record);
    const store = macosStore(values, (service, account) => ({
      setPassword: (value) => { values.set(`${service}:${account}`, value); },
      getPassword: () => values.get(`${service}:${account}`) ?? null,
      deletePassword: () => false,
    }));
    expect(() => store.delete(record.issuer)).toThrow('previous credential was restored');
    expect(store.get(record.issuer)).toEqual(record);
  });

  it('restores a macOS credential when its index removal cannot be published', () => {
    const values = new Map<string, string>();
    const setup = macosStore(values);
    setup.set(record);
    let indexWrites = 0;
    const store = macosStore(values, (service, account) => ({
      setPassword: (value) => {
        if (account === 'issuer-index:v1' && ++indexWrites === 1) throw new Error('injected index update failure');
        values.set(`${service}:${account}`, value);
      },
      getPassword: () => values.get(`${service}:${account}`) ?? null,
      deletePassword: () => values.delete(`${service}:${account}`),
    }));
    expect(() => store.delete(record.issuer)).toThrow('previous credential was restored');
    expect(store.get(record.issuer)).toEqual(record);
  });

  it('rejects malformed, duplicate, and oversized macOS issuer indexes', () => {
    const values = new Map<string, string>();
    const store = macosStore(values);
    store.diagnostic();
    const indexKey = [...values.keys()].find((key) => key.endsWith(':issuer-index:v1'))!;
    values.set(indexKey, '{"schemaVersion":1,"issuers":["https://issuer.example","https://issuer.example"]}');
    expect(() => store.diagnostic()).toThrow('failed validation');
    values.set(indexKey, JSON.stringify({
      schemaVersion: 1,
      issuers: Array.from({ length: 257 }, (_, index) => `https://issuer-${index}.example`),
    }));
    expect(() => store.diagnostic()).toThrow('failed validation');
  });

  it('rejects a macOS index that references a missing credential', () => {
    const values = new Map<string, string>();
    const store = macosStore(values);
    store.set(record);
    const credentialKey = [...values.keys()].find((key) => key.includes(':issuer:'))!;
    values.delete(credentialKey);
    expect(() => store.get(record.issuer)).toThrow('inconsistent');
  });

  it('reports verified partial progress when a bulk credential purge fails', () => {
    const values = new Map<string, string>();
    let deleteCalls = 0;
    const store = new KeyringSecretStore(
      (service, account) => ({
        setPassword: (value) => { values.set(`${service}:${account}`, value); },
        getPassword: () => values.get(`${service}:${account}`) ?? null,
        deletePassword: () => {
          deleteCalls += 1;
          if (deleteCalls === 2) throw new Error('injected backend failure');
          return values.delete(`${service}:${account}`);
        },
      }),
      memoryEnumeration(values),
    );
    store.set(record);
    store.set({
      ...record,
      issuer: 'https://second.example',
      skillBundle: { ...record.skillBundle!, url: 'https://second.example/api/bundles/current' },
    });
    expect(() => store.deleteAll()).toThrow('partially failed after removing 1 of 2');
    expect(values.size).toBe(1);
  });
});
