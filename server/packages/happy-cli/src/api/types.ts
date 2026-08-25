import { z } from 'zod'
import {
  HappyHerdHeartbeatMessageMarkerSchema,
  type AgentMessageQueueState,
  type HappyHerdAutomationProviderOutcome,
  type HappyHerdHeartbeatDeliveryReceipt,
  type Update,
  type UpdateMachineBody,
} from '@slopus/happy-wire';
import { UsageSchema } from '@/claude/types'
import type { SandboxConfig } from '@/persistence'

export {
  SessionMessageContentSchema,
  SessionMessageSchema,
  UpdateBodySchema,
  UpdateMachineBodySchema,
  UpdateSchema,
  UpdateSessionBodySchema,
} from '@slopus/happy-wire';
export type {
  SessionMessage,
  SessionMessageContent,
  Update,
  UpdateBody,
  UpdateMachineBody,
  UpdateSessionBody,
} from '@slopus/happy-wire';

/**
 * Permission mode type - includes both Claude and Codex modes
 * Must match MessageMetaSchema.permissionMode enum values
 *
 * Shared: auto — the harness reviews each call itself
 * Claude modes: default, acceptEdits, bypassPermissions, plan
 * Codex modes: read-only, safe-yolo, yolo
 *
 * `auto` is the one mode both harnesses implement natively: Claude ships it
 * in the Agent SDK's own PermissionMode union, and Codex spells it as the
 * `on-request` approval policy inside the workspace sandbox.
 *
 * When calling Claude SDK, Codex modes are mapped at the SDK boundary:
 * - yolo → bypassPermissions
 * - safe-yolo → default
 * - read-only → default
 */
export type PermissionMode = 'auto' | 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'read-only' | 'safe-yolo' | 'yolo'

/**
 * Usage data type from Claude
 */
export type Usage = z.infer<typeof UsageSchema>

/**
 * Socket events from server to client
 */
export interface ServerToClientEvents {
  update: (data: Update) => void
  'rpc-request': (data: { method: string, params: string }, callback: (response: string) => void) => void
  'rpc-registered': (data: { method: string }) => void
  'rpc-unregistered': (data: { method: string }) => void
  'rpc-error': (data: { type: string, error: string }) => void
  ephemeral: (data: { type: 'activity', id: string, active: boolean, activeAt: number, thinking: boolean }) => void
  auth: (data: { success: boolean, user: string }) => void
  error: (data: { message: string }) => void
}


/**
 * Socket events from client to server
 */
export interface ClientToServerEvents {
  message: (data: { sid: string, message: any }) => void
  'session-alive': (data: {
    sid: string;
    time: number;
    thinking: boolean;
    mode?: 'local' | 'remote';
  }) => void
  'session-end': (data: { sid: string, time: number }) => void,
  'update-metadata': (data: { sid: string, expectedVersion: number, metadata: string }, cb: (answer: {
    result: 'error'
  } | {
    result: 'version-mismatch'
    version: number,
    metadata: string
  } | {
    result: 'success',
    version: number,
    metadata: string
  }) => void) => void,
  'update-state': (data: { sid: string, expectedVersion: number, agentState: string | null }, cb: (answer: {
    result: 'error'
  } | {
    result: 'version-mismatch'
    version: number,
    agentState: string | null
  } | {
    result: 'success',
    version: number,
    agentState: string | null
  }) => void) => void,
  'ping': (callback: () => void) => void
  'rpc-register': (data: { method: string }) => void
  'rpc-unregister': (data: { method: string }) => void
  'rpc-call': (data: { method: string, params: string }, callback: (response: {
    ok: boolean
    result?: string
    error?: string
  }) => void) => void
  'usage-report': (data: {
    key: string
    sessionId: string
    tokens: {
      total: number
      [key: string]: number
    }
    cost: {
      total: number
      [key: string]: number
    }
  }) => void
}

/**
 * Session information
 */
export type Session = {
  id: string,
  seq: number,
  encryptionKey: Uint8Array;
  encryptionVariant: 'legacy' | 'dataKey';
  metadata: Metadata,
  metadataVersion: number,
  agentState: AgentState | null,
  agentStateVersion: number,
}

