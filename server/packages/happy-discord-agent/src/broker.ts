import { createHash, randomBytes } from 'node:crypto';
import type { CapabilityRegistry } from './capabilities';
import type { PmaiSkillFamily, SkillCallRequest, SkillCallResult } from './types';

type OperationSpec = {
  method: 'GET' | 'POST' | 'PATCH';
  path: (args: Record<string, unknown>) => string;
  scope: string | null;
  write: boolean;
  shared: boolean;
};

type PendingConfirmation = {
  capabilityId: string;
  actionHash: string;
  expiresAt: number;
};

const stringArgument = (args: Record<string, unknown>, key: string): string => {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new Error(`${key} is required`);
  }
  return encodeURIComponent(value);
};

const OPERATIONS: Record<PmaiSkillFamily, Record<string, OperationSpec>> = {
  'pmai-guide': {
    me: { method: 'GET', path: () => '/api/v1/me', scope: null, write: false, shared: false },
    capabilities: { method: 'GET', path: () => '/api/v1/capabilities', scope: null, write: false, shared: true },
    onboarding_status: { method: 'GET', path: () => '/api/v1/community/onboarding', scope: null, write: false, shared: false },
  },
  'pmai-crm': {
    contacts_list: { method: 'GET', path: () => '/api/v1/crm/contacts', scope: 'crm.contacts.read', write: false, shared: false },
    contacts_get: { method: 'GET', path: (args) => `/api/v1/crm/contacts/${stringArgument(args, 'contactId')}`, scope: 'crm.contacts.read', write: false, shared: false },
    contacts_create: { method: 'POST', path: () => '/api/v1/crm/contacts', scope: 'crm.contacts.create', write: true, shared: false },
    contacts_update: { method: 'PATCH', path: (args) => `/api/v1/crm/contacts/${stringArgument(args, 'contactId')}`, scope: 'crm.contacts.update', write: true, shared: false },
    engagements_list: { method: 'GET', path: () => '/api/v1/crm/engagements', scope: 'crm.engagements.read', write: false, shared: false },
    engagements_get: { method: 'GET', path: (args) => `/api/v1/crm/engagements/${stringArgument(args, 'engagementId')}`, scope: 'crm.engagements.read', write: false, shared: false },
    engagements_create: { method: 'POST', path: () => '/api/v1/crm/engagements', scope: 'crm.engagements.create', write: true, shared: false },
    engagements_update: { method: 'PATCH', path: (args) => `/api/v1/crm/engagements/${stringArgument(args, 'engagementId')}`, scope: 'crm.engagements.update', write: true, shared: false },
  },
  'pmai-luma': {
    events_list: { method: 'GET', path: () => '/api/v1/events', scope: 'events.read', write: false, shared: true },
    events_create: { method: 'POST', path: () => '/api/v1/events', scope: 'events.create', write: true, shared: false },
    events_update: { method: 'PATCH', path: (args) => `/api/v1/events/${stringArgument(args, 'eventId')}`, scope: 'events.update', write: true, shared: false },
    guests_list: { method: 'GET', path: (args) => `/api/v1/events/${stringArgument(args, 'eventId')}/guests`, scope: 'events.guests.read', write: false, shared: false },
  },
  'pmai-discord': {
    channels_list: { method: 'GET', path: () => '/api/v1/community/channels', scope: 'community.channels.read', write: false, shared: true },
    messages_list: { method: 'GET', path: (args) => `/api/v1/community/channels/${stringArgument(args, 'channelId')}/messages`, scope: 'community.messages.read', write: false, shared: true },
    messages_send: { method: 'POST', path: (args) => `/api/v1/community/channels/${stringArgument(args, 'channelId')}/messages`, scope: 'community.messages.send', write: true, shared: false },
    reactions_add: { method: 'POST', path: (args) => `/api/v1/community/messages/${stringArgument(args, 'messageId')}/reactions`, scope: 'community.reactions.write', write: true, shared: false },
  },
  'pmai-canva': {
    connector_status: { method: 'GET', path: () => '/api/v1/connectors/canva', scope: 'canva.designs.read', write: false, shared: false },
    designs_create: { method: 'POST', path: () => '/api/v1/connectors/canva/designs', scope: 'canva.designs.create', write: true, shared: false },
    designs_export: { method: 'POST', path: (args) => `/api/v1/connectors/canva/designs/${stringArgument(args, 'designId')}/exports`, scope: 'canva.designs.export', write: true, shared: false },
  },
};

function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
  }
  throw new Error('Tool arguments must be JSON values');
}

