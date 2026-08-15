export const PMAI_SKILL_FAMILIES = [
  'pmai-guide',
  'pmai-crm',
  'pmai-luma',
  'pmai-discord',
  'pmai-canva',
] as const;

export type PmaiSkillFamily = (typeof PMAI_SKILL_FAMILIES)[number];
export type SurfaceKind = 'dm' | 'guild-thread' | 'guild-channel';
export type CapabilityMode = 'personal' | 'shared-read-only';

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
  threadId: string | null;
  surfaceKind: SurfaceKind;
};

export type AuthorizationGrant = {
  decision: 'allow';
  actor: {
    pmaiUserId: string;
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

export type SurfaceBinding = {
  surfaceKey: string;
  surfaceKind: SurfaceKind;
  channelId: string;
  guildId: string | null;
  threadId: string | null;
  pmaiUserId: string | null;
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

export type DeliveryKind = 'answer' | 'denial' | 'failure';

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
  family: PmaiSkillFamily;
  operation: string;
  arguments: Record<string, unknown>;
};

export type SkillCallResult = {
  ok: boolean;
  status: number;
  body: unknown;
};
