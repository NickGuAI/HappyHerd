import type { ApiClient } from '@/api/api';
import type { ApiSessionClient } from '@/api/apiSession';
import { decodeBase64 } from '@/api/encryption';
import type { AgentState, Metadata, Session } from '@/api/types';
import { queueMessageIdsForResume } from '@/utils/MessageQueue2';

export type SessionReconnectInitialization = {
  response: Session | null;
  reconnecting: boolean;
  queueMessageIds: string[];
  priorityQueueMessageId: string | null;
};

/** Attach a fresh provider process to an existing encrypted Happy session when requested by the daemon. */
export async function loadOrCreateHappySession(input: {
  api: ApiClient;
  sessionTag: string;
  metadata: Metadata;
  state: AgentState;
}): Promise<SessionReconnectInitialization> {
  const reconnectSessionId = process.env.HAPPY_RECONNECT_SESSION_ID;
  const reconnectKeyBase64 = process.env.HAPPY_RECONNECT_ENCRYPTION_KEY;
  const reconnectVariant = process.env.HAPPY_RECONNECT_ENCRYPTION_VARIANT as 'legacy' | 'dataKey' | undefined;
  if (!reconnectSessionId || !reconnectKeyBase64 || !reconnectVariant) {
    return {
      response: await input.api.getOrCreateSession({
        tag: input.sessionTag,
        metadata: input.metadata,
        state: input.state,
      }),
      reconnecting: false,
      queueMessageIds: [],
      priorityQueueMessageId: null,
    };
  }

  const pendingLaunchReceipt = input.metadata.spawnSettings;
  const response = await input.api.refreshSessionForReconnect({
    id: reconnectSessionId,
    seq: Number.parseInt(process.env.HAPPY_RECONNECT_SEQ || '0', 10),
    encryptionKey: decodeBase64(reconnectKeyBase64),
    encryptionVariant: reconnectVariant,
    metadata: input.metadata,
    metadataVersion: Number.parseInt(process.env.HAPPY_RECONNECT_METADATA_VERSION || '0', 10),
    agentState: input.state,
    agentStateVersion: Number.parseInt(process.env.HAPPY_RECONNECT_AGENT_STATE_VERSION || '0', 10),
  });
  Object.assign(input.metadata, response.metadata);
  if (pendingLaunchReceipt) input.metadata.spawnSettings = pendingLaunchReceipt;
  return {
    response,
    reconnecting: true,
    queueMessageIds: Array.from(new Set([
      ...queueMessageIdsForResume(response.agentState?.messageQueue),
      ...(process.env.HAPPY_RECONNECT_QUEUE_MESSAGE_ID
        ? [process.env.HAPPY_RECONNECT_QUEUE_MESSAGE_ID]
        : []),
    ])),
    priorityQueueMessageId: process.env.HAPPYHERD_FRESH_PROVIDER_RECONNECT === '1'
      ? process.env.HAPPY_RECONNECT_QUEUE_MESSAGE_ID ?? null
      : null,
  };
}

export function configureHappySessionReconnect(
  session: ApiSessionClient,
  initialization: SessionReconnectInitialization,
): void {
  if (!initialization.reconnecting) return;
  session.suppressNextArchiveSignal();
  const throughSeq = initialization.response?.seq ?? Number.MAX_SAFE_INTEGER;
  if (initialization.priorityQueueMessageId) {
    session.skipExistingMessages(
      initialization.queueMessageIds,
      throughSeq,
      initialization.priorityQueueMessageId,
    );
  } else {
    session.skipExistingMessages(initialization.queueMessageIds, throughSeq);
  }
  session.updateMetadata((metadata) => ({
    ...metadata,
    lifecycleState: 'running',
    lifecycleStateSince: Date.now(),
    archivedBy: undefined,
    archiveReason: undefined,
  }));
}
