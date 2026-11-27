/**
 * Drives the built CLI in an isolated home with fake gog, gh, ticktick, brew
 * and npm, and a fake account server that keeps the app's sealed settings.
 */
import { spawn as spawnProcess, spawnSync, type ChildProcess } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn as spawnPty } from '@lydell/node-pty';
import tweetnacl from 'tweetnacl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetupDependencies } from './setup';

const cli = fileURLToPath(new URL('../../bin/happyherd.mjs', import.meta.url));
const packageSkills = fileURLToPath(new URL('../../skills/', import.meta.url));
const services = 'gmail,calendar,drive,docs,sheets,slides,contacts';
const skills = ['happyherd-google-workspace', 'happyherd-github', 'happyherd-ticktick'];
const tokenFragments = ['tkfixture', 'gho_'];
const notLinked = 'Account-level machine control is not linked. Run `happyherd machine auth login` and approve the one-time link in the HappyHerd app.';
const linkStep = `Link account control so the task tracker and each Project's place are kept with the account, then run \`happyherd setup\` again. (${notLinked})`;
const accountToken = 'fixture-account-token';
let directory: string;
let home: string;
let bin: string;
let tools: string;
let state: string;
let accountServer: ChildProcess | undefined;
let accountUrl: string | undefined;
let accountSecret: Uint8Array = new Uint8Array(32);