function requestBody(args: Record<string, unknown>): Record<string, unknown> {
  const body = args.body;
  if (body === undefined) {
    return {};
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('body must be an object');
  }
  return body as Record<string, unknown>;
}

function appendQuery(url: URL, args: Record<string, unknown>): void {
  const query = args.query;
  if (query === undefined) {
    return;
  }
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    throw new Error('query must be an object');
  }
  const entries = Object.entries(query as Record<string, unknown>);
  if (entries.length > 20) {
    throw new Error('query has too many fields');
  }
  for (const [key, value] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
      throw new Error(`Invalid query key ${key}`);
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      url.searchParams.set(key, String(value));
    } else {
      throw new Error(`Query value ${key} must be a scalar`);
    }
  }
}

export class PmaiSkillBroker {
  private readonly capabilities: CapabilityRegistry;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly confirmations = new Map<string, PendingConfirmation>();

  constructor(options: {
    capabilities: CapabilityRegistry;
    apiBaseUrl: string;
    fetchImpl?: typeof fetch;
  }) {
    this.capabilities = options.capabilities;
    this.apiBaseUrl = options.apiBaseUrl;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  operations(family: PmaiSkillFamily): string[] {
    return Object.keys(OPERATIONS[family]);
  }

  private confirmationResult(capabilityId: string, actionHash: string): SkillCallResult {
    const token = randomBytes(24).toString('base64url');
    const expiresAt = Date.now() + 5 * 60_000;
    this.confirmations.set(token, { capabilityId, actionHash, expiresAt });
    return {
      ok: false,
      status: 409,
      body: {
        code: 'confirmation_required',
        confirmationToken: token,
        actionHash,
        expiresAt,
        instruction: 'Ask the same linked Discord user to confirm this exact action in DM.',
      },
    };
  }

  async call(capabilityId: string, request: SkillCallRequest): Promise<SkillCallResult> {
    const active = this.capabilities.resolve(capabilityId);
    const spec = OPERATIONS[request.family][request.operation];
    if (!spec) {
      return { ok: false, status: 404, body: { code: 'operation_not_allowed' } };
    }
    if (active.mode === 'shared-read-only' && !spec.shared) {
      return { ok: false, status: 403, body: { code: 'personal_operation_requires_dm' } };
    }
    if (active.mode === 'shared-read-only' && spec.write) {
      return { ok: false, status: 403, body: { code: 'shared_surface_is_read_only' } };
    }
    if (spec.scope && !active.grant.scopes.includes(spec.scope)) {
      return { ok: false, status: 403, body: { code: 'missing_scope', scope: spec.scope } };
    }

    const path = spec.path(request.arguments);
    const body = requestBody(request.arguments);
    const actionHash = createHash('sha256').update(canonicalize({
      capabilityId,
      family: request.family,
      operation: request.operation,
      path,
      body,
    })).digest('hex');

    if (spec.write) {
      const confirmationToken = request.arguments.confirmationToken;
      if (typeof confirmationToken !== 'string') {
        return this.confirmationResult(capabilityId, actionHash);
      }
      const pending = this.confirmations.get(confirmationToken);
      this.confirmations.delete(confirmationToken);
      if (
        !pending
        || pending.capabilityId !== capabilityId
        || pending.actionHash !== actionHash
        || pending.expiresAt <= Date.now()
      ) {
        return { ok: false, status: 409, body: { code: 'confirmation_invalid_or_expired' } };
      }
    }

    const url = new URL(path, `${this.apiBaseUrl}/`);
    if (spec.method === 'GET') {
      appendQuery(url, request.arguments);
    }
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: spec.method,
        headers: {
          authorization: `Bearer ${active.grant.delegation.token}`,
          accept: 'application/json',
          ...(spec.method !== 'GET' ? { 'content-type': 'application/json' } : {}),
          ...(spec.write ? {
            'idempotency-key': actionHash,
            'x-pmai-confirmed-action-sha256': actionHash,
          } : {}),
        },
        ...(spec.method !== 'GET' ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      return {
        ok: false,
        status: 503,
        body: {
          code: 'pmai_provider_unavailable',
          errorType: error instanceof Error ? error.name : typeof error,
        },
      };
    }

    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (contentLength > 1_048_576) {
      return { ok: false, status: 502, body: { code: 'pmai_response_too_large' } };
    }
    const text = await response.text();
    if (text.length > 1_048_576) {
      return { ok: false, status: 502, body: { code: 'pmai_response_too_large' } };
    }
    let responseBody: unknown = null;
    if (text) {
      try {
        responseBody = JSON.parse(text);
      } catch {
        responseBody = { message: text };
      }
    }
    return { ok: response.ok, status: response.status, body: responseBody };
  }
}
