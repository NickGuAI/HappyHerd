/**
 * Agy Session Runner
 *
 * Entry point for agy (Antigravity CLI) agent sessions. The daemon spawns this as:
 *   `node dist/index.mjs agy --happy-starting-mode remote --started-by daemon`
 *
 * agy is a plain-text streaming CLI (no ACP), so this drives an AgyBackend that
 * spawns `agy --print` per turn, and forwards its AgentMessage stream through the
 * same session pipeline used by the other backends.
 */

import { randomUUID } from 'node:crypto';
import React from 'react';
import { render, type Instance as InkInstance } from 'ink';
import { ApiClient } from '@/api/api';
import type { ApiSessionClient } from '@/api/apiSession';
import { AcpSessionManager } from '@/agent/acp/AcpSessionManager';
import type { SessionEnvelope } from '@slopus/happy-wire';
import { logger } from '@/ui/logger';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import { configureHappySessionReconnect, loadOrCreateHappySession } from '@/utils/sessionReconnect';
import { Credentials, readSettings } from '@/persistence';
import { initialMachineMetadata } from '@/daemon/run';
import { createSessionMetadata } from '@/utils/createSessionMetadata';
import { setupOfflineReconnection } from '@/utils/setupOfflineReconnection';
import { notifyDaemonSessionStarted } from '@/daemon/controlClient';
import { encodeBase64 } from '@/api/encryption';
import { registerKillSessionHandler } from '@/claude/registerKillSessionHandler';
import { connectionState } from '@/utils/serverConnectionErrors';
import { MessageBuffer } from '@/ui/ink/messageBuffer';
import { AgyDisplay } from '@/ui/ink/AgyDisplay';
import type { AgentMessage } from '@/agent/core';
import { AgyBackend } from './AgyBackend';
import { DEFAULT_AGY_MODEL, normalizeAgyEffort, resolveAgyModelName } from './constants';
import {
  buildAgyLaunchMetadata,
  hashAgyTurnMode,
  resolveAgyIncomingPermissionMode,
  type AgyTurnMode,
} from './turnMode';
import { isAgyPermissionMode, type AgyPermissionMode } from './cliArgs';

export interface RunAgyOptions {
  credentials: Credentials;
  startedBy?: 'daemon' | 'terminal';
  verbose?: boolean;
  model?: string;
  effort?: string;
  permissionMode?: AgyPermissionMode;
}

