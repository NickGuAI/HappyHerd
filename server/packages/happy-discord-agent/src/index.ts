import { PmaiAuthorizationClient } from './authorization';
import { DiscordAgentBridge } from './bridge';
import { PmaiSkillBroker } from './broker';
import { CapabilityRegistry } from './capabilities';
import { loadBridgeConfig, readSecretFile } from './config';
import { DiscordGateway } from './discord';
import { HappyHerdRuntime } from './happy';
import { BridgeHttpServer } from './httpServer';
import { BridgeStore } from './store';

function log(event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...fields,
  })}\n`);
}

async function main(): Promise<void> {
  const config = loadBridgeConfig();
  const [discordToken, signingSecret, transportSecret] = await Promise.all([
    readSecretFile(config.discordBotTokenFile, 'Discord bot token file'),
    readSecretFile(config.pmaiServiceSigningSecretFile, 'PMAI signing secret file'),
    readSecretFile(config.bridgeTransportSecretFile, 'bridge transport secret file'),
  ]);
  const store = await BridgeStore.open(config.stateDir);
  const capabilities = new CapabilityRegistry();
  const discord = new DiscordGateway(config.discordApplicationId);
  const authorizer = new PmaiAuthorizationClient({
    baseUrl: config.pmaiApiBaseUrl,
    authorizationPath: config.pmaiAuthorizationPath,
    bridgeId: config.pmaiBridgeId,
    signingSecret,
  });
  const happy = new HappyHerdRuntime(config);
  const broker = new PmaiSkillBroker({
    capabilities,
    apiBaseUrl: config.pmaiApiBaseUrl,
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
    readiness: () => ({
      discord: discord.isReady(),
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
  log('pmai_discord_http_listening', { host: config.listenHost, port: config.listenPort });
  try {
    await discord.start(discordToken);
    log('pmai_discord_gateway_ready');
    await bridge.reconcile();
  } catch (error) {
    await httpServer.close();
    throw error;
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('pmai_discord_shutdown', { signal });
    await Promise.allSettled([httpServer.close(), discord.stop()]);
  };
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    timestamp: new Date().toISOString(),
    event: 'pmai_discord_fatal',
    error: error instanceof Error ? error.message : String(error),
  })}\n`);
  process.exit(1);
});