export const AgentCapabilityOptionSchema = z.object({
  code: z.string(),
  value: z.string(),
  description: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
})

export const AgentModelCapabilitySchema = AgentCapabilityOptionSchema.extend({
  effortLevels: z.array(AgentCapabilityOptionSchema).optional(),
  isDefault: z.boolean().optional(),
})

export const AgentCapabilityCatalogSchema = z.object({
  detectedAt: z.number(),
  providerVersion: z.string().optional(),
  sources: z.object({
    models: z.string(),
    effortLevels: z.string(),
    permissionModes: z.string(),
  }),
  models: z.array(AgentModelCapabilitySchema),
  effortLevels: z.array(AgentCapabilityOptionSchema),
  permissionModes: z.array(AgentCapabilityOptionSchema),
  acp: z.object({
    loadSession: z.boolean(),
    prompt: z.object({
      image: z.boolean(),
    }),
  }).optional(),
})

export type AgentCapabilityCatalog = z.infer<typeof AgentCapabilityCatalogSchema>

/**
 * Machine metadata - static information (rarely changes)
 */
export const MachineMetadataSchema = z.object({
  host: z.string(),
  platform: z.string(),
  happyCliVersion: z.string(),
  homeDir: z.string(),
  happyHomeDir: z.string(),
  happyLibDir: z.string(),
  cliAvailability: z.object({
    claude: z.boolean(),
    codex: z.boolean(),
    gemini: z.boolean(),
    grok: z.boolean().optional(),
    openclaw: z.boolean(),
    // Optional so metadata written by a CLI predating agy detection still
    // matches this shape. detectCLIAvailability always reports it.
    agy: z.boolean().optional(),
    detectedAt: z.number(),
  }).optional(),
  resumeSupport: z.object({
    rpcAvailable: z.boolean(),
    requiresSameMachine: z.boolean(),
    requiresHappyAgentAuth: z.boolean(),
    happyAgentAuthenticated: z.boolean(),
    detectedAt: z.number(),
  }).optional(),
  agentCapabilities: z.record(z.string(), AgentCapabilityCatalogSchema).optional(),
  grokCapabilityError: z.string().optional(),
})

export type MachineMetadata = z.infer<typeof MachineMetadataSchema>

/**
 * Daemon state - dynamic runtime information (frequently updated)
 */
export const DaemonStateSchema = z.object({
  status: z.union([
    z.enum(['running', 'shutting-down']),
    z.string() // Forward compatibility
  ]),
  pid: z.number().optional(),
  httpPort: z.number().optional(),
  startedAt: z.number().optional(),
  shutdownRequestedAt: z.number().optional(),
  shutdownSource:
    z.union([
      z.enum(['mobile-app', 'cli', 'os-signal', 'unknown']),
      z.string() // Forward compatibility
    ]).optional()
})

export type DaemonState = z.infer<typeof DaemonStateSchema>

export type Machine = {
  id: string,
  encryptionKey: Uint8Array;
  encryptionVariant: 'legacy' | 'dataKey';
  metadata: MachineMetadata,
  metadataVersion: number,
  daemonState: DaemonState | null,
  daemonStateVersion: number,
}

/**
 * Message metadata schema
 */
export const MessageMetaSchema = z.object({
  sentFrom: z.string().optional(), // Source identifier
  permissionMode: z.enum(['auto', 'default', 'acceptEdits', 'bypassPermissions', 'plan', 'read-only', 'safe-yolo', 'yolo']).optional(), // Permission mode for this message
  model: z.string().nullable().optional(), // Model name for this message (null = reset)
  fallbackModel: z.string().nullable().optional(), // Fallback model for this message (null = reset)
  customSystemPrompt: z.string().nullable().optional(), // Custom system prompt for this message (null = reset)
  appendSystemPrompt: z.string().nullable().optional(), // Append to system prompt for this message (null = reset)
  allowedTools: z.array(z.string()).nullable().optional(), // Allowed tools for this message (null = reset)
  disallowedTools: z.array(z.string()).nullable().optional(), // Disallowed tools for this message (null = reset)
  effort: z.string().nullable().optional(), // Provider-advertised effort for this message; the selected daemon/model catalog is authoritative.
  displayText: z.string().optional(), // Compact user-visible text when the encrypted provider prompt is longer.
  deliveryMode: z.enum(['queue']).optional(), // Explicitly bypass active-turn steering and use the provider queue
  queueMessageId: z.string().trim().min(1).optional(), // Parent local ID for queued attachment records
  heartbeat: HappyHerdHeartbeatMessageMarkerSchema.optional(), // Typed session-heartbeat routing; prompt text is never inspected.
})

