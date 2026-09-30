// Isolated acceptance process only. Copy beside run-web-acceptance.mjs before use.
// Master secret exists only in this process and its own server child's environment.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const directory = resolve(process.env.HH345_ARTIFACT_DIR || dirname(fileURLToPath(import.meta.url)));
const root = resolve(process.env.HH345_REPO_ROOT || resolve(directory, '../../..'));
const serverRoot = resolve(root, 'server');
const packageDir = resolve(serverRoot, 'packages/happyherd-server');
const dataDir = resolve(directory, 'server-data');
const sourceSha = process.env.HH345_SOURCE_SHA;
assert.match(sourceSha || '', /^[a-f0-9]{40}$/);
const receipt = { sourceSha, startedAt: new Date().toISOString(), migrationNames: [], restarts: 0, events: [] };
let child, restarting = false, stopping = false, migrating = true;
const childEnvironment = {
    PATH: process.env.PATH, NODE_ENV: 'production', TZ: 'UTC',
    TMPDIR: process.env.RUNNER_TEMP || process.env.TMPDIR || '/tmp',
    DB_PROVIDER: 'pglite', DATA_DIR: dataDir, PGLITE_DIR: resolve(dataDir, 'pglite'),
    HOST: '127.0.0.1', PORT: '43546', PUBLIC_URL: 'http://127.0.0.1:43545',
    HAPPYHERD_STATIC_DIR: resolve(process.env.HH345_WEB_DIST || resolve(directory, 'web-dist')),
    HAPPYHERD_INJECT_HTML_CONFIG: JSON.stringify({ serverUrl: 'http://127.0.0.1:43545', disableAnalytics: true }),
    METRICS_ENABLED: 'false', HANDY_MASTER_SECRET: randomBytes(32).toString('hex'),
};
function save() {
    const path = resolve(directory, 'server-runner-receipt.json');
    writeFileSync(path + '.tmp', JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
    renameSync(path + '.tmp', path);
}
function event(type, extra = {}) {
    const item = { type, at: new Date().toISOString(), ...extra };
    receipt.events.push(item); save();
    // Only explicit process status metadata; never forward server stdout/stderr.
    process.send?.(item);
}
function launch(command) {
    child = spawn(process.execPath, ['--import', resolve(serverRoot, 'node_modules/tsx/dist/loader.mjs'),
        'sources/standalone.ts', command], { cwd: packageDir, env: childEnvironment, stdio: ['ignore', 'pipe', 'pipe'] });
    const selected = child;
    if (command === 'serve') writeFileSync(resolve(directory, 'server.pid'), `${selected.pid}\n`, { mode: 0o600 });
    for (const stream of [selected.stdout, selected.stderr]) {
        const lines = createInterface({ input: stream });
        lines.on('line', line => {
            if (command !== 'migrate') return;
            const migration = /^  Applying ([a-zA-Z0-9_]+)\.\.\.$/.exec(line);
            if (migration) receipt.migrationNames.push(migration[1]);
            const complete = /^Applied (\d+) migration\(s\)\.$/.exec(line);
            if (complete) receipt.appliedMigrations = Number(complete[1]);
            // Drop all other lines; no raw server logs or request material retained.
        });
    }
    return new Promise((resolveExit, reject) => {
        selected.once('error', () => reject(new Error('Isolated child spawn failed')));
        // `close` follows stdout/stderr drain, including the last migration line.
        selected.once('close', (code, signal) => {
            if (child === selected) child = undefined;
            event(`${command}-exit`, { code, signal });
            resolveExit({ code, signal });
        });
    });
}
async function serve() {
    const result = launch('serve');
    event('serve-start', { serverPid: child.pid, runnerPid: process.pid, port: 43546 });
    await result;
    if (stopping) return;
    assert(restarting, 'Isolated server exited unexpectedly');
    restarting = false; receipt.restarts += 1;
    await serve();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    stopping = true;
    child?.kill('SIGTERM');
});
process.on('SIGUSR2', () => {
    if (stopping || restarting || migrating || !child) return;
    restarting = true;
    event('explicit-restart-request');
    child.kill('SIGTERM');
});
try {
    mkdirSync(dataDir); // Never reuse an existing acceptance database.
    const migrationNames = readdirSync(resolve(packageDir, 'prisma/migrations'), { withFileTypes: true })
        .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    assert.equal(migrationNames.length, 41, 'Expected the reviewed 41 production migrations');
    writeFileSync(resolve(directory, 'server-runner.pid'), `${process.pid}\n`, { mode: 0o600 });
    event('migrate-start');
    const result = await launch('migrate');
    assert.equal(result.code, 0, 'Production migration command must succeed');
    assert.equal(receipt.appliedMigrations, 41);
    assert.deepEqual(receipt.migrationNames, migrationNames);
    migrating = false;
    event('migrations-verified', { count: 41 });
    if (!stopping) await serve();
    receipt.stoppedAt = new Date().toISOString(); save();
} catch {
    receipt.firstFailure ??= { stage: migrating ? 'migrate' : 'serve', at: new Date().toISOString() };
    save(); child?.kill('SIGTERM'); process.exitCode = 1;
}
