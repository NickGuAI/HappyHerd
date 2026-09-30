// Real hosted acceptance controller. Copy into HH345_ARTIFACT_DIR alongside the
// three maintained runner snapshots. Never print the Web runner's return value.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import net from 'node:net';
import { createRequire } from 'node:module';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { runAcceptance } from './run-web-acceptance.mjs';
import { NATIVE_STAGES, startNativeCoordinator } from './native-coordinator.mjs';
import { startNativeTransportRelay } from './native-transport-relay.mjs';

const directory = resolve(process.env.HH345_ARTIFACT_DIR || dirname(fileURLToPath(import.meta.url)));
const root = resolve(process.env.HH345_REPO_ROOT || resolve(directory, '../../..'));
const proof = resolve(process.env.HH345_PROOF_DIR || resolve(root, 'acceptance-proof'));
const sourceSha = process.env.HH345_SOURCE_SHA;
const nativeSha = process.env.HH345_NATIVE_SHA;
const prerequisiteFiles = ['native-app-archive.json', 'native-app-extracted.json', 'native-app-signing.json', 'toolchain.txt'];
const nativeCaptures = ['00-native-server-before-authentication', '00a-native-inbox-before-assertions', ...NATIVE_STAGES];
const origin = 'http://127.0.0.1:43545';
const requireApp = createRequire(resolve(root, 'server/packages/happyherd-app/package.json'));
const { chromium } = requireApp('playwright-core');
const sodium = requireApp('libsodium-wrappers');
const receipt = { sourceSha, nativeBuildSha: nativeSha, origin, status: 'RUNNING',
    startedAt: new Date().toISOString(), stages: [], captures: [],
    boundaries: { data: 'Fresh production PGlite database; real HTTP/socket transport',
        auth: 'Normal Web Restore and native public QR linking; secret values remain in memory',
        native: 'Actual simulator app and XCTest gestures; no renderer fixtures or injected read state' } };
const pause = ms => new Promise(done => setTimeout(done, ms));
let stage = 'preflight', serverRunner, browser, coordinator, driver, live, relay;
let scopeA, scopeB, protectedA, raceArrival, restartArrival;
const expectedMarkers = ['HH345_READY_FOR_NEW_ARRIVAL', 'HH345_READY_FOR_REMOTE_DONE',
    'HH345_NATIVE_ACCOUNT_SCOPE', 'HH345_NATIVE_DONE_RACE', 'HH345_NATIVE_SERVER_RESTART'];