// One fake executable, copied under each tool name; it records every call.
const fakeTool = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const tool = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const key = args.join(' ');
const state = process.env.FAKE_STATE;
fs.appendFileSync(path.join(state, 'calls.jsonl'), JSON.stringify([tool, ...args]) + '\\n');
const signed = (name) => fs.existsSync(path.join(state, name + '.signed'));
const sign = (name) => fs.writeFileSync(path.join(state, name + '.signed'), '');
if (tool === 'gog' && key === 'auth doctor --check --json --no-input') {
  const checks = [{ name: 'keyring.open', status: 'ok', detail: 'opened' }];
  if (process.env.FAKE_GOG_DOCTOR === 'no-client') {
    checks.push({ name: 'tokens', status: 'ok', detail: '1 readable OAuth token' },
      { name: 'credentials.default', status: 'error', detail: 'OAuth client credentials missing', hint: 'run gog auth credentials FILE' });
  } else if (signed('gog')) {
    checks.push({ name: 'tokens', status: 'ok', detail: '1 readable OAuth token' },
      { name: 'keyring.password', status: 'warn', detail: 'GOG_KEYRING_PASSWORD is not set' });
  } else {
    checks.push({ name: 'tokens', status: 'warn', detail: 'no OAuth tokens stored', hint: 'run gog auth add EMAIL' });
  }
  console.log(JSON.stringify({ checks, status: 'warn' }));
} else if (tool === 'gog' && key === 'auth list --json --no-input') {
  // The stored sign-in's services; all seven unless a test records fewer.
  const file = path.join(state, 'gog.services');
  const services = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split(',') : '${services}'.split(',');
  console.log(JSON.stringify({ accounts: signed('gog') ? [{ email: 'fixture@example.com', services, auth: 'oauth' }] : [] }));
} else if (tool === 'gog' && args[0] === 'auth' && args[1] === 'setup' && args.includes('--login')) {
  sign('gog');
  fs.writeFileSync(path.join(state, 'gog.services'), args[args.indexOf('--services') + 1]);
} else if (tool === 'gh' && key === 'auth status --hostname github.com') {
  if (!signed('gh')) { console.error('You are not logged into any GitHub hosts.'); process.exit(1); }
  console.log('Logged in to github.com account fixture-user\\n  - Token: gho_fixturetoken');
} else if (tool === 'gh' && key === 'auth login --hostname github.com --web') {
  if (process.env.FAKE_GH_LOGIN_WAITS) { console.log('Waiting for the browser'); setInterval(() => {}, 1000); return; }
  sign('gh');
} else if (tool === 'ticktick' && key === 'auth status') {
  console.log(signed('ticktick') ? '\\u2713 Signed in\\n  Token: tkfixture...9xyz' : 'Not signed in\\nRun ticktick auth login to sign in');
} else if (tool === 'ticktick' && key === 'auth login') {
  sign('ticktick');
} else if (tool === 'brew' || tool === 'npm') {
  const installed = { 'install openclaw/tap/gogcli': 'gog', 'install gh': 'gh', 'install --global @ticktick/ticktick-cli': 'ticktick' }[key];
  if (!installed || process.env.FAKE_INSTALL_FAIL === installed) { console.log('install failed'); process.exit(1); }
  console.log('installing ' + installed);
  const target = path.join(path.dirname(process.argv[1]), installed);
  fs.copyFileSync(path.join(process.env.FAKE_TOOLS, 'tool'), target);
  fs.chmodSync(target, 0o755);
} else {
  process.exit(64);
}
`;

// The account settings endpoints, with the server's version check, and an empty
// Project list. `concurrent` stands for an app save that lands before setup's;
// a path in `stall` is accepted and never answered.
const fakeAccountServer = `
const http = require('node:http');
const fs = require('node:fs');
const [stateFile, portFile] = process.argv.slice(2);
http.createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    const account = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    account.requests.push(request.method + ' ' + request.url);
    if ((account.stall || []).includes(request.url)) return fs.writeFileSync(stateFile, JSON.stringify(account));
    const send = (code, value) => {
      fs.writeFileSync(stateFile, JSON.stringify(account));
      // In-process setup shares a fetch pool across synchronous CLI calls.
      // Do not leave idle fixture sockets to expire while that event loop is blocked.
      response.writeHead(code, { 'content-type': 'application/json', connection: 'close' });
      response.end(JSON.stringify(value));
    };
    if (request.headers.authorization !== 'Bearer ' + account.token) return send(401, { error: 'Invalid token' });
    if (request.method === 'GET' && request.url === '/v1/account/settings') {
      return send(200, { settings: account.settings, settingsVersion: account.version });
    }
    if (request.method === 'POST' && request.url === '/v1/account/settings') {
      if (account.concurrent) {
        account.settings = account.concurrent;
        account.version += 1;
        delete account.concurrent;
      }
      const update = JSON.parse(body);
      if (update.expectedVersion !== account.version) {
        return send(200, { success: false, error: 'version-mismatch', currentVersion: account.version, currentSettings: account.settings });
      }
      account.settings = update.settings;
      account.version += 1;
      return send(200, { success: true, version: account.version });
    }
    if (request.method === 'GET' && request.url === '/v1/projects') return send(200, { projects: [] });
    send(404, { error: 'Not found' });
  });
}).listen(0, '127.0.0.1', function () { fs.writeFileSync(portFile, String(this.address().port)); });
`;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'happyherd-setup-'));
  home = path.join(directory, 'home');
  bin = path.join(directory, 'bin');
  tools = path.join(directory, 'tools');
  state = path.join(directory, 'state');
  for (const folder of [home, bin, tools, state]) await mkdir(folder, { recursive: true });
  await writeFile(path.join(tools, 'tool'), fakeTool);
});

afterEach(async () => {
  accountServer?.kill();
  accountServer = undefined;
  accountUrl = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

async function install(...names: string[]) {
  for (const name of names) {
    await copyFile(path.join(tools, 'tool'), path.join(bin, name));
    await chmod(path.join(bin, name), 0o755);
  }
}

async function signIn(...names: string[]) {
  for (const name of names) await writeFile(path.join(state, `${name}.signed`), '');
}

// A minimal environment: nothing from the parent session, its homes or its tokens.
function env(extra: Record<string, string> = {}): Record<string, string> {
  return {
    HOME: home,
    PATH: bin,
    HAPPYHERD_HOME_DIR: path.join(home, '.happyherd'),
    HAPPYHERD_VARIANT: 'stable',
    HAPPYHERD_SERVER_URL: accountUrl ?? 'http://127.0.0.1:9',
    FAKE_STATE: state,
    FAKE_TOOLS: tools,
    ...extra,
  };
}

function run(args: string[], extra: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: directory, env: env(extra), encoding: 'utf8', timeout: 30_000 });
  for (const fragment of tokenFragments) expect(result.stdout + result.stderr).not.toContain(fragment);
  return result;
}

function runJson(args: string[], extra: Record<string, string> = {}) {
  const result = run([...args, '--json'], extra);
  return { status: result.status, stderr: result.stderr, report: JSON.parse(result.stdout) };
}

/** Runs the CLI in a pseudo-terminal and types each answer when its prompt appears. */
function runInTerminal(args: string[], answers: [RegExp, string][], extra: Record<string, string> = {}, launch: string[] = [cli]): Promise<{ status: number; output: string }> {
  return new Promise((resolve, reject) => {
    const terminal = spawnPty(process.execPath, [...launch, ...args], { name: 'xterm-256color', cols: 200, rows: 60, cwd: directory, env: env(extra) });
    let output = '';
    let searched = 0;
    const timer = setTimeout(() => { terminal.kill(); reject(new Error(`No exit. Output:\n${output}`)); }, 30_000);
    terminal.onData((data) => {
      output += data;
      const [prompt, answer] = answers[0] ?? [];
      if (prompt && prompt.test(output.slice(searched))) {
        answers.shift();
        searched = output.length;
        terminal.write(answer === '\x03' ? answer : `${answer}\r`);
      }
    });
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timer);
      for (const fragment of tokenFragments) expect(output).not.toContain(fragment);
      resolve({ status: exitCode, output });
    });
  });
}

async function calls(): Promise<string[][]> {
  const file = path.join(state, 'calls.jsonl');
  if (!existsSync(file)) return [];
  return (await readFile(file, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
}

function skillPath(root: string, skill: string) {
  return path.join(home, root, skill, 'SKILL.md');
}

// The app's format: base64 of a nonce and the NaCl secretbox of the JSON, with the account secret.
function seal(settings: unknown): string {
  const nonce = tweetnacl.randomBytes(tweetnacl.secretbox.nonceLength);
  return Buffer.concat([nonce, tweetnacl.secretbox(new TextEncoder().encode(JSON.stringify(settings)), nonce, accountSecret)]).toString('base64');
}

function unseal(sealed: string): unknown {
  const bytes = Buffer.from(sealed, 'base64');
  const nonceLength = tweetnacl.secretbox.nonceLength;
  const opened = tweetnacl.secretbox.open(bytes.subarray(nonceLength), bytes.subarray(0, nonceLength), accountSecret);
  if (!opened) throw new Error('The stored settings do not open with the account secret');
  return JSON.parse(new TextDecoder().decode(opened));
}

/** Links account control for this home and starts the account server, optionally with settings. */
async function startAccount(settings?: Record<string, unknown>, concurrent?: Record<string, unknown>, stall: string[] = []) {
  accountSecret = tweetnacl.randomBytes(32);
  await mkdir(path.join(home, '.happyherd'), { recursive: true });
  await writeFile(path.join(home, '.happyherd', 'agent.key'), JSON.stringify({ token: accountToken, secret: Buffer.from(accountSecret).toString('base64') }));
  const stateFile = path.join(directory, 'account.json');
  const portFile = path.join(directory, 'account.port');
  await writeFile(stateFile, JSON.stringify({
    token: accountToken,
    settings: settings ? seal(settings) : null,
    version: settings ? 1 : 0,
    requests: [],
    stall,
    ...(concurrent ? { concurrent: seal(concurrent) } : {}),
  }));
  await writeFile(path.join(directory, 'account-server.cjs'), fakeAccountServer);
  accountServer = spawnProcess(process.execPath, [path.join(directory, 'account-server.cjs'), stateFile, portFile], { stdio: 'ignore' });
  for (let attempt = 0; !(existsSync(portFile) && (await readFile(portFile, 'utf8')).trim()); attempt++) {
    if (attempt > 200) throw new Error('The fake account server did not start');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  accountUrl = `http://127.0.0.1:${(await readFile(portFile, 'utf8')).trim()}`;
}