export async function runAgy(opts: RunAgyOptions): Promise<void> {
  const verbose = opts.verbose === true;
  const sessionTag = randomUUID();
  connectionState.setBackend('agy');

  const log = (msg: string) => {
    logger.debug(`[agy] ${msg}`);
    if (verbose) {
      console.log(`[agy] ${msg}`);
    }
  };

  const api = await ApiClient.create(opts.credentials);
  const settings = await readSettings();
  if (!settings?.machineId) {
    throw new Error('No machine ID found in settings');
  }

  await api.getOrCreateMachine({
    machineId: settings.machineId,
    metadata: initialMachineMetadata,
  });

  let selectedPermissionMode = opts.permissionMode ?? 'default';
  let selectedModel = opts.model ?? DEFAULT_AGY_MODEL;
  let selectedEffort: string | undefined = selectedModel === DEFAULT_AGY_MODEL
    ? normalizeAgyEffort(opts.effort)
    : undefined;
  const launchMetadata = buildAgyLaunchMetadata(selectedPermissionMode, selectedModel, selectedEffort ?? null);

  const { state, metadata } = createSessionMetadata({
    flavor: 'agy',
    machineId: settings.machineId,
    startedBy: opts.startedBy,
    spawnSettings: launchMetadata.spawnSettings,
  });
  const effectiveLaunchSettings = metadata.spawnSettings?.provider === 'agy'
    ? metadata.spawnSettings
    : launchMetadata.spawnSettings;
  if (!isAgyPermissionMode(effectiveLaunchSettings.permission)) {
    throw new Error(`Unsupported Antigravity permission mode: ${effectiveLaunchSettings.permission}`);
  }
  if (!effectiveLaunchSettings.model) {
    throw new Error('Antigravity requires a concrete model');
  }
  selectedPermissionMode = effectiveLaunchSettings.permission;
  selectedModel = effectiveLaunchSettings.model;
  selectedEffort = selectedModel === DEFAULT_AGY_MODEL
    ? normalizeAgyEffort(effectiveLaunchSettings.effort)
    : undefined;
  let displayedModel = resolveAgyModelName(selectedModel, selectedEffort);
  metadata.permissionMode = selectedPermissionMode;
  metadata.modelMode = selectedModel;
  metadata.effortLevel = selectedEffort ?? null;
  const reconnect = await loadOrCreateHappySession({ api, sessionTag, metadata, state });
  const response = reconnect.response;
  if (response) {
    log(`Happy Session ID: ${response.id}`);
  }

  let session: ApiSessionClient;
  const { session: initialSession, reconnectionHandle } = setupOfflineReconnection({
    api,
    sessionTag,
    metadata,
    state,
    response,
    onSessionSwap: (newSession) => {
      session = newSession;
    },
  });
  session = initialSession;
  configureHappySessionReconnect(session, reconnect);

  if (response) {
    try {
      await notifyDaemonSessionStarted(response.id, metadata, {
        encryptionKey: encodeBase64(response.encryptionKey),
        encryptionVariant: response.encryptionVariant,
        seq: response.seq,
        metadataVersion: response.metadataVersion,
        agentStateVersion: response.agentStateVersion,
      });
    } catch (error) {
      logger.debug('[agy] Failed to report session to daemon:', error);
    }
  }

  const sessionManager = new AcpSessionManager();
  const messageQueue = new MessageQueue2<AgyTurnMode>(hashAgyTurnMode);
  messageQueue.restorePendingQueueMessageIds(
    reconnect.queueMessageIds,
    reconnect.priorityQueueMessageId ?? undefined,
  );
  messageQueue.setOnQueueStateChange((messageQueueState) => {
    session.updateAgentState((currentState) => ({ ...currentState, messageQueue: messageQueueState }));
  });
  session.updateAgentState((currentState) => ({
    ...currentState,
    messageQueue: messageQueue.getQueueState(),
  }));
  let shouldExit = false;
  let abortController = new AbortController();
  let thinking = false;
  let errorReportedForCurrentTurn = false;

  const backend = new AgyBackend({
    cwd: process.cwd(),
    permissionMode: selectedPermissionMode,
    model: selectedModel,
    effort: selectedEffort,
    log,
  });

  // Terminal UI (only with a real TTY; the daemon runs headless).
  const messageBuffer = new MessageBuffer();
  const hasTTY = Boolean(process.stdout.isTTY && process.stdin.isTTY);
  let inkInstance: InkInstance | null = null;

  const sendEnvelopes = (envelopes: SessionEnvelope[]) => {
    for (const envelope of envelopes) {
      session.sendSessionProtocolMessage(envelope);
    }
  };

  const onBackendMessage = (msg: AgentMessage) => {
    if (verbose) {
      log(`Backend message: ${JSON.stringify(msg).slice(0, 200)}`);
    }

    if (msg.type === 'model-output' && msg.textDelta) {
      messageBuffer.addMessage(msg.textDelta, 'assistant');
    } else if (msg.type === 'status') {
      const nextThinking = msg.status === 'running';
      if (thinking !== nextThinking) {
        thinking = nextThinking;
        session.keepAlive(thinking, 'remote');
      }
      if (msg.status === 'error' && msg.detail) {
        messageBuffer.addMessage(`Error: ${msg.detail}`, 'status');
      }
    }

    const envelopes = sessionManager.mapMessage(msg);
    sendEnvelopes(envelopes);
    if (msg.type === 'status' && msg.status === 'error' && envelopes.length === 0) {
      session.sendSessionEvent({
        type: 'message',
        message: `Antigravity error: ${(msg.detail?.trim() || 'The agent stopped because of an unknown error.').slice(-2_000)}`,
      });
    }
    if (msg.type === 'status' && msg.status === 'error') {
      errorReportedForCurrentTurn = true;
    }
  };

  backend.onMessage(onBackendMessage);

  if (hasTTY) {
    const DisplayComponent = () =>
      React.createElement(AgyDisplay, {
        messageBuffer,
        logPath: process.env.DEBUG ? logger.getLogPath() : undefined,
        currentModel: displayedModel,
        onExit: async () => {
          logger.debug('[agy] Exiting agent via Ctrl-C');
          shouldExit = true;
          await handleAbort();
        },
      });

    inkInstance = render(React.createElement(DisplayComponent), {
      exitOnCtrlC: false,
      patchConsole: false,
    });
    messageBuffer.addMessage(`[MODEL:${displayedModel}]`, 'system');

    process.stdin.resume();
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.setEncoding('utf8');
  }

  session.onUserMessage((message) => {
    if (!message.content.text) return;

    const permission = resolveAgyIncomingPermissionMode(
      selectedPermissionMode,
      message.meta?.permissionMode,
    );
    if (!permission.ok) {
      logger.debug(`[agy] ${permission.error}`);
      session.sendSessionEvent({ type: 'message', message: permission.error });
      return;
    }
    selectedPermissionMode = permission.permissionMode;
    let selectionChanged = false;
    if (message.meta?.hasOwnProperty('model') && message.meta.model) {
      selectedModel = message.meta.model;
      selectionChanged = true;
    }
    if (message.meta?.hasOwnProperty('effort')) {
      selectedEffort = normalizeAgyEffort(message.meta.effort);
      selectionChanged = true;
    }
    if (selectionChanged) {
      selectedEffort = selectedModel === DEFAULT_AGY_MODEL
        ? normalizeAgyEffort(selectedEffort)
        : undefined;
      displayedModel = resolveAgyModelName(selectedModel, selectedEffort);
      if (hasTTY) {
        messageBuffer.addMessage(`[MODEL:${displayedModel}]`, 'system');
      }
    }

    messageBuffer.addMessage(message.content.text, 'user');
    messageQueue.push(message.content.text, {
      permissionMode: selectedPermissionMode,
      model: selectedModel,
      effort: selectedEffort,
    }, undefined, message.localKey);
  });
  session.keepAlive(thinking, 'remote');

  const keepAliveInterval = setInterval(() => {
    session.keepAlive(thinking, 'remote');
  }, 2000);

  async function handleAbort() {
    log('Abort requested');
    try {
      await backend.cancel();
    } catch (error) {
      logger.debug('[agy] Abort failed:', error);
    }
    thinking = false;
    session.keepAlive(false, 'remote');
    abortController.abort();
    abortController = new AbortController();
  }

  session.rpcHandlerManager.registerHandler('abort', handleAbort);
  registerKillSessionHandler(session.rpcHandlerManager, async () => {
    shouldExit = true;
    messageQueue.close();
    await handleAbort();
  });

  try {
    await backend.startSession();
    log('Backend ready');

    while (!shouldExit) {
      const waitSignal = abortController.signal;
      const batch = await messageQueue.waitForMessagesAndGetAsString(waitSignal);
      if (!batch) {
        if (shouldExit) break;
        if (waitSignal.aborted) continue;
        break;
      }

      log(`Incoming prompt: ${batch.message.slice(0, 200)}`);
      messageQueue.markBatchStarted(batch.queueMessageIds);
      errorReportedForCurrentTurn = false;
      sendEnvelopes(sessionManager.startTurn());
      try {
        // Apply the immutable settings captured with this batch. Later remote
        // picks may already be queued but cannot change this child process.
        backend.setPermissionMode(batch.mode.permissionMode);
        backend.setModel(batch.mode.model);
        backend.setEffort(batch.mode.effort);
        await backend.sendPrompt(process.cwd(), batch.message);
        sendEnvelopes(sessionManager.endTurn('completed'));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (!errorReportedForCurrentTurn) {
          session.sendSessionEvent({ type: 'message', message: `Antigravity error: ${msg.slice(-2_000)}` });
          errorReportedForCurrentTurn = true;
        }
        log(`Turn ended: ${msg}`);
        sendEnvelopes(sessionManager.endTurn('failed'));
      } finally {
        messageQueue.completeCurrentBatch(batch.queueMessageIds);
      }
      thinking = false;
      session.keepAlive(false, 'remote');
      session.sendSessionEvent({ type: 'ready' });
    }
  } finally {
    clearInterval(keepAliveInterval);
    reconnectionHandle?.cancel();

    backend.offMessage(onBackendMessage);
    await backend.dispose();
    inkInstance?.unmount();

    try {
      session.updateMetadata((currentMetadata) => ({
        ...currentMetadata,
        lifecycleState: 'archived',
        lifecycleStateSince: Date.now(),
        archivedBy: 'cli',
        archiveReason: 'Session ended',
      }));
      session.sendSessionDeath();
      await session.flush();
      await session.close();
    } catch (error) {
      logger.debug('[agy] Session close failed:', error);
    }
  }
}
