import http from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

export const NATIVE_STAGES = [
    '01-native-inbox-unread', '02-native-inbox-single-read', '03-native-inbox-done',
    '04-native-inbox-after-relaunch', '05-native-inbox-new-arrival', '06-native-inbox-remote-done',
    '07-native-account-a-unread', '08-native-account-a-done',
    '09-native-account-b-unread', '10-native-account-b-done', '11-native-account-a-restored',
    '12-native-race-new-arrival', '13-native-after-server-restart',
    '14-native-reconnected-new-arrival', '15-native-reconnected-done', '16-native-final-relaunch',
];

// This coordinator is acceptance tooling, never an application endpoint.
// Account material is passed in memory and is never serialized or logged.
export async function startNativeCoordinator({ sodium, seed, credentials, api, accountB, onAction, socketUpdates, firstId, secondId, artifactDir, nativeBuildSha, serverSourceSha, port = 43547 }) {
    await sodium.ready;
    assert(Buffer.from(seed).equals(Buffer.from(credentials.secret, 'base64url')));
    assert(/^[0-9a-f]{40}$/.test(nativeBuildSha));
    assert(/^[0-9a-f]{40}$/.test(serverSourceSha));
    assert(typeof firstId === 'string' && typeof secondId === 'string' && firstId !== secondId);
    const receipt = {
        serverSourceSha,
        nativeBuildSha,
        startedAt: new Date().toISOString(),
        authentication: 'Normal native Link with mobile app QR request/poll; real authenticated companion approval API. No injected app state.',
        firstId, secondId, checkpoints: [], socketUpdates: [],
    };
    const socketStart = socketUpdates.length;
    let approvedPublicKey, incomingId, account = 'A';
    const accounts = { A: { seed, credentials }, B: accountB };
    const expectations = new Map();
    const linkEpochs = ['A', 'B', 'A'];
    let linkEpoch = 0;
    receipt.links = [];
    const actions = [];
    const expectedActions = ['prepare-scope', 'select-b', 'select-a', 'arm-race', 'race-pending', 'release-race', 'restart', 'publish-after-restart', 'resume-web'];
    async function persist() {
        receipt.socketUpdates = socketUpdates.slice(socketStart).map(update => {
            const safe = {};
            for (const key of ['source', 'event', 'type', 'connection', 'at', 'eventId', 'id', 'through', 'readAt']) {
                if (Object.hasOwn(update, key)) safe[key] = update[key];
            }
            return safe;
        });
        await fs.mkdir(artifactDir, { recursive: true });
        await fs.writeFile(artifactDir + '/native-transport.json', JSON.stringify(receipt, null, 2) + '\n');
    }
    async function feedSnapshot(selectedAccount = account) {
        const response = await api(accounts[selectedAccount].credentials, '/v1/feed?limit=200');
        assert.equal(response.hasMore, false);
        return response.items.map(({ id, cursor, readAt }) => ({ id, cursor, readAt }));
    }
    function matches(stage, items) {
        const expected = expectations.get(stage);
        if (expected) return account === expected.account
            && JSON.stringify(items.filter(item => item.readAt == null).map(item => item.id).sort()) === JSON.stringify(expected.unreadIds);
        const first = items.find(item => item.id === firstId);
        const second = items.find(item => item.id === secondId);
        if (!first || !second) return false;
        const unread = items.filter(item => item.readAt == null);
        switch (stage) {
            case '01-native-inbox-unread': return first.readAt == null && second.readAt == null && unread.length === 2;
            case '02-native-inbox-single-read': return first.readAt != null && second.readAt == null && unread.length === 1;
            case '03-native-inbox-done':
            case '04-native-inbox-after-relaunch':
            case '06-native-inbox-remote-done': return unread.length === 0;
            case '05-native-inbox-new-arrival': return first.readAt != null && second.readAt != null
                && unread.length === 1 && unread[0].id === incomingId;
            default: throw new Error('Unknown native checkpoint');
        }
    }
    const server = http.createServer(async (request, response) => {
        try {
            assert.equal(request.method, 'POST');
            const chunks = [];
            let bytes = 0;
            for await (const chunk of request) {
                bytes += chunk.length;
                assert(bytes < 4096);
                chunks.push(chunk);
            }
            const body = JSON.parse(Buffer.concat(chunks).toString());
            let result = {};
            if (request.url === '/native-link') {
                assert.equal(account, linkEpochs[linkEpoch]);
                const { seed: selectedSeed, credentials: selectedCredentials } = accounts[account];
                assert(Buffer.from(selectedSeed).equals(Buffer.from(selectedCredentials.secret, 'base64url')));
                assert.equal(typeof body.url, 'string');
                const match = /^happyherd:\/\/\/account\?([A-Za-z0-9_-]+)$/.exec(body.url);
                assert(match, 'Expected native account-link QR');
                const publicKey = Buffer.from(match[1], 'base64url');
                assert.equal(publicKey.length, 32);
                if (approvedPublicKey) assert(approvedPublicKey.equals(publicKey), 'Only the selected native request is approved');
                const ephemeral = sodium.crypto_box_keypair();
                const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
                const encrypted = sodium.crypto_box_easy(selectedSeed, nonce, publicKey, ephemeral.privateKey);
                // Exact production encryptBox format: ephemeral public key + nonce + ciphertext.
                const answer = Buffer.concat([Buffer.from(ephemeral.publicKey), Buffer.from(nonce), Buffer.from(encrypted)]);
                await api(selectedCredentials, '/v1/auth/account/response', { method: 'POST', body: {
                    publicKey: publicKey.toString('base64'), response: answer.toString('base64'),
                } });
                approvedPublicKey = publicKey;
                receipt.approvedAt = new Date().toISOString();
                receipt.approvalEndpointStatus = 200;
                // A companion-side read-back verifies the real stored response.
                // The token/ciphertext stay in memory; this does not claim the
                // native app consumed the approval or completed its own login.
                const readBack = await api(selectedCredentials, '/v1/auth/account/request', {
                    method: 'POST', body: { publicKey: publicKey.toString('base64') },
                });
                assert.equal(readBack.state, 'authorized');
                assert.equal(typeof readBack.token, 'string');
                assert(readBack.token.length > 0);
                assert(Buffer.from(readBack.response, 'base64').equals(answer));
                receipt.companionApprovalReadBack = {
                    authorized: true, storedCiphertextMatches: true, tokenPresent: true,
                };
                receipt.links[linkEpoch] = { account, epoch: linkEpoch, approvedAt: receipt.approvedAt,
                    ...receipt.companionApprovalReadBack };
            } else if (request.url === '/action') {
                assert.equal(body.action, expectedActions[actions.length], 'Native actions must be ordered');
                result = await onAction(body.action);
                actions.push(body.action);
                receipt.actions = [...actions];
            } else if (request.url === '/checkpoint') {
                assert.equal(typeof body.stage, 'string');
                assert(receipt.links[linkEpoch]?.account === account, 'Normal native linking must complete for this account epoch before checkpoints');
                assert.equal(body.stage, NATIVE_STAGES[receipt.checkpoints.length], 'Native checkpoints must arrive in order');
                const deadline = Date.now() + 15000;
                let items;
                do {
                    items = await feedSnapshot();
                    if (matches(body.stage, items)) break;
                    await new Promise(resolve => setTimeout(resolve, 100));
                } while (Date.now() < deadline);
                assert(matches(body.stage, items), 'Native checkpoint persisted state did not match');
                const previous = receipt.checkpoints.findLast(check => check.account === account);
                if (previous) {
                    for (const item of previous.items.filter(item => item.readAt != null)) {
                        assert.equal(items.find(current => current.id === item.id)?.readAt, item.readAt,
                            'Previously persisted read timestamps must remain unchanged');
                    }
                }
                if (body.stage === '04-native-inbox-after-relaunch') {
                    assert.deepEqual(items, receipt.checkpoints.find(check => check.stage === '03-native-inbox-done').items);
                }
                const snapshots = { A: await feedSnapshot('A'), B: await feedSnapshot('B') };
                const expected = expectations.get(body.stage);
                if (expected) {
                    const other = account === 'A' ? 'B' : 'A';
                    assert.deepEqual(snapshots[other].filter(item => item.readAt == null).map(item => item.id).sort(), expected.otherUnreadIds);
                    assert(!snapshots.A.some(item => snapshots.B.some(otherItem => otherItem.id === item.id)));
                }
                const prior = receipt.checkpoints.at(-1);
                if (prior?.snapshots) for (const alias of ['A', 'B']) {
                    for (const old of prior.snapshots[alias]) {
                        const current = snapshots[alias].find(item => item.id === old.id);
                        assert(current && current.cursor === old.cursor, 'Existing feed identities must survive');
                        if (old.readAt != null) assert.equal(current.readAt, old.readAt);
                    }
                }
                const unchangedFrom = { '13-native-after-server-restart': '12-native-race-new-arrival',
                    '16-native-final-relaunch': '15-native-reconnected-done' }[body.stage];
                if (unchangedFrom) assert.deepEqual(snapshots, receipt.checkpoints.find(check => check.stage === unchangedFrom).snapshots);
                receipt.checkpoints.push({ stage: body.stage, account, at: new Date().toISOString(), passed: true, items, snapshots });
            } else throw new Error('Unknown acceptance route');
            await persist();
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ ok: true, ...result }));
        } catch {
            // Never include request contents, key material or upstream payloads.
            receipt.firstFailure ??= { at: new Date().toISOString(), message: 'Native acceptance request failed' };
            await persist();
            response.writeHead(400, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ ok: false }));
        }
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
    });
    await persist();
    return { server, receipt, persist, expectStage(stage, selectedAccount, unreadIds, otherUnreadIds) {
        assert(NATIVE_STAGES.includes(stage) && !expectations.has(stage));
        assert(['A', 'B'].includes(selectedAccount));
        expectations.set(stage, { account: selectedAccount, unreadIds: [...unreadIds].sort(), otherUnreadIds: [...otherUnreadIds].sort() });
    }, selectAccount(selectedAccount) {
        assert(receipt.links[linkEpoch]);
        assert.equal(selectedAccount, linkEpochs[linkEpoch + 1]);
        linkEpoch += 1; account = selectedAccount; approvedPublicKey = undefined;
    }, selectIncomingUpdate(id) {
        assert(!incomingId && typeof id === 'string' && id !== firstId && id !== secondId);
        incomingId = id; receipt.incomingId = id;
    } };
}
