/** HappyHerd's organization-neutral end-user command surface. */

import {
  BrokerClient,
  listenBroker,
  loadBrokerClientConfig,
  loadBrokerServiceConfig,
  type BrokerClientInterface,
} from './broker';
import { currentTarget, runDoctor } from './doctor';
import { checkUpgrade } from './release';
import { launchAgent, runHappy } from './runtime';
import { normalizeIssuer } from './contracts';
import { packageIdentity } from './version';

export interface CliDependencies {
  brokerClient?: BrokerClientInterface;
  brokerClientConfigPath?: string;
  fetch?: typeof fetch;
  openBrowser?: (url: string) => void;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

const HELP = `HappyHerd — local Claude and Codex sessions with controlled organization access

Usage:
  happyherd doctor [--json]
  happyherd connect <issuer> [--no-open] [--json]
  happyherd disconnect <issuer|--all>
  happyherd install-skills --issuer <issuer>
  happyherd run-tool --issuer <issuer> --skill <name> --script <relative-path> -- [arguments...]
  happyherd launch <claude|codex> [arguments...]
  happyherd upgrade --manifest <release-manifest-url>
  happyherd --version

Issuer credentials stay inside the OS-separated HappyHerd broker. The launcher
never reads or exports them. Never paste a credential into chat, a URL, or a
command-line argument.

The governed commands above keep HappyHerd semantics. Every other invocation
is forwarded unchanged to the bundled native Happy CLI.

Native machine-session examples:
  happyherd machine auth login
  happyherd machine list --json
  happyherd session create --machine ID_OR_HOST --path ABSOLUTE_PATH --provider codex --json

Session creation supports native Happy CLI daemon machines; machine-list
receipts identify unsupported machine kinds such as Rig.`;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function positional(args: string[]): string[] {
  const withValues = new Set(['--issuer', '--manifest', '--skill', '--script', '--config']);
  const output: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (withValues.has(value)) index += 1;
    else if (!value.startsWith('--')) output.push(value);
  }
  return output;
}

function clientFor(dependencies: CliDependencies, allowBrowser = true): BrokerClientInterface {
  if (dependencies.brokerClient) return dependencies.brokerClient;
  return new BrokerClient({
    config: loadBrokerClientConfig(dependencies.brokerClientConfigPath),
    ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
    ...(!allowBrowser ? { openBrowser: () => undefined } : dependencies.openBrowser ? { openBrowser: dependencies.openBrowser } : {}),
    stdout: dependencies.stdout ?? console.log,
  });
}

