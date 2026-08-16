import { pathToFileURL } from 'node:url';
import { ServiceAuthorizationClient } from './authorization';
import { DiscordAgentBridge } from './bridge';
import { GovernedSkillBroker } from './broker';
import { CapabilityRegistry } from './capabilities';
import { loadBridgeConfig, readSecretFile, verifyDiscordTokenRotationReceipt } from './config';
import { DiscordGateway } from './discord';
import { HappyHerdRuntime } from './happy';
import { BridgeHttpServer } from './httpServer';
import { loadHappyHerdAgentManifest } from './manifest';
import { BridgeStore } from './store';

function log(event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...fields,
  })}\n`);
}

export async function startHappyHerdAgent(): Promise<void> {
  const config = loadBridgeConfig();
  const [discordToken, signingSecret, transportSecret, manifest] = await Promise.all([
    readSecretFile(config.discordBotTokenFile, 'Discord bot token file'),
    readSecretFile(config.serviceSigningSecretFile, 'service signing secret file'),
    readSecretFile(config.transportSecretFile, 'bridge transport secret file'),
    loadHappyHerdAgentManifest(config.toolManifestFile),
  ]);
  await verifyDiscordTokenRotationReceipt({
    receiptPath: config.discordTokenRotationReceiptFile,
    token: discordToken,
    applicationId: config.discordApplicationId,
    production: process.env.NODE_ENV === 'production',
    notBefore: config.discordTokenNotBefore,
  });
  const store = await BridgeStore.open(config.stateDir);
  const capabilities = new CapabilityRegistry();
  const discord = new DiscordGateway(config.discordApplicationId, (error) => {
    log('happyherd_agent_discord_gateway_error', { errorType: error.name });
  });
  const authorizer = new ServiceAuthorizationClient({
    baseUrl: config.serviceApiBaseUrl,
    authorizationPath: config.authorizationPath,
    agentId: config.agentId,
    signingSecret,
  });
  const happy = new HappyHerdRuntime(config, manifest);
  const broker = new GovernedSkillBroker({
    capabilities,
    apiBaseUrl: config.serviceApiBaseUrl,
    manifest,
  });
  const bridge = new DiscordAgentBridge({
    config,
    store,
    authorizer,
    capabilities,
    happy,
    discord,
    logger: log,
  });
  const httpServer = new BridgeHttpServer({
    config,
    broker,
    store,
    discord,
    transportSecret,
    readiness: async () => ({
      discord: discord.isReady(),
      happyMachine: await happy.isMachineReady(),
      state: true,
      broker: true,
    }),
  });

  discord.onMessage(async (message) => {
    try {
      await bridge.handle(message);
    } catch (error) {
      log('discord_message_handler_failed', {
        sourceMessageId: message.sourceMessageId,
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }
  });

  await httpServer.listen(config.listenHost, config.listenPort);
  log('happyherd_agent_http_listening', { host: config.listenHost, port: config.listenPort });
  try {
    await discord.start(discordToken);
    log('happyherd_agent_discord_gateway_ready');
  } catch (error) {
    await Promise.allSettled([httpServer.close(), discord.stop()]);
    throw error;
  }

  let reconciliation: Promise<void> | null = null;
  const reconcile = () => {
    if (reconciliation) return;
    reconciliation = bridge.reconcile()
      .catch((error) => {
        log('happyherd_agent_reconciliation_failed', {
          errorType: error instanceof Error ? error.name : typeof error,
        });
      })
      .finally(() => {
        reconciliation = null;
      });
  };
  reconcile();
  const reconcileInterval = setInterval(reconcile, 30_000);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(reconcileInterval);
    log('happyherd_agent_shutdown', { signal });
    await Promise.allSettled([httpServer.close(), discord.stop()]);
  };
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startHappyHerdAgent().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'happyherd_agent_fatal',
      error: error instanceof Error ? error.message : String(error),
    })}\n`);
    process.exit(1);
  });
}
