#!/usr/bin/env node

import {
  loadBrokerServiceConfig,
  removeVerifiedManagedSkillsForUninstall,
} from '../../runtime/dist/index.mjs';

const mode = process.argv[2];
const configPath = process.argv[3];
if (!['--preflight', '--apply'].includes(mode) || !configPath || process.argv.length !== 4) {
  throw new Error('usage: happyherd-uninstall-managed.mjs --preflight|--apply BROKER_CONFIG');
}
const config = loadBrokerServiceConfig(configPath);
const report = removeVerifiedManagedSkillsForUninstall({
  providerRoots: config.providerRoots,
  registryRoot: config.registryRoot,
}, mode === '--apply');
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ...report })}\n`);