async function account(): Promise<{ settings: Record<string, any> | null; version: number; requests: string[] }> {
  const stored = JSON.parse(await readFile(path.join(directory, 'account.json'), 'utf8'));
  return { settings: stored.settings ? unseal(stored.settings) as Record<string, any> : null, version: stored.version, requests: stored.requests };
}

/** Runs the setup handler in this process, with the Project list and the terminal answers given. */
async function setupInProcess(args: string[], dependencies: SetupDependencies): Promise<{ status: number; output: string }> {
  for (const [key, value] of Object.entries(env())) vi.stubEnv(key, value);
  vi.stubEnv('CLAUDE_CONFIG_DIR', undefined);
  vi.stubEnv('CODEX_HOME', undefined);
  vi.resetModules();
  const lines: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((value?: unknown) => { lines.push(String(value)); });
  const previous = process.exitCode;
  process.exitCode = undefined;
  try {
    const { handleSetupCommand } = await import('./setup');
    await handleSetupCommand(args, dependencies);
    return { status: Number(process.exitCode ?? 0), output: lines.join('\n') };
  } finally {
    process.exitCode = previous;
    log.mockRestore();
    vi.unstubAllEnvs();
  }
}

/** Answers each terminal question in order; an unexpected question fails the test. */
function answers(script: [RegExp, string | undefined][]): (question: string) => Promise<string | undefined> {
  return async (question) => {
    const [expected, answer] = script.shift() ?? [];
    if (!expected?.test(question)) throw new Error(`Unexpected question: ${question}`);
    return answer;
  };
}

const signInCall = (call: string[]) => call.includes('login') || call.includes('--login');
const machineSettings = () => path.join(home, '.happyherd', 'settings.json');

