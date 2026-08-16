import { createHash, randomBytes } from 'node:crypto';
import type { CapabilityRegistry } from './capabilities';
import type {
  GovernedToolDefinition,
  HappyHerdAgentManifest,
  SkillCallRequest,
  SkillCallResult,
  ToolOperationSpec,
} from './types';

type PendingConfirmation = {
  capabilityId: string;
  actionHash: string;
  subjectId: string;
  discordUserId: string;
  requestedBySourceMessageId: string;
  expiresAt: number;
};

const pathArgument = (args: Record<string, unknown>, key: string): string => {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new Error(`${key} is required`);
  }
  return encodeURIComponent(value);
};

function renderPath(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_match, key: string) => pathArgument(args, key));
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
  }
  throw new Error('Tool arguments must be JSON values');
}

function requestBody(args: Record<string, unknown>): Record<string, unknown> {
  const body = args.body;
  if (body === undefined) return {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('body must be an object');
  return body as Record<string, unknown>;
}

function appendQuery(url: URL, args: Record<string, unknown>): void {
  const query = args.query;
  if (query === undefined) return;
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw new Error('query must be an object');
  const entries = Object.entries(query as Record<string, unknown>);
  if (entries.length > 20) throw new Error('query has too many fields');
  for (const [key, value] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) throw new Error(`Invalid query key ${key}`);
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      url.searchParams.set(key, String(value));
    } else {
      throw new Error(`Query value ${key} must be a scalar`);
    }
  }
}

export class GovernedSkillBroker {
  private readonly capabilities: CapabilityRegistry;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly toolsByFamily: Map<string, GovernedToolDefinition>;
  private readonly confirmations = new Map<string, PendingConfirmation>();

  constructor(options: {
    capabilities: CapabilityRegistry;
    apiBaseUrl: string;
    manifest: HappyHerdAgentManifest;
    fetchImpl?: typeof fetch;
  }) {
    this.capabilities = options.capabilities;
    this.apiBaseUrl = options.apiBaseUrl;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.toolsByFamily = new Map(options.manifest.tools.map((tool) => [tool.family, tool]));
  }

  families(): string[] {
    return [...this.toolsByFamily.keys()];
  }

  operations(family: string): string[] {
    return Object.keys(this.toolsByFamily.get(family)?.operations ?? {});
  }

  private confirmationResult(
    capabilityId: string,
    actionHash: string,
    actor: { subjectId: string | null; discordUserId: string; sourceMessageId: string },
  ): SkillCallResult {
    if (!actor.subjectId) {
      return { ok: false, status: 403, body: { code: 'personal_operation_requires_dm' } };
    }
    const token = randomBytes(24).toString('base64url');
    const expiresAt = Date.now() + 5 * 60_000;
    this.confirmations.set(token, {
      capabilityId,
      actionHash,
      subjectId: actor.subjectId,
      discordUserId: actor.discordUserId,
      requestedBySourceMessageId: actor.sourceMessageId,
      expiresAt,
    });
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
    const tool = this.toolsByFamily.get(request.family);
    const spec: ToolOperationSpec | undefined = tool?.operations[request.operation];
    if (!spec) return { ok: false, status: 404, body: { code: 'operation_not_allowed' } };
    if (active.mode === 'shared-read-only' && !spec.shared) {
      return { ok: false, status: 403, body: { code: 'personal_operation_requires_dm' } };
    }
    if (active.mode === 'shared-read-only' && spec.write) {
      return { ok: false, status: 403, body: { code: 'shared_surface_is_read_only' } };
    }
    if (spec.scope && !active.grant.scopes.includes(spec.scope)) {
      return { ok: false, status: 403, body: { code: 'missing_scope', scope: spec.scope } };
    }

    const path = renderPath(spec.path, request.arguments);
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
        return this.confirmationResult(capabilityId, actionHash, active);
      }
      const pending = this.confirmations.get(confirmationToken);
      if (
        !pending
        || pending.capabilityId !== capabilityId
        || pending.actionHash !== actionHash
        || pending.subjectId !== active.subjectId
        || pending.discordUserId !== active.discordUserId
        || pending.expiresAt <= Date.now()
      ) {
        this.confirmations.delete(confirmationToken);
        return { ok: false, status: 409, body: { code: 'confirmation_invalid_or_expired' } };
      }
      if (pending.requestedBySourceMessageId === active.sourceMessageId) {
        return { ok: false, status: 409, body: { code: 'confirmation_requires_new_discord_turn' } };
      }
      this.confirmations.delete(confirmationToken);
    }

    const url = new URL(path, `${this.apiBaseUrl}/`);
    if (spec.method === 'GET') appendQuery(url, request.arguments);
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
            'x-happyherd-confirmed-action-sha256': actionHash,
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
          code: 'provider_unavailable',
          errorType: error instanceof Error ? error.name : typeof error,
        },
      };
    }

    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (contentLength > 1_048_576) return { ok: false, status: 502, body: { code: 'response_too_large' } };
    const text = await response.text();
    if (text.length > 1_048_576) return { ok: false, status: 502, body: { code: 'response_too_large' } };
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
