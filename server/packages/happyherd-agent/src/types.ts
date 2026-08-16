export type SurfaceKind = 'dm' | 'guild-thread' | 'guild-channel';
export type CapabilityMode = 'personal' | 'shared-read-only';

export type ToolOperationSpec = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  scope: string | null;
  write: boolean;
  shared: boolean;
};

export type GovernedToolDefinition = {
  name: string;
  family: string;
  description: string;
  operations: Record<string, ToolOperationSpec>;
};

export type HappyHerdAgentManifest = {
  schemaVersion: 1;
  id: string;
  displayName: string;
  tools: GovernedToolDefinition[];
};

export type NormalizedDiscordMessage = {
  sourceMessageId: string;
  authorDiscordId: string;
  channelId: string;
  parentChannelId: string | null;
  guildId: string | null;
  threadId: string | null;
  surfaceKind: SurfaceKind;
  surfaceKey: string;
  content: string;
  mentionsApplication: boolean;
  authorIsBot: boolean;
  createdAt: number;
};

export type AuthorizationSource = {
  messageId: string;
  discordUserId: string;
  guildId: string | null;
  channelId: string;
  parentChannelId: string | null;
  threadId: string | null;
  surfaceKind: SurfaceKind;
};

export type AuthorizationGrant = {
  decision: 'allow';
  actor: {
    subjectId: string;
    discordUserId: string;
  };
  mode: CapabilityMode;
  scopes: string[];
  resources: Record<string, unknown>;
  delegation: {
    token: string;
    expiresAt: number;
  };
};

export type AuthorizationDenial = {
  decision: 'deny';
  code: string;
  safeMessage?: string;
};

export type AuthorizationDecision = AuthorizationGrant | AuthorizationDenial;

export type LinkSuccess = {
  decision: 'linked';
  safeMessage: string;
};

export type LinkDecision = LinkSuccess | AuthorizationDenial;

export type SurfaceBinding = {
  surfaceKey: string;
  surfaceKind: SurfaceKind;
  channelId: string;
  guildId: string | null;
  threadId: string | null;
  subjectId: string | null;
  capabilityId: string;
  happySessionId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type InboundStatus =
  | 'claimed'
  | 'denied'
  | 'turn-pending'
  | 'answer-ready'
  | 'delivering'
  | 'delivered'
  | 'failed';

export type DeliveryKind = 'answer' | 'denial' | 'failure' | 'link';

export type InboundRecord = {
  sourceMessageId: string;
  surfaceKey: string;
  channelId: string;
  authorDiscordId: string;
  status: InboundStatus;
  happySessionId: string | null;
  happyLocalId: string;
  baselineSequence: number | null;
  turnId: string | null;
  answerHash: string | null;
  deliveryKind: DeliveryKind | null;
  replyMessageIds: string[];
  failureReference: string | null;
  createdAt: number;
  updatedAt: number;
};

export type BridgeState = {
  schemaVersion: 1;
  surfaces: Record<string, SurfaceBinding>;
  inbound: Record<string, InboundRecord>;
};

export type SkillCallRequest = {
  family: string;
  operation: string;
  arguments: Record<string, unknown>;
};

export type SkillCallResult = {
  ok: boolean;
  status: number;
  body: unknown;
};