describe('happyherd setup', () => {
  it('names each install step, and the account-control link for the tracker, when nothing is set up', async () => {
    const { status, report } = runJson(['setup']);
    expect(status).toBe(2);
    expect(report.status).toBe('action-required');
    expect(report.integrations.map(({ name, tool, state: integrationState, skillInstalled }: Record<string, unknown>) => [name, tool, integrationState, skillInstalled])).toEqual([
      ['google-workspace', 'gog', 'not-installed', false],
      ['github', 'gh', 'not-installed', false],
      ['ticktick', 'ticktick', 'not-installed', false],
    ]);
    expect(report.tracker).toBeNull();
    expect(report.skillProviders).toEqual(['claude']);
    expect(report.nextSteps).toEqual([
      'Install gog (brew install openclaw/tap/gogcli, or download gog from https://github.com/openclaw/gogcli/releases), then run `happyherd setup google-workspace`.',
      'Install gh (see https://cli.github.com for your system), then run `happyherd setup github`.',
      'Install ticktick (install Node.js 20 or later, then run npm install --global @ticktick/ticktick-cli), then run `happyherd setup ticktick`.',
      linkStep,
    ]);
    expect(existsSync(path.join(home, '.claude'))).toBe(false);

    const text = run(['setup']);
    expect(text.status).toBe(2);
    expect(text.stdout).toContain('google-workspace  gog       not installed');
    expect(text.stdout).toContain('Task tracker: unknown');
    expect(text.stdout).toContain('Next steps:\n- Install gog');
  }, 60_000);

  it('installs missing tools and skills without starting a sign-in when no terminal is attached', async () => {
    await install('brew', 'npm');
    await mkdir(path.join(home, '.codex'));
    const { status, report, stderr } = runJson(['setup']);
    expect(status).toBe(2);
    expect(stderr).toContain('installing gog');
    expect((await calls()).filter(([tool]) => tool === 'brew' || tool === 'npm')).toEqual([
      ['brew', 'install', 'openclaw/tap/gogcli'],
      ['brew', 'install', 'gh'],
      ['npm', 'install', '--global', '@ticktick/ticktick-cli'],
    ]);
    expect((await calls()).some(signInCall)).toBe(false);
    expect(report.integrations.map(({ state: integrationState }: { state: string }) => integrationState)).toEqual(['not-signed-in', 'not-signed-in', 'not-signed-in']);
    expect(report.integrations[0].detail).toBe('gog: no OAuth tokens stored; run gog auth add EMAIL');
    expect(report.skillProviders).toEqual(['claude', 'codex']);
    for (const skill of skills) {
      const source = await readFile(path.join(packageSkills, skill, 'SKILL.md'), 'utf8');
      expect(source).toMatch(new RegExp(`^---\\nname: ${skill}\\ndescription: .+\\n---\\n`));
      expect(await readFile(skillPath('.claude/skills', skill), 'utf8')).toBe(source);
      expect(await readFile(skillPath('.codex/skills', skill), 'utf8')).toBe(source);
    }
    expect(existsSync(path.join(home, '.gemini'))).toBe(false);
    expect(report.nextSteps).toEqual([
      'Run `happyherd setup google-workspace` in a terminal on this machine and finish the Google Workspace sign-in in your browser. It asks for your Google account. If gog asks for an OAuth client, follow its steps, then run `happyherd setup google-workspace --credentials FILE`. (gog: no OAuth tokens stored; run gog auth add EMAIL)',
      'Run `happyherd setup github` in a terminal on this machine and finish the GitHub sign-in in your browser. (gh: a github.com account has no working sign-in, or GitHub could not be reached)',
      'Run `happyherd setup ticktick` in a terminal on this machine and finish the TickTick sign-in in your browser. (ticktick: no sign-in is stored)',
      linkStep,
    ]);
  }, 60_000);

  it('names the install step when the package manager fails', async () => {
    await install('brew', 'npm');
    const { status, report } = runJson(['setup', 'github'], { FAKE_INSTALL_FAIL: 'gh' });
    expect(status).toBe(2);
    expect(report.integrations).toEqual([{ name: 'github', title: 'GitHub', tool: 'gh', state: 'not-installed', skillInstalled: false }]);
    expect(report.nextSteps).toEqual(['Install gh (see https://cli.github.com for your system), then run `happyherd setup github`.']);
  }, 60_000);

  it('saves the tracker with the account, keeps the app settings, then skips what is ready', async () => {
    await install('gog', 'gh', 'ticktick', 'brew', 'npm');
    await signIn('gog', 'gh', 'ticktick');
    await mkdir(path.join(home, '.gemini', 'antigravity'), { recursive: true });
    await mkdir(path.dirname(skillPath('.claude/skills', 'happyherd-github')), { recursive: true });
    await writeFile(skillPath('.claude/skills', 'happyherd-github'), 'an older copy');
    await writeFile(path.join(home, '.claude', 'skills', 'unrelated.md'), 'kept');
    await startAccount({ schemaVersion: 2, experiments: true });

    const first = runJson(['setup', '--tracker', 'ticktick']);
    expect(first.status).toBe(0);
    expect(first.report).toMatchObject({ status: 'ready', tracker: 'ticktick', nextSteps: [], skillProviders: ['claude', 'agy'] });
    expect(await account()).toMatchObject({ settings: { schemaVersion: 2, experiments: true, taskTracker: 'ticktick' }, version: 2 });
    expect(existsSync(machineSettings())).toBe(false);
    const source = await readFile(path.join(packageSkills, 'happyherd-github', 'SKILL.md'), 'utf8');
    expect(await readFile(skillPath('.claude/skills', 'happyherd-github'), 'utf8')).toBe(source);
    expect(await readFile(skillPath('.gemini/config/skills', 'happyherd-github'), 'utf8')).toBe(source);
    expect(await readFile(path.join(home, '.claude', 'skills', 'unrelated.md'), 'utf8')).toBe('kept');

    const second = runJson(['setup']);
    expect(second.status).toBe(0);
    expect(second.report).toMatchObject({ status: 'ready', tracker: 'ticktick', nextSteps: [] });
    expect((await account()).version).toBe(2);
    expect((await calls()).every(([, ...args]) => ['status', 'doctor', 'list'].some((action) => args.includes(action)))).toBe(true);

    expect(runJson(['setup', '--tracker', 'github']).report.tracker).toBe('github');
    expect(await account()).toMatchObject({ settings: { experiments: true, taskTracker: 'github' }, version: 3 });
    expect(runJson(['tracker', 'show']).report).toEqual({ tracker: 'github', projects: [] });
    expect(run(['tracker', 'show']).stdout.trim()).toBe('github');
  }, 60_000);

  it('saves onto the newest account settings when the app saved them meanwhile', async () => {
    await install('gog', 'gh', 'ticktick');
    await signIn('gog', 'gh', 'ticktick');
    await startAccount({ schemaVersion: 2, experiments: true }, { schemaVersion: 2, experiments: false, viewInline: true });
    expect(runJson(['setup', '--tracker', 'github']).status).toBe(0);
    const stored = await account();
    expect(stored.settings).toEqual({ schemaVersion: 2, experiments: false, viewInline: true, taskTracker: 'github' });
    expect(stored.version).toBe(3);
    expect(stored.requests.filter((request) => request === 'POST /v1/account/settings')).toHaveLength(2);
  }, 60_000);

  it('sets up one integration without the tracker question', async () => {
    await install('gh');
    await signIn('gh');
    const { status, report } = runJson(['setup', 'github']);
    expect(status).toBe(0);
    expect(report).toEqual({
      status: 'ready',
      integrations: [{ name: 'github', title: 'GitHub', tool: 'gh', state: 'ready', skillInstalled: true }],
      tracker: null,
      skillProviders: ['claude'],
      nextSteps: [],
    });
    expect(await calls()).toEqual([['gh', 'auth', 'status', '--hostname', 'github.com']]);
  }, 60_000);

  it('walks every integration in a terminal: sign-ins with the Google options, then the tracker', async () => {
    await install('gog', 'gh', 'ticktick');
    await startAccount();
    const result = await runInTerminal(
      ['setup', '--credentials', 'client.json', '--gcloud-project', 'fixture-project', '--enable-apis'],
      [
        [/Google account to sign in/, 'user@example.com'],
        [/Start the GitHub sign-in in your browser\? \(Y\/n\)/, ''],
        [/Start the TickTick sign-in in your browser\? \(Y\/n\)/, 'y'],
        [/Task tracker \(ticktick or github/, 'GitHub'],
      ],
    );
    expect(result.status, result.output).toBe(0);
    expect((await calls()).filter(signInCall)).toEqual([
      ['gog', 'auth', 'setup', 'user@example.com', '--services', services, '--login', '--gcloud-project', 'fixture-project', '--enable-apis', '--credentials', 'client.json'],
      ['gh', 'auth', 'login', '--hostname', 'github.com', '--web'],
      ['ticktick', 'auth', 'login'],
    ]);
    expect((await account()).settings).toEqual({ taskTracker: 'github' });
    expect(result.output).toContain('GitHub (gh): ready');
    expect(result.output).toContain('Task tracker: github');
    expect(result.output).toContain('Usage skills installed for: claude');
  }, 60_000);

  it('keeps or changes the saved tracker when setup runs again in a terminal', async () => {
    await install('gog', 'gh', 'ticktick');
    await signIn('gog', 'gh', 'ticktick');
    await startAccount({ taskTracker: 'ticktick' });

    const kept = await runInTerminal(['setup'], [[/Task tracker \(ticktick or github, empty keeps ticktick\)/, '']]);
    expect(kept.status, kept.output).toBe(0);
    expect(await account()).toMatchObject({ settings: { taskTracker: 'ticktick' }, version: 1 });

    const changed = await runInTerminal(['setup'], [[/Task tracker \(ticktick or github, empty keeps ticktick\)/, 'github']]);
    expect(changed.status, changed.output).toBe(0);
    expect(await account()).toMatchObject({ settings: { taskTracker: 'github' }, version: 2 });
    expect(changed.output).toContain('Task tracker: github');
    expect((await calls()).some(signInCall)).toBe(false);
  }, 60_000);

  it('lets the User skip each sign-in in a terminal, and asks no tracker it cannot save', async () => {
    await install('gog', 'gh', 'ticktick');
    const result = await runInTerminal(['setup'], [
      [/Google account to sign in/, ''],
      [/Start the GitHub sign-in/, '\x03'],
      [/Start the TickTick sign-in/, 'n'],
    ]);
    expect(result.status, result.output).toBe(2);
    expect((await calls()).some(signInCall)).toBe(false);
    for (const label of ['Google Workspace (gog)', 'GitHub (gh)', 'TickTick (ticktick)']) {
      expect(result.output.split(`${label}: not signed in`)).toHaveLength(2);
    }
    expect(result.output).not.toContain('Task tracker (');
    expect(result.output).toContain('- Run `happyherd setup google-workspace` in a terminal');
    expect(result.output).toContain('- Link account control');
    expect(existsSync(machineSettings())).toBe(false);
  }, 60_000);

  it('stops entirely when Ctrl+C reaches a running sign-in', async () => {
    await install('gh');
    // Like a shell, this stand-in survives Ctrl+C and keeps the terminal open for two seconds afterwards.
    const shell = 'process.on("SIGINT", () => {}); require("node:child_process").spawn(process.execPath, process.argv.slice(1), { stdio: "inherit" })'
      + '.on("exit", () => setTimeout(() => process.exit(0), 2000));';
    await runInTerminal(['setup', 'github'], [[/Start the GitHub sign-in/, ''], [/Waiting for the browser/, '\x03']], { FAKE_GH_LOGIN_WAITS: '1' }, ['-e', shell, cli]);
    // No setup process carries on after Ctrl+C: nothing checks gh again.
    expect(await calls()).toEqual([
      ['gh', 'auth', 'status', '--hostname', 'github.com'],
      ['gh', 'auth', 'login', '--hostname', 'github.com', '--web'],
    ]);
  }, 60_000);

  it('rejects unknown names, trackers, misplaced options, and picks it cannot save', async () => {
    expect(runJson(['setup', 'linear'])).toMatchObject({ status: 1, report: { error: 'Unknown integration: linear. Choose google-workspace, github or ticktick.' } });
    expect(runJson(['setup', '--tracker', 'linear'])).toMatchObject({ status: 1, report: { error: 'Unknown task tracker: linear. Choose ticktick or github.' } });
    expect(runJson(['setup', 'github', '--credentials', 'client.json']).status).toBe(1);
    expect(runJson(['setup', '--project', 'Alpha'])).toMatchObject({ status: 1, report: { error: '--project and --place go together.' } });
    expect(runJson(['setup', '--place', 'Work'])).toMatchObject({ status: 1, report: { error: '--project and --place go together.' } });
    // Without the account-control link nothing can be saved with the account, and nothing is saved on the machine.
    expect(runJson(['setup', '--tracker', 'ticktick'])).toMatchObject({ status: 1, report: { error: notLinked } });
    expect(runJson(['setup', '--project', 'Alpha', '--place', 'Work'])).toMatchObject({ status: 1, report: { error: notLinked } });
    expect(runJson(['tracker', 'show'])).toMatchObject({ status: 1, report: { error: notLinked } });
    expect(existsSync(machineSettings())).toBe(false);

    await startAccount({ schemaVersion: 2 });
    expect(runJson(['setup', '--project', 'Alpha', '--place', 'Work'])).toMatchObject({
      status: 1, report: { error: 'Choose the task tracker with --tracker ticktick or --tracker github before a place.' },
    });
    expect(runJson(['setup', '--tracker', 'github', '--project', 'Alpha', '--place', 'octo'])).toMatchObject({
      status: 1, report: { error: 'A GitHub repository place looks like OWNER/REPO.' },
    });
    expect(runJson(['setup', '--tracker', 'ticktick', '--project', 'Alpha', '--place', 'Work'])).toMatchObject({
      status: 1, report: { error: 'No Project Alpha in this account. Run happyherd project list.' },
    });
    expect(await account()).toMatchObject({ settings: { schemaVersion: 2 }, version: 1 });
    expect((await account()).requests).not.toContain('POST /v1/account/settings');

    const text = run(['tracker', 'show', 'extra']);
    expect(text.status).toBe(1);
    expect(text.stderr).toContain('Usage: happyherd tracker show [--project PROJECT] [--json]');
    expect(await calls()).toEqual([]);
  }, 60_000);

  it('stops waiting for a Project list that does not come, and names it', async () => {
    await install('gog', 'gh', 'ticktick');
    await signIn('gog', 'gh', 'ticktick');
    await startAccount({ taskTracker: 'ticktick' }, undefined, ['/v1/projects']);
    const started = Date.now();
    const { status, report } = runJson(['setup']);
    expect(status).toBe(2);
    expect(report.nextSteps).toHaveLength(1);
    expect(report.nextSteps[0]).toMatch(/^List the account's Projects to choose where each keeps its tasks, then run `happyherd setup` again\. \(.*timeout of 15000ms exceeded\)$/);
    expect(Date.now() - started).toBeLessThan(28_000);
  }, 60_000);

  it('stops waiting for account settings that do not come, and names it', async () => {
    await startAccount({ taskTracker: 'ticktick' }, undefined, ['/v1/account/settings']);
    expect(runJson(['tracker', 'show'])).toMatchObject({ status: 1, report: { error: 'The HappyHerd server did not answer within 15 seconds.' } });
  }, 60_000);

  it('counts Google Workspace as ready only when the sign-in grants all seven services', async () => {
    await install('gog');
    await signIn('gog');
    await writeFile(path.join(state, 'gog.services'), 'gmail,calendar,drive,docs,sheets,contacts');
    const lacking = runJson(['integration', 'check', 'google-workspace']);
    expect(lacking.status).toBe(2);
    expect(lacking.report.integrations[0]).toMatchObject({ state: 'not-signed-in', detail: 'gog: the stored sign-in lacks slides' });

    // Signing in again asks Google for a new consent that covers every service.
    const result = await runInTerminal(['setup', 'google-workspace'], [[/Google account to sign in/, 'user@example.com']]);
    expect(result.status, result.output).toBe(0);
    expect((await calls()).filter(signInCall)).toEqual([
      ['gog', 'auth', 'setup', 'user@example.com', '--services', services, '--login', '--force-consent'],
    ]);
    expect(runJson(['integration', 'check', 'google-workspace']).status).toBe(0);
  }, 60_000);

  it.skipIf(process.getuid?.() === 0)('reports a skills folder it cannot write and goes on', async () => {
    await install('gog', 'gh', 'ticktick');
    await signIn('gog', 'gh', 'ticktick');
    await startAccount();
    const folder = path.join(home, '.claude', 'skills');
    await mkdir(folder, { recursive: true });
    await chmod(folder, 0o555);
    try {
      const { status, report } = runJson(['setup', '--tracker', 'github']);
      expect(status).toBe(2);
      expect((await account()).settings).toEqual({ taskTracker: 'github' });
      for (const integration of report.integrations) {
        expect(integration).toMatchObject({ state: 'ready', skillInstalled: false });
        expect(integration.skillError).toMatch(/^EACCES: permission denied, mkdir '.+\/happyherd-/);
      }
      expect(report.nextSteps.map((step: string) => step.split(':')[0])).toEqual(['Copy the gog usage skill', 'Copy the gh usage skill', 'Copy the ticktick usage skill']);
      expect(report.nextSteps[1]).toMatch(/\. Make that folder writable, then run `happyherd setup github`\.$/);
    } finally {
      await chmod(folder, 0o755);
    }
  }, 60_000);

  it('prints help without running any tool', async () => {
    for (const args of [['setup', '--help'], ['integration'], ['integration', '--help'], ['tracker'], ['tracker', '--help']]) {
      const result = run(args);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Usage:');
      expect(result.stderr).toBe('');
    }
    const setupHelp = run(['setup', '--help']).stdout;
    expect(setupHelp).toContain('Onboarding checklist: https://raw.githubusercontent.com/NickGuAI/HappyHerd/main/docs/onboarding.md');
    expect(setupHelp).toContain('happyherd setup [NAME] --project PROJECT --place PLACE [--tracker ticktick|github] [--json]');
    expect(setupHelp).toContain('Both are kept with the account');
    expect(run(['tracker', '--help']).stdout).toContain('happyherd tracker show [--project PROJECT] [--json]');
    expect(await calls()).toEqual([]);
  }, 60_000);
});

describe("the place of each Project's tasks", () => {
  const alpha = { id: 'p1', name: 'Alpha' };
  const beta = { id: 'p2', name: 'Beta' };

  it('asks for each place in a terminal, names the missing ones for agents, and shows them', async () => {
    await install('gog', 'gh', 'ticktick');
    await signIn('gog', 'gh', 'ticktick');
    await startAccount({ schemaVersion: 2 });
    const listProjects = async () => [alpha, beta];
    const first = await setupInProcess([], {
      interactive: true,
      listProjects,
      ask: answers([
        [/^Task tracker \(ticktick or github, empty to choose later\): $/, 'ticktick'],
        [/^TickTick list for Project Alpha \(empty skips\): $/, 'Work'],
        [/^TickTick list for Project Beta \(empty skips\): $/, ''],
      ]),
    });
    expect(first.status).toBe(2);
    expect(first.output).toContain("- Choose the TickTick list for Project Beta's tasks: `happyherd setup --project p2 --place LIST`.");
    expect((await account()).settings).toEqual({
      schemaVersion: 2,
      taskTracker: 'ticktick',
      taskPlaces: { ticktick: { p1: { name: 'Alpha', place: 'Work' }, p2: { name: 'Beta' } } },
    });

    // An agent sets the last place by name, without a question.
    const agent = await setupInProcess(['--project', 'Beta', '--place', 'Home', '--json'], { interactive: false, listProjects });
    expect(agent.status).toBe(0);
    expect(JSON.parse(agent.output)).toMatchObject({ status: 'ready', tracker: 'ticktick', nextSteps: [] });
    expect(runJson(['tracker', 'show']).report).toEqual({
      tracker: 'ticktick',
      projects: [{ id: 'p1', name: 'Alpha', place: 'Work' }, { id: 'p2', name: 'Beta', place: 'Home' }],
    });
    expect(runJson(['tracker', 'show', '--project', 'Alpha']).report).toEqual({ tracker: 'ticktick', project: { id: 'p1', name: 'Alpha', place: 'Work' } });
    expect(runJson(['tracker', 'show', '--project', 'p2']).report.project).toEqual({ id: 'p2', name: 'Beta', place: 'Home' });
    expect(runJson(['tracker', 'show', '--project', 'Gamma']).report).toEqual({ tracker: 'ticktick', project: null });
    expect(run(['tracker', 'show']).stdout.trim()).toBe('ticktick\nAlpha: Work\nBeta: Home');

    // A renamed Project keeps its place; a Project that left the account is dropped.
    const later = await setupInProcess(['--json'], { interactive: false, listProjects: async () => [{ id: 'p2', name: 'Beta Two' }] });
    expect(later.status, later.output).toBe(0);
    expect((await account()).settings?.taskPlaces).toEqual({ ticktick: { p2: { name: 'Beta Two', place: 'Home' } } });
    expect(existsSync(machineSettings())).toBe(false);
  }, 60_000);

  it('keeps the places of each tracker apart and asks again until a GitHub place is OWNER/REPO', async () => {
    await install('gog', 'gh', 'ticktick');
    await signIn('gog', 'gh', 'ticktick');
    await startAccount({ taskTracker: 'ticktick', taskPlaces: { ticktick: { p1: { name: 'Alpha', place: 'Work' } } } });
    const listProjects = async () => [alpha];
    const github = await setupInProcess([], {
      interactive: true,
      listProjects,
      ask: answers([
        [/^Task tracker \(ticktick or github, empty keeps ticktick\): $/, 'github'],
        [/^GitHub repository \(OWNER\/REPO\) for Project Alpha \(empty skips\): $/, 'not a repository'],
        [/^GitHub repository \(OWNER\/REPO\) for Project Alpha \(empty skips\): $/, 'octo/tasks'],
      ]),
    });
    expect(github.status).toBe(0);
    expect((await account()).settings).toEqual({
      taskTracker: 'github',
      taskPlaces: { ticktick: { p1: { name: 'Alpha', place: 'Work' } }, github: { p1: { name: 'Alpha', place: 'octo/tasks' } } },
    });

    const version = (await account()).version;
    const again = await setupInProcess([], {
      interactive: true,
      listProjects,
      ask: answers([
        [/^Task tracker \(ticktick or github, empty keeps github\): $/, undefined],
        [/^GitHub repository \(OWNER\/REPO\) for Project Alpha \(empty keeps octo\/tasks\): $/, ''],
      ]),
    });
    expect(again.status).toBe(0);
    expect((await account()).version).toBe(version);
  }, 60_000);

  it('saves a given place without asking, even in a terminal', async () => {
    await install('gog', 'gh', 'ticktick');
    await signIn('gog', 'gh', 'ticktick');
    await startAccount({ taskTracker: 'ticktick' });
    const result = await setupInProcess(['--project', 'Alpha', '--place', 'Work'], { interactive: true, listProjects: async () => [alpha, beta], ask: answers([]) });
    expect(result.status).toBe(2);
    expect(result.output).toContain("- Choose the TickTick list for Project Beta's tasks: `happyherd setup --project p2 --place LIST`.");
    expect((await account()).settings?.taskPlaces).toEqual({ ticktick: { p1: { name: 'Alpha', place: 'Work' }, p2: { name: 'Beta' } } });
  }, 60_000);

  it('names the Project list problem when the Projects cannot be listed', async () => {
    await install('gog', 'gh', 'ticktick');
    await signIn('gog', 'gh', 'ticktick');
    await startAccount();
    const result = await setupInProcess(['--tracker', 'ticktick', '--json'], {
      interactive: false,
      listProjects: async () => { throw new Error('The HappyHerd server could not be reached.'); },
    });
    expect(result.status).toBe(2);
    expect(JSON.parse(result.output).nextSteps).toEqual([
      "List the account's Projects to choose where each keeps its tasks, then run `happyherd setup` again. (The HappyHerd server could not be reached.)",
    ]);
    expect((await account()).settings).toEqual({ taskTracker: 'ticktick' });
  }, 60_000);
});

describe('happyherd integration', () => {
  it('lists each state and the tracker without changing anything', async () => {
    await install('gh', 'ticktick', 'brew', 'npm');
    await signIn('ticktick');
    const { status, report } = runJson(['integration', 'list']);
    expect(status).toBe(0);
    expect(report.integrations.map(({ name, state: integrationState }: Record<string, string>) => [name, integrationState])).toEqual([
      ['google-workspace', 'not-installed'],
      ['github', 'not-signed-in'],
      ['ticktick', 'ready'],
    ]);
    expect(report.integrations[0]).not.toHaveProperty('skillInstalled');
    expect(report.tracker).toBeNull();
    expect(report.nextSteps[0]).toBe('Run `happyherd setup google-workspace` to install gog and its usage skill.');
    expect(report.nextSteps.at(-1)).toBe(linkStep);
    expect((await calls()).filter(([tool]) => tool === 'brew' || tool === 'npm')).toEqual([]);
    expect(existsSync(path.join(home, '.claude'))).toBe(false);
    expect(existsSync(machineSettings())).toBe(false);

    const text = run(['integration', 'list']);
    expect(text.status).toBe(0);
    expect(text.stdout).toContain('ticktick          ticktick  ready');

    await startAccount({ taskTracker: 'github' });
    const linked = runJson(['integration', 'list']);
    expect(linked.report.tracker).toBe('github');
    expect(linked.report.nextSteps).not.toContain(linkStep);
    expect((await account()).requests).toEqual(['GET /v1/account/settings']);
  }, 60_000);

  it('checks one integration and exits 0 only when it is ready', async () => {
    await install('ticktick', 'gog');
    expect(runJson(['integration', 'check', 'ticktick'])).toMatchObject({ status: 2, report: { status: 'action-required' } });
    await signIn('ticktick');
    expect(runJson(['integration', 'check', 'ticktick'])).toMatchObject({ status: 0, report: { status: 'ready', nextSteps: [] } });
    expect(run(['integration', 'check', 'ticktick']).stdout).toContain('ticktick          ticktick  ready');

    await signIn('gog');
    expect(runJson(['integration', 'check', 'google-workspace']).report.integrations[0].state).toBe('ready');
    const missingClient = runJson(['integration', 'check', 'google-workspace'], { FAKE_GOG_DOCTOR: 'no-client' });
    expect(missingClient.status).toBe(2);
    expect(missingClient.report.integrations[0]).toMatchObject({
      state: 'not-signed-in',
      detail: 'gog: OAuth client credentials missing; run gog auth credentials FILE',
    });
  }, 60_000);
});
