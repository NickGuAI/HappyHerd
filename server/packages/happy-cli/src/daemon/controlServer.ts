/**
 * HTTP control server for daemon management
 * Provides endpoints for listing sessions, stopping sessions, and daemon shutdown
 */

import fastify, { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { logger } from '@/ui/logger';
import { Metadata } from '@/api/types';
import { decodeBase64 } from '@/api/encryption';
import { TrackedSession, SessionEncryptionData } from './types';
import { SpawnSessionOptions, SpawnSessionResult } from '@/modules/common/registerCommonHandlers';
import type { HappyHerdAutomationService } from '@/automations/service';
import { normalizeSideChatLifecycleRequest } from '@/commands/sideChat';
import type { SideChatLifecycleReceipt, SideChatLifecycleRequest } from '@/commands/sideChat';

export function startDaemonControlServer({
  getChildren,
  stopSession,
  spawnSession,
  sideChat,
  requestShutdown,
  onHappySessionWebhook,
  automations,
}: {
  getChildren: () => TrackedSession[];
  stopSession: (sessionId: string) => boolean;
  spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>;
  sideChat: (request: SideChatLifecycleRequest) => Promise<SideChatLifecycleReceipt>;
  requestShutdown: () => void;
  onHappySessionWebhook: (sessionId: string, metadata: Metadata, encryption?: SessionEncryptionData) => void;
  automations: HappyHerdAutomationService;
}): Promise<{ port: number; stop: () => Promise<void> }> {
  return new Promise((resolve) => {
    const app = fastify({
      logger: false // We use our own logger
    });

    // Set up Zod type provider
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>();

    // Session reports itself after creation
    typed.post('/session-started', {
      schema: {
        body: z.object({
          sessionId: z.string(),
          metadata: z.any(),
          encryption: z.object({
            encryptionKey: z.string(),
            encryptionVariant: z.enum(['legacy', 'dataKey']),
            seq: z.number(),
            metadataVersion: z.number(),
            agentStateVersion: z.number(),
          }).optional()
        }),
        response: {
          200: z.object({
            status: z.literal('ok')
          })
        }
      }
    }, async (request) => {
      const { sessionId, metadata, encryption } = request.body;

      logger.debug(`[CONTROL SERVER] Session started: ${sessionId}`);

      let encryptionData: SessionEncryptionData | undefined;
      if (encryption) {
        encryptionData = {
          encryptionKey: decodeBase64(encryption.encryptionKey),
          encryptionVariant: encryption.encryptionVariant,
          seq: encryption.seq,
          metadataVersion: encryption.metadataVersion,
          agentStateVersion: encryption.agentStateVersion,
        };
      }

      onHappySessionWebhook(sessionId, metadata, encryptionData);

      return { status: 'ok' as const };
    });

    // List all tracked sessions
    typed.post('/list', {
      schema: {
        response: {
          200: z.object({
            children: z.array(z.object({
              startedBy: z.string(),
              happySessionId: z.string(),
              pid: z.number()
            }))
          })
        }
      }
    }, async () => {
      const children = getChildren();
      logger.debug(`[CONTROL SERVER] Listing ${children.length} sessions`);
      return { 
        children: children
          .filter(child => child.happySessionId !== undefined)
          .map(child => ({
            startedBy: child.startedBy,
            happySessionId: child.happySessionId!,
            pid: child.pid
          }))
      }
    });

    // Stop specific session
    typed.post('/stop-session', {
      schema: {
        body: z.object({
          sessionId: z.string()
        }),
        response: {
          200: z.object({
            success: z.boolean()
          })
        }
      }
    }, async (request) => {
      const { sessionId } = request.body;

      logger.debug(`[CONTROL SERVER] Stop session request: ${sessionId}`);
      const success = stopSession(sessionId);
      return { success };
    });

    typed.post('/automations', {
      schema: {
        body: z.object({
          action: z.enum(['list', 'create', 'update', 'pause', 'resume', 'delete', 'run-now', 'history', 'stop-run', 'abandon-run']),
          id: z.string().optional(),
          runId: z.string().optional(),
          input: z.any().optional(),
        }),
        response: { 200: z.any() },
      },
    }, async (request) => {
      const id = request.body.id;
      switch (request.body.action) {
        case 'list': return automations.list();
        case 'create': return automations.create(request.body.input);
        case 'update':
          if (!id) throw new Error('id is required');
          return automations.update(id, request.body.input ?? {});
        case 'pause':
          if (!id) throw new Error('id is required');
          return automations.pause(id);
        case 'resume':
          if (!id) throw new Error('id is required');
          return automations.resume(id);
        case 'delete':
          if (!id) throw new Error('id is required');
          await automations.delete(id);
          return { deleted: true };
        case 'run-now':
          if (!id) throw new Error('id is required');
          return automations.runNow(id);
        case 'history':
          if (!id) throw new Error('id is required');
          return automations.history(id);
        case 'stop-run':
          if (!id || !request.body.runId) throw new Error('id and runId are required');
          return automations.stopRun({ automationId: id, runId: request.body.runId });
        case 'abandon-run':
          if (!id || !request.body.runId) throw new Error('id and runId are required');
          return automations.abandonRun({
            automationId: id,
            runId: request.body.runId,
            sessionId: request.body.input?.sessionId ?? null,
            confirmation: request.body.input?.confirmation,
          });
      }
    });

    // Spawn new session
    typed.post('/spawn-session', {
      schema: {
        body: z.object({
          directory: z.string(),
          sessionId: z.string().optional(),
          agent: z.enum(['claude', 'codex', 'gemini', 'grok', 'agy']).optional(),
          permissionMode: z.string().optional(),
          modelMode: z.string().optional(),
          effortLevel: z.string().optional(),
          environmentVariables: z.record(z.string(), z.string()).optional(),
        }),
        response: {
          200: z.object({
            success: z.boolean(),
            sessionId: z.string().optional(),
            approvedNewDirectoryCreation: z.boolean().optional()
          }),
          409: z.object({
            success: z.boolean(),
            requiresUserApproval: z.boolean().optional(),
            actionRequired: z.string().optional(),
            directory: z.string().optional()
          }),
          500: z.object({
            success: z.boolean(),
            error: z.string().optional()
          })
        }
      }
    }, async (request, reply) => {
      const { directory, sessionId, agent, permissionMode, modelMode, effortLevel, environmentVariables } = request.body;

      logger.debug(`[CONTROL SERVER] Spawn session request: dir=${directory}, sessionId=${sessionId || 'new'}, agent=${agent || 'default'}`);
      const result = await spawnSession({ directory, sessionId, agent, permissionMode, modelMode, effortLevel, environmentVariables });

      switch (result.type) {
        case 'success':
          // Check if sessionId exists, if not return error
          if (!result.sessionId) {
            reply.code(500);
            return {
              success: false,
              error: 'Failed to spawn session: no session ID returned'
            };
          }
          return {
            success: true,
            sessionId: result.sessionId,
            approvedNewDirectoryCreation: true
          };
        
        case 'requestToApproveDirectoryCreation':
          reply.code(409); // Conflict - user input needed
          return { 
            success: false,
            requiresUserApproval: true,
            actionRequired: 'CREATE_DIRECTORY',
            directory: result.directory
          };
        
        case 'error':
          reply.code(500);
          return { 
            success: false,
            error: result.errorMessage
          };
      }
    });

    const sideChatDelegationBriefSchema = z.object({
      outcome: z.string().trim().min(1),
      scope: z.string().trim().min(1),
      dependencies: z.string().trim().min(1),
      writeOwnership: z.string().trim().min(1),
      verification: z.string().trim().min(1),
      handoff: z.string().trim().min(1),
    }).strict();
    const sideChatRequestSchema = z.discriminatedUnion('action', [
      z.object({
        action: z.literal('create'),
        parentSessionId: z.string().min(1),
        brief: sideChatDelegationBriefSchema,
      }),
      z.object({ action: z.literal('list'), parentSessionId: z.string().min(1) }),
      z.object({ action: z.literal('status'), sessionId: z.string().min(1) }),
      z.object({ action: z.literal('inspect'), sessionId: z.string().min(1) }),
      z.object({ action: z.literal('stop'), sessionId: z.string().min(1) }),
      z.object({ action: z.literal('pause'), sessionId: z.string().min(1) }),
      z.object({ action: z.literal('close'), sessionId: z.string().min(1) }),
      z.object({ action: z.literal('reopen'), sessionId: z.string().min(1) }),
      z.object({ action: z.literal('resume'), sessionId: z.string().min(1) }),
      z.object({ action: z.literal('close-all'), parentSessionId: z.string().min(1) }),
    ]);

    // The daemon owns side-chat process state and encrypted session metadata;
    // all lifecycle actions therefore cross this one local control boundary.
    typed.post('/side-chat', {
      schema: {
        body: sideChatRequestSchema,
        response: {
          200: z.any(),
          500: z.object({ error: z.string() }),
        },
      },
    }, async (request, reply) => {
      try {
        return await sideChat(normalizeSideChatLifecycleRequest(request.body));
      } catch (error) {
        reply.code(500);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    });

    // Stop daemon
    typed.post('/stop', {
      schema: {
        response: {
          200: z.object({
            status: z.string()
          })
        }
      }
    }, async () => {
      logger.debug('[CONTROL SERVER] Stop daemon request received');

      // Give time for response to arrive
      setTimeout(() => {
        logger.debug('[CONTROL SERVER] Triggering daemon shutdown');
        requestShutdown();
      }, 50);

      return { status: 'stopping' };
    });

    app.listen({ port: 0, host: '127.0.0.1' }, (err, address) => {
      if (err) {
        logger.debug('[CONTROL SERVER] Failed to start:', err);
        throw err;
      }

      const port = parseInt(address.split(':').pop()!);
      logger.debug(`[CONTROL SERVER] Started on port ${port}`);

      resolve({
        port,
        stop: async () => {
          logger.debug('[CONTROL SERVER] Stopping server');
          await app.close();
          logger.debug('[CONTROL SERVER] Server stopped');
        }
      });
    });
  });
}
