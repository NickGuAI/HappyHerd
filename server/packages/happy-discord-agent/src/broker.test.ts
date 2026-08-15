import { describe, expect, it, vi } from 'vitest';
import { PmaiSkillBroker } from './broker';
import { CapabilityRegistry } from './capabilities';
import { PMAI_SKILL_FAMILIES, type AuthorizationGrant, type SurfaceBinding } from './types';

const NOW = Date.now();

function grant(overrides: Partial<AuthorizationGrant> = {}): AuthorizationGrant {
  return {
    decision: 'allow',
    actor: { pmaiUserId: 'pmai-user-1', discordUserId: 'discord-user-1' },
    mode: 'personal',
    scopes: [
      'crm.contacts.read',
      'crm.contacts.create',
      'events.read',
      'community.channels.read',
    ],
    resources: {},
    delegation: { token: 'delegation-token', expiresAt: NOW + 60_000 },
    ...overrides,
  };
}

function binding(overrides: Partial<SurfaceBinding> = {}): SurfaceBinding {
  return {
    surfaceKey: 'dm:discord-user-1',
    surfaceKind: 'dm',
    channelId: 'dm-channel-1',
    guildId: null,
    threadId: null,
    pmaiUserId: 'pmai-user-1',
    capabilityId: 'capability-1',
    happySessionId: 'session-1',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('PmaiSkillBroker', () => {
  it('exposes operations for exactly the five approved skill families', () => {
    const broker = new PmaiSkillBroker({ capabilities: new CapabilityRegistry(), apiBaseUrl: 'https://pmai.example' });
    expect(PMAI_SKILL_FAMILIES).toEqual([
      'pmai-guide', 'pmai-crm', 'pmai-luma', 'pmai-discord', 'pmai-canva',
    ]);
    for (const family of PMAI_SKILL_FAMILIES) {
      expect(broker.operations(family).length).toBeGreaterThan(0);
    }
  });

  it('uses the server-held delegation for a scoped read', async () => {
    const capabilities = new CapabilityRegistry();
    capabilities.activate(binding(), grant());
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://pmai.example/api/v1/crm/contacts?page=2');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer delegation-token');
      return new Response(JSON.stringify({ contacts: [] }), { status: 200 });
    });
    const broker = new PmaiSkillBroker({ capabilities, apiBaseUrl: 'https://pmai.example', fetchImpl });

    await expect(broker.call('capability-1', {
      family: 'pmai-crm',
      operation: 'contacts_list',
      arguments: { query: { page: 2 } },
    })).resolves.toEqual({ ok: true, status: 200, body: { contacts: [] } });
  });

  it('binds writes to an exact, one-use same-capability confirmation', async () => {
    const capabilities = new CapabilityRegistry();
    capabilities.activate(binding(), grant());
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => (
      new Response(JSON.stringify({ id: 1 }), { status: 201 })
    ));
    const broker = new PmaiSkillBroker({ capabilities, apiBaseUrl: 'https://pmai.example', fetchImpl });
    const action = {
      family: 'pmai-crm' as const,
      operation: 'contacts_create',
      arguments: { body: { FIRSTNAME: 'Ada' } },
    };
    const pending = await broker.call('capability-1', action);
    expect(pending.status).toBe(409);
    const token = (pending.body as { confirmationToken: string }).confirmationToken;
    expect(fetchImpl).not.toHaveBeenCalled();

    const mismatch = await broker.call('capability-1', {
      ...action,
      arguments: { body: { FIRSTNAME: 'Grace' }, confirmationToken: token },
    });
    expect(mismatch).toMatchObject({ status: 409, body: { code: 'confirmation_invalid_or_expired' } });
    expect(fetchImpl).not.toHaveBeenCalled();

    const pendingAgain = await broker.call('capability-1', action);
    const validToken = (pendingAgain.body as { confirmationToken: string }).confirmationToken;
    const completed = await broker.call('capability-1', {
      ...action,
      arguments: { body: { FIRSTNAME: 'Ada' }, confirmationToken: validToken },
    });
    expect(completed).toMatchObject({ ok: true, status: 201 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const request = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(new Headers(request.headers).get('idempotency-key')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('blocks personal and write operations from shared sessions before fetch', async () => {
    const capabilities = new CapabilityRegistry();
    capabilities.activate(binding({
      surfaceKey: 'thread:guild-1:thread-1',
      surfaceKind: 'guild-thread',
      guildId: 'guild-1',
      threadId: 'thread-1',
      pmaiUserId: null,
    }), grant({ mode: 'shared-read-only' }));
    const fetchImpl = vi.fn();
    const broker = new PmaiSkillBroker({ capabilities, apiBaseUrl: 'https://pmai.example', fetchImpl });

    await expect(broker.call('capability-1', {
      family: 'pmai-crm',
      operation: 'contacts_list',
      arguments: {},
    })).resolves.toMatchObject({ status: 403, body: { code: 'personal_operation_requires_dm' } });
    await expect(broker.call('capability-1', {
      family: 'pmai-luma',
      operation: 'events_create',
      arguments: { body: {} },
    })).resolves.toMatchObject({ status: 403 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed for missing scopes and expired capabilities', async () => {
    const capabilities = new CapabilityRegistry();
    capabilities.activate(binding(), grant({ scopes: [] }));
    const broker = new PmaiSkillBroker({ capabilities, apiBaseUrl: 'https://pmai.example' });
    await expect(broker.call('capability-1', {
      family: 'pmai-crm',
      operation: 'contacts_list',
      arguments: {},
    })).resolves.toMatchObject({ status: 403, body: { code: 'missing_scope' } });
    expect(() => capabilities.resolve('capability-1', NOW + 120_000)).toThrow('Expired');
  });
});