let serverExit, driverExit, incoming, markerFailure, cleanupStarted = false;
let verifiedApp;
const markers = [];
const save = () => writeFile(resolve(proof, 'controller.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
async function until(predicate, label, timeout = 30_000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        if (serverExit) throw new Error('Owned server runner stopped');
        if (markerFailure) throw new Error('Native marker action failed');
        if (await predicate()) return;
        await pause(100);
    }
    throw new Error(label); // Only fixed nonsecret labels supplied by this file.
}
async function record(name, action) {
    stage = name;
    const value = await action();
    receipt.stages.push({ name, status: 'PASS', at: new Date().toISOString() });
    await save(); return value;
}
async function portUnused(port) {
    const probe = net.createServer();
    await new Promise((done, reject) => {
        probe.once('error', reject);
        probe.listen(port, '127.0.0.1', done);
    });
    await new Promise(done => probe.close(done));
}
function observeExit(child, onExit) {
    return new Promise(done => {
        let settled = false;
        const finish = value => { if (!settled) { settled = true; onExit(value); done(value); } };
        child.once('error', () => finish({ code: null, signal: null, spawnFailed: true }));
        child.once('close', (code, signal) => finish({ code, signal }));
    });
}
async function stopOwned(child, completion) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    let stopped = false;
    completion?.then(() => { stopped = true; });
    for (let i = 0; i < 450 && !stopped; i++) await pause(100);
    if (!stopped && child.pid) {
        // Each child was started in its own process group by this controller.
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ }
        if (completion) await completion;
    }
}
let serverCompletion, driverCompletion;
async function cleanup() {
    if (cleanupStarted) return;
    cleanupStarted = true;
    const failures = [];
    const attempt = async action => { try { await action(); } catch { failures.push(true); } };
    await attempt(() => stopOwned(driver, driverCompletion));
    if (coordinator) {
        await attempt(() => coordinator.persist());
        await attempt(() => new Promise(done => coordinator.server.close(done)));
    }
    await attempt(() => browser?.close());
    await attempt(() => stopOwned(serverRunner, serverCompletion));
    await attempt(() => relay?.close());
    assert.equal(failures.length, 0, 'Owned resource cleanup failed');
}
async function preserveServerReceipt(required = false) {
    let bytes;
    try { bytes = await readFile(resolve(directory, 'server-runner-receipt.json'), 'utf8'); }
    catch (error) { if (!required && error.code === 'ENOENT') return; throw error; }
    // This file is generated from explicit migration/process metadata only.
    const server = JSON.parse(bytes);
    assert.equal(server.sourceSha, sourceSha);
    await writeFile(resolve(proof, 'server.json'), JSON.stringify(server, null, 2) + '\n');
    if (required) assert(!server.firstFailure && server.restarts === 2 && server.stoppedAt);
}
async function unread(ids) {
    const expected = [...ids].sort();
    await until(async () => {
        const actual = await live.pageA.locator('[data-testid^="feed-card-"] [data-testid^="feed-unread-"]')
            .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid').slice('feed-unread-'.length)).sort());
        return JSON.stringify(actual) === JSON.stringify(expected)
            && await live.pageA.getByTestId('herd-inbox-dot').count() === (expected.length ? 1 : 0)
            && await live.pageA.getByTestId('herd-inbox-count').count() === 0;
    }, 'Desktop card and bell state did not reconcile');
}
async function feed(account = 'A') {
    const data = await live.api(account === 'A' ? live.credsA : live.credsB, '/v1/feed?limit=200');
    assert.equal(data.hasMore, false);
    return data.items.map(({ id, cursor, readAt }) => ({ id, cursor, readAt }));
}
async function done() {
    const button = live.pageA.getByTestId('inbox-mark-all-read');
    await until(async () => await button.getAttribute('aria-disabled') !== 'true', 'Desktop Done stayed disabled');
    const response = live.pageA.waitForResponse(response => new URL(response.url()).origin === origin
        && new URL(response.url()).pathname === '/v1/feed/read' && response.request().method() === 'POST');
    await button.click();
    assert.equal((await response).status(), 200);
    await until(async () => await button.getAttribute('aria-disabled') !== 'true', 'Desktop Done did not acknowledge');
    await unread([]);
    assert((await feed()).every(item => item.readAt != null));
}
async function capture(name) {
    assert.equal(new URL(live.pageA.url()).pathname, '/inbox');
    assert.equal(await live.pageA.locator('textarea').count(), 0);
    const path = `web-native/${name}.png`;
    await live.pageA.screenshot({ path: resolve(proof, path), animations: 'disabled', fullPage: true });
    receipt.captures.push(path);
}
function checkpointPrefix(count) {
    assert.deepEqual(coordinator.receipt.checkpoints.map(item => item.stage), NATIVE_STAGES.slice(0, count));
    assert(coordinator.receipt.checkpoints.every(item => item.passed));
    assert(!coordinator.receipt.firstFailure);
}
async function verifyPrerequisiteReceipts() {
    const entries = await readdir(proof, { withFileTypes: true });
    assert.deepEqual(entries.map(entry => entry.name).sort(), prerequisiteFiles,
        'Proof must initially contain only the four workflow verification receipts');
    assert(entries.every(entry => entry.isFile()), 'Verification receipts must be regular files');
    const archive = JSON.parse(await readFile(resolve(proof, 'native-app-archive.json'), 'utf8'));
    const extracted = JSON.parse(await readFile(resolve(proof, 'native-app-extracted.json'), 'utf8'));
    assert.equal(archive.verified, true); assert.equal(archive.mode, 'archive');
    assert.equal(extracted.verified, true); assert.equal(extracted.mode, 'extracted');
    assert.deepEqual(archive.archive, extracted.archive);
    const signingBytes = await readFile(resolve(proof, 'native-app-signing.json'));
    const signing = JSON.parse(signingBytes);
    const verified = extracted.extracted;
    const manifestBytes = await readFile(resolve(process.env.HH345_APP_ARTIFACT, 'build-manifest.json'));
    const manifest = JSON.parse(manifestBytes);
    assert.equal(manifest.sourceSha, nativeSha);
    assert.deepEqual(manifest.taskSpecificNativeSourcePatches, []);
    assert.equal(manifest.revenueCatSourcePatched, false);
    assert.equal(manifest.architecture, 'arm64'); assert.equal(manifest.configuration, 'Release');
    assert.equal(archive.archive.buildManifestSha256, createHash('sha256').update(manifestBytes).digest('hex'));
    assert.equal(archive.archive.sourceSha, nativeSha);
    assert.equal(archive.archive.manifestAttestsNoTaskSpecificNativeSourcePatches, true);
    assert.equal(archive.archive.manifestAttestsRevenueCatSourceUnpatched, true);
    assert.equal(archive.archive.containsIsolatedApiUrl, true);
    assert.equal(archive.archive.appFileCount, Object.keys(manifest.files).length);
    assert.equal(verified.appFileCount, archive.archive.appFileCount);
    assert.equal(verified.allFileHashesMatchArchiveManifest, true);
    assert.equal(verified.archiveModesAndSymlinkTargetsMatch, true);
    assert.equal(verified.executableArchitectures, 'arm64');
    assert.equal(verified.appPath, resolve(process.env.HH345_ORIGINAL_APP_PATH));
    assert.equal(verified.metadata.sourceSha, nativeSha);
    assert.deepEqual(verified.metadata, archive.archive.metadata);
    assert.equal(verified.metadata.bundleSha256, manifest.bundleSha256);
    assert.equal(verified.metadata.appConfigSha256, manifest.appConfigSha256);
    for (const key of ['verified', 'codesignVerified', 'unchangedCodeSections', 'unchangedUnsignedPayload', 'unchangedUUID', 'unchangedBundle', 'unchangedAppConfig']) {
        assert.equal(signing[key], true);
    }
    assert.equal(signing.sourceSha, nativeSha);
    assert.equal(signing.originalAppPath, verified.appPath);
    assert.equal(signing.signedAppPath, resolve(process.env.HH345_APP_PATH));
    assert.notEqual(signing.originalAppPath, signing.signedAppPath);
    assert.equal(signing.originalArchiveSha256, archive.archive.archiveSha256);
    assert.equal(signing.buildManifestSha256, archive.archive.buildManifestSha256);
    assert.equal(signing.originalFilesVerified, verified.appFileCount);
    assert.equal(signing.originalExecutableSha256, manifest.files[verified.metadata.executable]);
    assert.equal(signing.signedExecutableSha256, signing.files[verified.metadata.executable]);
    assert.equal(signing.bundleSha256, manifest.bundleSha256);
    assert.equal(signing.appConfigSha256, manifest.appConfigSha256);
    assert.deepEqual(signing.entitlements, { 'application-identifier': 'HH345SIM01.app.happyherd.issue345.acceptance' });
    const serverTree = execFileSync('git', ['rev-parse', `${sourceSha}:server`], { cwd: root, encoding: 'utf8' }).trim();
    assert.equal(serverTree, execFileSync('git', ['rev-parse', `${nativeSha}:server`], { cwd: root, encoding: 'utf8' }).trim());
    execFileSync('git', ['diff', '--exit-code', '--', 'server'], { cwd: root, stdio: 'pipe' });
    const toolchain = await readFile(resolve(proof, 'toolchain.txt'), 'utf8');
    assert.deepEqual(toolchain.split(/\r?\n/).slice(0, 2), [sourceSha, serverTree]);
    verifiedApp = archive.archive;
    receipt.artifactVerification = { sourceSha: nativeSha, archiveSha256: verifiedApp.archiveSha256,
        buildManifestSha256: verifiedApp.buildManifestSha256, appFileCount: verified.appFileCount,
        bundleSha256: manifest.bundleSha256, appConfigSha256: manifest.appConfigSha256,
        unchangedServerTree: serverTree,
        simulatorSigning: { originalExecutableSha256: signing.originalExecutableSha256,
            signedExecutableSha256: signing.signedExecutableSha256,
            signingReceiptSha256: createHash('sha256').update(signingBytes).digest('hex'),
            applicationCodeUnchanged: true, variant: 'owned-simulator-application-identifier' },
        receipts: prerequisiteFiles };
}
async function verifyNativeDriverReceipt() {
    const attempts = (await readdir(resolve(proof, 'native'), { withFileTypes: true }))
        .filter(entry => entry.isDirectory());
    assert.equal(attempts.length, 1, 'Expected one actual native attempt');
    const attempt = attempts[0].name;
    assert.match(attempt, /^\d+$/);
    const path = `native/${attempt}`;
    const native = JSON.parse(await readFile(resolve(proof, path, 'receipt.json'), 'utf8'));
    const summary = JSON.parse(await readFile(resolve(proof, path, 'test-summary.json'), 'utf8'));
    assert.equal(native.passed, true); assert.equal(native.exitCode, 0);
    assert.equal(native.sourceSha, sourceSha); assert.equal(native.nativeSourceSha, nativeSha);
    assert.equal(native.installedArtifactHashesVerified, true);
    assert.equal(native.exactPrivateDestinationVerified, true);
    assert.equal(native.originalXctestrunUnchanged, true);
    assert.equal(native.app.archiveSha256, verifiedApp.archiveSha256);
    assert.equal(native.app.buildManifestSha256, verifiedApp.buildManifestSha256);
    assert.equal(native.app.bundleSha256, verifiedApp.metadata.bundleSha256);
    assert.equal(native.app.executableSha256, receipt.artifactVerification.simulatorSigning.signedExecutableSha256);
    assert.equal(native.app.signingReceiptSha256, receipt.artifactVerification.simulatorSigning.signingReceiptSha256);
    assert.equal(native.app.originalExecutableSha256, receipt.artifactVerification.simulatorSigning.originalExecutableSha256);
    assert.equal(native.simulatorSigningVerified, true);
    assert.deepEqual(native.nonsecretFeedIds, [receipt.firstId, receipt.secondId]);
    assert.deepEqual(native.markers, markers);
    assert.deepEqual(native.testSummary, summary);
    assert.equal(summary.result, 'Passed'); assert.equal(summary.totalTestCount, 1);
    assert.equal(summary.passedTests, 1); assert.equal(summary.failedTests, 0); assert.equal(summary.skippedTests, 0);
    assert.deepEqual(native.screenshots.map(item => item.stage).sort(), [...nativeCaptures].sort());
    for (const shot of native.screenshots) {
        assert.equal(shot.file, `png/${shot.stage}.png`);
        const bytes = await readFile(resolve(proof, path, shot.file));
        assert.equal(bytes.length, shot.bytes);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), shot.sha256);
    }
    receipt.nativeProof = { receipt: `${path}/receipt.json`, summary: `${path}/test-summary.json`,
        screenshotsVerified: native.screenshots.length, tests: summary };
}
async function marker(value) {
    if (value === 'HH345_READY_FOR_NEW_ARRIVAL') {
        assert.deepEqual(markers, []);
        checkpointPrefix(4);
        await record('native-done-reconciles-live-desktop-before-new-arrival', async () => {
            await unread([]);
            assert((await feed()).every(item => item.readAt != null));
            await capture('desktop-after-native-done-and-relaunch');
            incoming = await live.publishA();
            coordinator.selectIncomingUpdate(incoming.id);
            await coordinator.persist();
            await unread([incoming.id]);
        });
    } else if (value === 'HH345_READY_FOR_REMOTE_DONE') {
        assert.deepEqual(markers, ['HH345_READY_FOR_NEW_ARRIVAL']);
        checkpointPrefix(5);
        await record('real-desktop-done-clears-new-native-arrival', async () => {
            assert(incoming);
            await unread([incoming.id]);
            assert.equal((await feed()).find(item => item.id === incoming.id)?.readAt, null);
            await capture('desktop-new-arrival-before-done');
            await done();
            await capture('desktop-remote-done-cleared');
        });
    }
    assert.equal(value, expectedMarkers[markers.length]);
    markers.push(value); await save();
}
// These commands come only from the test runner after actual native gestures.
// Replies carry generated nonsecret feed IDs, never account material.
async function nativeAction(action) {
    return record('native-' + action, async () => {
        const expect = (name, account, unreadIds, otherUnreadIds) => coordinator.expectStage(name, account, unreadIds, otherUnreadIds);
        if (action === 'prepare-scope') {
            checkpointPrefix(6);
            scopeA = await live.publishA(); scopeB = await live.publishB();
            await unread([scopeA.id]);
            await until(async () => await live.pageB.getByTestId('feed-unread-' + scopeB.id).count() === 1, 'Account B update must be visible');
            expect('07-native-account-a-unread', 'A', [scopeA.id], [scopeB.id]);
            expect('08-native-account-a-done', 'A', [], [scopeB.id]);
            return { first: scopeA.id, other: scopeB.id };
        }
        if (action === 'select-b') {
            checkpointPrefix(8);
            await unread([]);
            assert.equal((await feed('B')).find(item => item.id === scopeB.id)?.readAt, null);
            protectedA = await live.publishA();
            await unread([protectedA.id]);
            expect('09-native-account-b-unread', 'B', [scopeB.id], [protectedA.id]);
            expect('10-native-account-b-done', 'B', [], [protectedA.id]);
            coordinator.selectAccount('B');
            return { protected: protectedA.id };
        }
        if (action === 'select-a') {
            checkpointPrefix(10);
            assert.equal((await feed()).find(item => item.id === protectedA.id)?.readAt, null);
            assert((await feed('B')).every(item => item.readAt != null));
            expect('11-native-account-a-restored', 'A', [protectedA.id], []);
            coordinator.selectAccount('A');
            return {};
        }
        if (action === 'arm-race') {
            checkpointPrefix(11);
            await unread([protectedA.id]);
            relay.arm(protectedA.cursor);
            return {};
        }
        if (action === 'race-pending') {
            checkpointPrefix(11);
            const held = await relay.waitForHeld();
            assert.equal(held.through, protectedA.cursor);
            // The native UI has asserted disabled while its own real request is held.
            raceArrival = await live.publishA();
            assert(Number(raceArrival.cursor.slice(2)) > Number(held.through.slice(2)));
            assert.equal((await feed()).find(item => item.id === raceArrival.id)?.readAt, null);
            expect('12-native-race-new-arrival', 'A', [raceArrival.id], []);
            receipt.nativeRace = { through: held.through, beforeId: protectedA.id,
                incomingId: raceArrival.id, incomingCursor: raceArrival.cursor, nativePendingObserved: true };
            return { incoming: raceArrival.id };
        }
        if (action === 'release-race') {
            checkpointPrefix(11);
            assert(raceArrival && !relay.receipt.failed);
            assert.equal(relay.receipt.releaseCount, 0);
            receipt.nativeRace.nativeArrivalObservedWhilePending = true;
            relay.release();
            return {};
        }
        if (action === 'restart') {
            checkpointPrefix(12);
            await unread([raceArrival.id]);
            assert.equal(relay.receipt.failed, false);
            const snapshots = { A: await feed(), B: await feed('B') };
            await live.contextA.setOffline(true); await live.contextB.setOffline(true);
            await until(() => relay.connectionSnapshot().active.length === 1, 'Only native WebSocket may remain before restart');
            const nativeConnection = relay.connectionSnapshot().active[0];
            const readPid = async name => Number((await readFile(resolve(directory, name), 'utf8')).trim());
            assert.equal(await readPid('server-runner.pid'), serverRunner.pid);
            const previousPid = await readPid('server.pid');
            assert(Number.isInteger(previousPid) && previousPid > 1);
            serverRunner.kill('SIGUSR2');
            await until(async () => {
                const current = await readPid('server.pid');
                return Number.isInteger(current) && current > 1 && current !== previousPid;
            }, 'Owned native-phase server child must restart');
            await until(async () => {
                try { return (await fetch(origin + '/health', { signal: AbortSignal.timeout(2000) })).status === 200; }
                catch { return false; }
            }, 'Owned restarted server must become healthy');
            await until(() => {
                const transport = relay.connectionSnapshot();
                return transport.connections.find(item => item.id === nativeConnection)?.closed
                    && transport.active.length === 1 && transport.active[0] !== nativeConnection;
            }, 'Native WebSocket must reconnect after owned server restart');
            assert.deepEqual(await feed(), snapshots.A);
            assert.deepEqual(await feed('B'), snapshots.B);
            const server = JSON.parse(await readFile(resolve(directory, 'server-runner-receipt.json'), 'utf8'));
            assert.equal(server.restarts, 2);
            receipt.nativeRestart = { previousPid, currentPid: await readPid('server.pid'),
                accountsRetained: ['A', 'B'], snapshots, restarts: server.restarts,
                previousNativeConnection: nativeConnection, reconnectedNativeConnection: relay.connectionSnapshot().active[0],
                browserContextsOffline: true };
            expect('13-native-after-server-restart', 'A', [raceArrival.id], []);
            return {};
        }
        if (action === 'publish-after-restart') {
            checkpointPrefix(13);
            restartArrival = await live.publishA();
            assert.equal(relay.connectionSnapshot().active.length, 1);
            expect('14-native-reconnected-new-arrival', 'A', [raceArrival.id, restartArrival.id], []);
            expect('15-native-reconnected-done', 'A', [], []);
            expect('16-native-final-relaunch', 'A', [], []);
            return { incoming: restartArrival.id };
        }
        if (action === 'resume-web') {
            checkpointPrefix(14);
            assert.equal(relay.connectionSnapshot().active.length, 1);
            receipt.nativeRestart.nativeReceivedAfterReconnect = true;
            await live.contextA.setOffline(false); await live.contextB.setOffline(false);
            await unread([raceArrival.id, restartArrival.id]);
            return {};
        }
        throw new Error('Unknown native acceptance action');
    });
}
async function proofManifest() {
    const rows = [];
    async function walk(dir) {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
            const path = resolve(dir, entry.name);
            if (entry.isDirectory()) await walk(path);
            else {
                assert(entry.isFile(), 'Proof must contain regular sanitized files only');
                const name = relative(proof, path).replaceAll('\\', '/');
                const nativeShot = /^native\/\d+\/png\/([a-z0-9-]+)\.png$/.exec(name);
                const allowed = prerequisiteFiles.includes(name) || name === 'controller.json' || name === 'server.json'
                    || name === 'web/web-acceptance.json' || /^web\/[a-z0-9-]+\.png$/.test(name)
                    || /^web-native\/[a-z0-9-]+\.png$/.test(name)
                    || name === 'native/native-transport.json'
                    || /^native\/\d+\/(receipt|test-summary)\.json$/.test(name)
                    || (nativeShot && nativeCaptures.includes(nativeShot[1]));
                assert(allowed, 'Unexpected file in sanitized proof directory');
                const bytes = await readFile(path);
                rows.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
            }
        }
    }
    await walk(proof);
    await writeFile(resolve(proof, 'proof-manifest.json'), JSON.stringify({ files: rows }, null, 2) + '\n');
}
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    receipt.firstFailure ??= { stage, type: 'Interrupted', at: new Date().toISOString() };
    receipt.status = 'FAIL';
    void save().catch(() => {}).then(cleanup).catch(() => {})
        .then(() => preserveServerReceipt()).catch(() => {}).finally(() => { process.exitCode = 1; });
});
try {
    assert.match(sourceSha || '', /^[a-f0-9]{40}$/);
    assert.equal(nativeSha, '67a22ead631e384802e5f7a8657ff674c07ab28d');
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceSha);
    assert.equal(dirname(fileURLToPath(import.meta.url)), directory, 'Run copied controller from the isolated work directory');
    const proofRelative = relative(directory, proof);
    assert(proofRelative === '..' || proofRelative.startsWith('../') || isAbsolute(proofRelative),
        'Public proof must be separate from private runtime');
    await mkdir(proof, { recursive: true });
    await verifyPrerequisiteReceipts();
    for (const name of ['web', 'web-native', 'native']) await mkdir(resolve(proof, name));
    await save();
    await record('fresh-isolated-server-and-production-migrations', async () => {
        await portUnused(43545); await portUnused(43546); await portUnused(43547);
        relay = await startNativeTransportRelay();
        serverRunner = spawn(process.execPath, [resolve(directory, 'server-runner.mjs')], {
            cwd: root, detached: true, env: { ...process.env, HH345_REPO_ROOT: root,
                HH345_ARTIFACT_DIR: directory, HH345_SOURCE_SHA: sourceSha },
            stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        });
        serverCompletion = observeExit(serverRunner, value => { serverExit = value; });
        await until(async () => {
            try { return (await fetch(`${origin}/health`, { signal: AbortSignal.timeout(2000) })).status === 200; }
            catch { return false; }
        }, 'Isolated server did not become healthy', 90_000);
        const server = JSON.parse(await readFile(resolve(directory, 'server-runner-receipt.json'), 'utf8'));
        assert.equal(server.appliedMigrations, 41); assert.equal(server.migrationNames.length, 41);
        assert(!server.firstFailure);
        receipt.migrationCount = 41;
    });
    await record('thirteen-real-web-acceptance-stages', async () => {
        browser = await chromium.launch({ headless: true });
        live = await runAcceptance({ browser, origin, artifactDir: resolve(proof, 'web'), sha: sourceSha, runnerPid: serverRunner.pid });
        assert.equal(live.receipt.status, 'PASS'); assert.equal(live.checks.length, 13);
        assert(live.checks.every(check => check.status === 'PASS'));
        await live.contextM.close();
    });
    await record('prepare-native-account-with-two-real-unread-updates', async () => {
        await done();
        const first = await live.publishA(), second = await live.publishA();
        await unread([first.id, second.id]);
        const items = await feed();
        assert.deepEqual(items.filter(item => item.readAt == null).map(item => item.id).sort(), [first.id, second.id].sort());
        receipt.firstId = first.id; receipt.secondId = second.id;
        await sodium.ready;
        coordinator = await startNativeCoordinator({ sodium, seed: Buffer.from(live.seedA, 'base64url'), credentials: live.credsA,
            api: live.api, accountB: { seed: Buffer.from(live.seedB, 'base64url'), credentials: live.credsB },
            onAction: nativeAction, socketUpdates: live.receipt.socketUpdates, firstId: first.id, secondId: second.id,
            artifactDir: resolve(proof, 'native'), nativeBuildSha: nativeSha, serverSourceSha: sourceSha });
        await capture('desktop-native-initial-unread');
    });
    await record('actual-native-xctest-and-sixteen-persisted-checkpoints', async () => {
        driver = spawn(process.env.HH345_PYTHON || 'python3', [resolve(root, 'docs/acceptance/issue-345/hosted-native/native-driver.py')], {
            cwd: root, detached: true,
            env: { ...process.env, HH345_FIRST_ID: receipt.firstId, HH345_SECOND_ID: receipt.secondId,
                HH345_ARTIFACT_DIR: directory, HH345_PROOF_DIR: proof,
                HH345_SOURCE_SHA: sourceSha, HH345_NATIVE_SHA: nativeSha },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let pending = Promise.resolve();
        const lines = createInterface({ input: driver.stdout });
        lines.on('line', line => {
            if (!expectedMarkers.includes(line.trim())) return;
            pending = pending.then(() => marker(line.trim())).catch(() => {
                markerFailure = true; driver.kill('SIGTERM');
            });
        });
        driver.stderr.resume(); // Never forward raw native failure/log content.
        driverCompletion = observeExit(driver, value => { driverExit = value; });
        const exit = await driverCompletion; await pending;
        assert(!markerFailure); assert.equal(exit.code, 0); assert.equal(exit.signal, null);
        assert.deepEqual(markers, expectedMarkers);
        await verifyNativeDriverReceipt();
        checkpointPrefix(NATIVE_STAGES.length);
        assert(coordinator.receipt.approvedAt); assert.equal(coordinator.receipt.approvalEndpointStatus, 200);
        await unread([]);
        const final = await feed(); assert(final.every(item => item.readAt != null));
        assert(final.some(item => item.id === incoming.id));
        assert.deepEqual(final, coordinator.receipt.checkpoints.at(-1).items);
        assert.deepEqual(coordinator.receipt.links.map(link => link.account), ['A', 'B', 'A']);
        assert.equal(relay.receipt.failed, false);
        receipt.nativeTransportRelay = relay.receipt;
        receipt.finalFeed = final; receipt.nativeDriverExit = exit;
        await coordinator.persist();
    });
    await cleanup();
    await preserveServerReceipt(true);
    receipt.status = 'PASS'; receipt.completedAt = new Date().toISOString(); await save();
    await proofManifest();
    console.log('HH345_HOSTED_ACCEPTANCE_PASS');
} catch {
    if (relay) receipt.nativeTransportRelay = relay.receipt;
    receipt.status = 'FAIL'; receipt.firstFailure ??= { stage, type: 'AcceptanceFailure', at: new Date().toISOString() };
    receipt.completedAt = new Date().toISOString();
    await save().catch(() => {});
    await cleanup().catch(() => {});
    await preserveServerReceipt().catch(() => {});
    process.exitCode = 1;
    console.error('HH345_HOSTED_ACCEPTANCE_FAILED');
}