export type MessageMeta = z.infer<typeof MessageMetaSchema>

/**
 * API response types
 */
export const CreateSessionResponseSchema = z.object({
  session: z.object({
    id: z.string(),
    tag: z.string(),
    seq: z.number(),
    createdAt: z.number(),
    updatedAt: z.number(),
    metadata: z.string(),
    metadataVersion: z.number(),
    agentState: z.string().nullable(),
    agentStateVersion: z.number()
  })
})

export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>

export const UserMessageSchema = z.object({
  role: z.literal('user'),
  content: z.object({
    type: z.literal('text'),
    text: z.string()
  }),
  localKey: z.string().optional(), // Mobile messages include this
  meta: MessageMetaSchema.optional()
})

export type UserMessage = z.infer<typeof UserMessageSchema>

/**
 * File event message — sent by the app as a session envelope before the text message.
 * Contains a ref pointing to the encrypted blob on the server.
 */
export const FileEventMessageSchema = z.object({
  role: z.literal('session'),
  content: z.object({
    type: z.literal('session'),
    data: z.object({
      id: z.string(),
      time: z.number(),
      role: z.literal('user'),
      ev: z.object({
        t: z.literal('file'),
        ref: z.string(),
        name: z.string(),
        size: z.number(),
        mimeType: z.string().optional(),
        image: z.object({
          width: z.number(),
          height: z.number(),
          // Optional — native iOS picker has no Canvas to compute thumbhash.
          // App-side schema relaxed this in the same commit; keeping CLI in
          // sync so the file event isn't silently rejected by Zod and the
          // attachment never reaches Claude.
          thumbhash: z.string().optional(),
        }).optional(),
      }),
    }),
  }),
  meta: MessageMetaSchema.optional(),
})

export type FileEventMessage = z.infer<typeof FileEventMessageSchema>

export const AgentMessageSchema = z.object({
  role: z.literal('agent'),
  content: z.object({
    type: z.literal('output'),
    data: z.any()
  }),
  meta: MessageMetaSchema.optional()
})

export type AgentMessage = z.infer<typeof AgentMessageSchema>

export const MessageContentSchema = z.union([UserMessageSchema, AgentMessageSchema])

export type MessageContent = z.infer<typeof MessageContentSchema>