export async function runCli(args: string[], dependencies: CliDependencies = {}): Promise<number> {
  const output = dependencies.stdout ?? console.log;
  const errorOutput = dependencies.stderr ?? console.error;
  const identity = packageIdentity();
  try {
    if (args.length === 0 || args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
      output(HELP);
      return 0;
    }
    if (args[0] === '--version' || args[0] === '-v') {
      if (args.length !== 1) throw new Error(`${args[0]} accepts no arguments`);
      output(`happyherd version: ${identity.version}`);
      return 0;
    }
    const command = args[0];
    const rest = args.slice(1);

    // This command is intentionally absent from public help. Installers invoke
    // it under the dedicated OS service identity with a service-only config.
    if (command === 'broker-service') {
      const path = option(rest, '--config');
      if (!path || positional(rest).length > 0) throw new Error('broker-service requires --config <absolute-path>');
      const server = await listenBroker(loadBrokerServiceConfig(path), identity.version);
      await new Promise<void>((resolvePromise, reject) => {
        const stop = (): void => { server.close(() => resolvePromise()); };
        process.once('SIGTERM', stop);
        process.once('SIGINT', stop);
        server.once('error', reject);
      });
      return 0;
    }

    if (command === 'doctor') {
      if (rest.some((argument) => argument !== '--json' && argument !== '--installation')) {
        throw new Error('doctor accepts only --json or the installer health flag');
      }
      const report = await runDoctor(clientFor(dependencies, false), {
        includeExternalAgents: !rest.includes('--installation'),
      });
      if (rest.includes('--json')) output(JSON.stringify(report, null, 2));
      else {
        output(`HappyHerd doctor (${report.target})`);
        for (const check of report.checks) output(`${check.ok ? 'ok' : 'fail'}  ${check.name}: ${check.detail}`);
      }
      return report.ok ? 0 : 1;
    }
    if (command === 'connect') {
      const positions = positional(rest);
      const issuer = positions[0];
      if (
        positions.length !== 1
        || rest.some((argument) => argument.startsWith('--') && argument !== '--no-open' && argument !== '--json')
      ) throw new Error('connect requires one issuer origin and accepts only --no-open or --json');
      const normalized = normalizeIssuer(issuer);
      const json = rest.includes('--json');
      const result = await clientFor(dependencies, !rest.includes('--no-open')).connect(
        normalized,
        identity.version,
        json ? (event) => output(JSON.stringify({ schemaVersion: 1, ...event })) : undefined,
      );
      if (json) {
        output(JSON.stringify({
          schemaVersion: 1,
          type: 'receipt',
          issuer: normalized,
          expiresAt: result.expiresAt,
          scopes: result.scopes,
          skillBundleAvailable: result.skillBundleAvailable,
        }));
      } else {
        output(`Credential expires: ${result.expiresAt}`);
        output(`Approved scopes: ${result.scopes.join(', ') || 'none'}`);
        if (result.skillBundleAvailable) output(`Next: happyherd install-skills --issuer ${normalized}`);
      }
      return 0;
    }
    if (command === 'disconnect') {
      const issuer = positional(rest)[0];
      const all = rest.includes('--all');
      if (all === Boolean(issuer) || rest.some((argument) => argument.startsWith('--') && argument !== '--all')) {
        throw new Error('disconnect requires exactly one issuer origin or --all');
      }
      const removed = await clientFor(dependencies, false).disconnect(all ? undefined : normalizeIssuer(issuer!));
      output(`Removed ${removed} local issuer credential${removed === 1 ? '' : 's'} from the OS secret store.`);
      return 0;
    }
    if (command === 'install-skills') {
      const issuer = option(rest, '--issuer');
      if (!issuer || positional(rest).length > 0) {
        throw new Error('install-skills requires --issuer <issuer>');
      }
      const installed = await clientFor(dependencies).installSkills(normalizeIssuer(issuer));
      output(`Installed ${installed.id}@${installed.version}`);
      output(`Skills: ${installed.skills.join(', ')}`);
      output(`Registry: ${installed.registry}`);
      return 0;
    }
    if (command === 'run-tool') {
      const divider = rest.indexOf('--');
      const configuration = divider === -1 ? rest : rest.slice(0, divider);
      const toolArguments = divider === -1 ? [] : rest.slice(divider + 1);
      const issuer = option(configuration, '--issuer');
      const skill = option(configuration, '--skill');
      const script = option(configuration, '--script');
      if (!issuer || !skill || !script) throw new Error('run-tool requires --issuer, --skill, and --script');
      if (positional(configuration).length > 0) throw new Error('run-tool arguments must follow a standalone -- separator');
      const result = await clientFor(dependencies).runTool(normalizeIssuer(issuer), skill, script, toolArguments);
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      return result.status;
    }
    if (command === 'launch') {
      const provider = rest[0];
      if (!provider) throw new Error('launch requires claude or codex');
      await clientFor(dependencies, false).status();
      return launchAgent(provider, rest.slice(1));
    }
    if (command === 'upgrade') {
      const manifestUrl = option(rest, '--manifest');
      if (!manifestUrl) throw new Error('upgrade requires --manifest <release-manifest-url>');
      const result = await checkUpgrade(identity.version, manifestUrl, currentTarget(), dependencies.fetch ?? fetch);
      if (result.current) output(`HappyHerd ${identity.version} is current.`);
      else {
        output(`HappyHerd ${result.manifest.version} is available for ${result.asset.target}.`);
        output(`Verified installer: ${result.installerUrl}`);
        output(`Expected installer SHA-256: ${result.manifest.installers.find((item) => item.filename === new URL(result.installerUrl).pathname.split('/').pop())?.sha256 ?? 'see release manifest'}`);
      }
      return 0;
    }
    return runHappy(args);
  } catch (error) {
    errorOutput(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
