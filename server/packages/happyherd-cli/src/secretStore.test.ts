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