export type Metadata = {
  /**
   * ACP session config option value (normalized for UI metadata consumers).
   */
  // `code` = protocol value ID, `value` = human label
  models?: Array<{
    code: string;
    value: string;
    description?: string | null;
    thinkingLevels?: string[];
    defaultThinkingLevel?: string;
  }>,
  currentModelCode?: string,
  operatingModes?: Array<{ code: string; value: string; description?: string | null }>,
  currentOperatingModeCode?: string,
  thoughtLevels?: Array<{ code: string; value: string; description?: string | null }>,
  currentThoughtLevelCode?: string,
  path: string,
  host: string,
  version?: string,
  name?: string,
  os?: string,
  summary?: {
    text: string,
    updatedAt: number
  },
  machineId?: string,
  gitBranch?: string,
  claudeSessionId?: string, // Claude Code session ID
  codexThreadId?: string, // Codex app-server thread ID
  acpSessionId?: string, // Generic ACP provider session ID (for session/load resume)
  acpCapabilities?: {
    loadSession: boolean,
    prompt: { image: boolean },
  },
  codexHome?: string, // CODEX_HOME used to create codexThreadId
  tools?: string[],
  slashCommands?: string[],
  mcpServers?: Array<{ name: string; status: string }>,
  skills?: string[],
  homeDir: string,
  happyHomeDir: string,
  happyLibDir: string,
  happyToolsDir: string,
  startedFromDaemon?: boolean,
  hostPid?: number,
  startedBy?: 'daemon' | 'terminal',
  // Lifecycle state management
  lifecycleState?: 'running' | 'archiveRequested' | 'archived' | string,
  lifecycleStateSince?: number,
  archivedBy?: string,
  archiveReason?: string,
  flavor?: string
  sandbox?: SandboxConfig | null
  dangerouslySkipPermissions?: boolean | null
  /** Lineage for sessions created via the fork / duplicate flow. */
  parentSessionId?: string
  forkedFromMessageId?: string
  /**
   * Marks a session as a hidden "side chat" forked from `parentSessionId`.
   * Side chats never appear in the top-level session list; they render only
   * inside the parent session's sidebar panel.
   */
  isSideChat?: boolean
  /** HappyHerd Commander/AgentContext provenance for this session. */
  commanderId?: string
  commanderName?: string
  commanderPath?: string
  commanderWorkspace?: string
  commanderAgentContextPath?: string
  globalAgentsPath?: string
  globalAgentContextPath?: string
  projectGuidancePath?: string
  contextHash?: string
  instructionReceiptVersion?: number
  instructionProvider?: 'codex' | 'claude'
  instructionLayer?: 'developer' | 'system-append'
  instructionHash?: string
  /** Opaque governed Discord surface binding used to reconcile daemon spawns. */
  happyHerdAgentSurfaceId?: string
  /** Machine-local automation provenance for daemon-started sessions. */
  automationId?: string
  automationRunId?: string
  automationKind?: 'scheduled' | 'heartbeat' | 'memory-maintenance'
  /** Provider-written only after the one-shot root and child work is terminal. */
  automationProviderOutcome?: HappyHerdAutomationProviderOutcome
};

export type UsageLimitWindowStatus = 'allowed' | 'allowed_warning' | 'rejected'

export type UsageLimitWindow = {
  /** Stable machine key, e.g. 'five_hour' / 'seven_day'. */
  id: string,
  label?: string,
  status?: UsageLimitWindowStatus,
  /** Percent of the window used, 0-100. */
  utilization?: number | null,
  /** Epoch milliseconds when the window resets. */
  resetsAt?: number | null,
}

export type UsageLimits = {
  capturedAt: number,
  windows: UsageLimitWindow[],
}

export type AgentGoalStatus = {
  source: 'claude' | 'codex',
  observedAt: number,
  sourceSessionId?: string,
  sourceRevision?: string | number,
} & (
  | {
      status: 'unavailable',
      reason?: 'unsupported' | 'not_loaded' | 'stale' | 'malformed' | 'error' | 'unknown',
    }
  | {
      status: 'inactive',
      reason?: 'none' | 'cleared' | 'completed' | 'unknown',
    }
  | {
      status: 'active',
      sourceSessionId: string,
      text: string,
      capabilities?: {
        clear?: boolean,
        stop?: boolean,
        edit?: boolean,
      },
      progress?: {
        currentStep?: number,
        totalSteps?: number,
        steps?: Array<{
          text: string,
          status: 'pending' | 'in_progress' | 'completed',
        }>,
      },
    }
);

export type AgentState = {
  controlledByUser?: boolean | null | undefined
  /**
   * Ephemeral plan rate-limit windows reported by the agent backend.
   * Apps must tolerate window ids they don't recognize.
   */
  usageLimits?: UsageLimits
  /** Ordered IDs for the runtime-owned explicit user-message queue. */
  messageQueue?: AgentMessageQueueState
  /** Latest provider-owned lifecycle receipt for this session's heartbeat turn. */
  heartbeatDelivery?: HappyHerdHeartbeatDeliveryReceipt
  requests?: {
    [id: string]: {
      tool: string,
      arguments: any,
      createdAt: number,
      // Raw provider tool-use id when the request id is scoped (e.g. claude
      // subagent ids are `agentID:toolUseID`); the app joins the permission
      // card to its tool call through this.
      toolUseId?: string
    }
  }
  completedRequests?: {
    [id: string]: {
      tool: string,
      arguments: any,
      createdAt: number,
      completedAt: number,
      status: 'canceled' | 'denied' | 'approved',
      reason?: string,
      mode?: PermissionMode,
      decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort',
      allowTools?: string[],
      toolUseId?: string
    }
  }
  agentGoalStatus?: AgentGoalStatus
}
