#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const EVIDENCE_SHA_PATTERN = /^[0-9a-f]{64}$/;
const REPOSITORY_PATTERN = /^[a-z0-9.-]+(?:\/[a-z0-9._-]+)+$/;

function fail(message) {
    throw new Error(`release-manifest: ${message}`);
}

function requireObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail(`${label} must be an object`);
    }
    return value;
}

function requireExactKeys(value, expected, label) {
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
        fail(`${label} keys must be exactly: ${wanted.join(', ')}`);
    }
}

function validateSlot(slot, label, repository) {
    requireObject(slot, label);
    requireExactKeys(
        slot,
        ['image', 'immutableTag', 'sourceSha', 'smoke'],
        label,
    );

    if (!SHA_PATTERN.test(slot.sourceSha)) fail(`${label}.sourceSha must be a full Git SHA`);
    const expectedTag = `${repository}:sha-${slot.sourceSha}`;
    if (slot.immutableTag !== expectedTag) {
        fail(`${label}.immutableTag must be ${expectedTag}`);
    }
    const imagePrefix = `${repository}@`;
    if (typeof slot.image !== 'string' || !slot.image.startsWith(imagePrefix)) {
        fail(`${label}.image must use repository ${repository}`);
    }
    if (!DIGEST_PATTERN.test(slot.image.slice(imagePrefix.length))) {
        fail(`${label}.image must end in an immutable sha256 digest`);
    }

    const smoke = requireObject(slot.smoke, `${label}.smoke`);
    requireExactKeys(
        smoke,
        ['evidenceSha256', 'health', 'result', 'verifiedAt'],
        `${label}.smoke`,
    );
    if (smoke.result !== 'healthy') fail(`${label}.smoke.result must be healthy`);
    if (!EVIDENCE_SHA_PATTERN.test(smoke.evidenceSha256)) {
        fail(`${label}.smoke.evidenceSha256 must be a sha256 hex value`);
    }
    if (!Number.isFinite(Date.parse(smoke.verifiedAt))) {
        fail(`${label}.smoke.verifiedAt must be an ISO timestamp`);
    }
    const health = requireObject(smoke.health, `${label}.smoke.health`);
    requireExactKeys(health, ['service', 'status'], `${label}.smoke.health`);
    if (health.status !== 'ok' || health.service !== 'happy-server') {
        fail(`${label}.smoke.health must identify a healthy happy-server`);
    }
}

export function validateReleaseManifest(manifest) {
    requireObject(manifest, 'manifest');
    requireExactKeys(
        manifest,
        ['current', 'health', 'previous', 'releaseId', 'repository', 'rollback', 'schemaVersion'],
        'manifest',
    );
    if (manifest.schemaVersion !== 1) fail('schemaVersion must equal 1');
    if (!/^\d{4}-\d{2}-\d{2}(?:-[a-z0-9-]+)?$/.test(manifest.releaseId)) {
        fail('releaseId must be a dated, filesystem-safe identifier');
    }
    if (typeof manifest.repository !== 'string' || !REPOSITORY_PATTERN.test(manifest.repository)) {
        fail('repository must be a canonical container repository without a tag or digest');
    }

    validateSlot(manifest.current, 'current', manifest.repository);
    validateSlot(manifest.previous, 'previous', manifest.repository);
    if (manifest.current.image === manifest.previous.image) {
        fail('current and previous images must be different immutable digests');
    }

    const health = requireObject(manifest.health, 'health');
    requireExactKeys(health, ['expected', 'path'], 'health');
    if (health.path !== '/health') fail('health.path must be /health');
    const expected = requireObject(health.expected, 'health.expected');
    requireExactKeys(expected, ['service', 'status'], 'health.expected');
    if (expected.status !== 'ok' || expected.service !== 'happy-server') {
        fail('health.expected must identify a healthy happy-server');
    }

    const rollback = requireObject(manifest.rollback, 'rollback');
    requireExactKeys(rollback, ['command'], 'rollback');
    if (
        typeof rollback.command !== 'string' ||
        !rollback.command.startsWith('scripts/rollback-release.sh ') ||
        !rollback.command.endsWith(' /etc/happyherd/runtime.env')
    ) {
        fail('rollback.command must invoke rollback-release.sh against the production runtime env');
    }

    return manifest;
}

function fixture() {
    const repository = 'registry.example.com/example/happyherd';
    const slot = (sourceSha, digestChar) => ({
        image: `${repository}@sha256:${digestChar.repeat(64)}`,
        immutableTag: `${repository}:sha-${sourceSha}`,
        sourceSha,
        smoke: {
            evidenceSha256: 'e'.repeat(64),
            health: { service: 'happy-server', status: 'ok' },
            result: 'healthy',
            verifiedAt: '2026-08-02T00:00:00.000Z',
        },
    });
    return {
        schemaVersion: 1,
        releaseId: '2026-08-02-test',
        repository,
        current: slot('a'.repeat(40), 'c'),
        previous: slot('b'.repeat(40), 'd'),
        health: {
            path: '/health',
            expected: { service: 'happy-server', status: 'ok' },
        },
        rollback: {
            command: 'scripts/rollback-release.sh docs/releases/test.json /etc/happyherd/runtime.env',
        },
    };
}

function selfTest() {
    validateReleaseManifest(fixture());
    const mutable = fixture();
    mutable.current.image = `${mutable.repository}:latest`;
    try {
        validateReleaseManifest(mutable);
        fail('self-test accepted a mutable image');
    } catch (error) {
        if (String(error).includes('self-test accepted')) throw error;
    }
    const same = fixture();
    same.previous.image = same.current.image;
    try {
        validateReleaseManifest(same);
        fail('self-test accepted identical current and previous images');
    } catch (error) {
        if (String(error).includes('self-test accepted')) throw error;
    }
    process.stdout.write('release-manifest self-test: ok\n');
}

function parseArgs(argv) {
    if (argv.includes('--self-test')) return { selfTest: true };
    const manifestPath = argv[0];
    if (!manifestPath) fail('usage: verify-release-manifest.mjs MANIFEST [--select current|previous]');
    const selectIndex = argv.indexOf('--select');
    let select = null;
    if (selectIndex !== -1) {
        select = argv[selectIndex + 1];
        if (!['current', 'previous'].includes(select)) fail('--select must be current or previous');
    }
    return { manifestPath, select, selfTest: false };
}

try {
    const options = parseArgs(process.argv.slice(2));
    if (options.selfTest) {
        selfTest();
    } else {
        const manifest = validateReleaseManifest(
            JSON.parse(readFileSync(options.manifestPath, 'utf8')),
        );
        if (options.select) {
            process.stdout.write(`${manifest[options.select].image}\n`);
        } else {
            process.stdout.write(
                `release-manifest: ok (${manifest.releaseId}; ${manifest.current.sourceSha.slice(0, 12)})\n`,
            );
        }
    }
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
}
