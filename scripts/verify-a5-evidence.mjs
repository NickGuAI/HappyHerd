#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const shaPattern = /^[0-9a-f]{40}$/;
const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const requiredFindingIds = new Set([
    'A5-REVIEW-1-NON_NOOP',
    'A5-REVIEW-2-POST_SYNC_CONTRACTS',
    'A5-REVIEW-3-IMMUTABLE_EVIDENCE',
    'A5-REVIEW-4-UPSTREAM_PROVENANCE',
]);

function fail(message) {
    throw new Error(message);
}

function assert(condition, message) {
    if (!condition) {
        fail(message);
    }
}

function validateDocument(document) {
    assert(document && typeof document === 'object' && !Array.isArray(document), 'evidence must be an object');
    assert(document.schemaVersion === 1, 'schemaVersion must equal 1');
    assert(document.gate === 'A5', 'gate must equal A5');
    assert(document.status === 'accepted', 'status must equal accepted');
    assert(shaPattern.test(document.testedHappyHerdSha), 'testedHappyHerdSha must be a full lowercase SHA');
    assert(isoTimestampPattern.test(document.recordedAt), 'recordedAt must be an ISO UTC timestamp');

    const upstream = document.upstream;
    assert(upstream && typeof upstream === 'object', 'upstream evidence is required');
    assert(shaPattern.test(upstream.from), 'upstream.from must be a full lowercase SHA');
    assert(shaPattern.test(upstream.to), 'upstream.to must be a full lowercase SHA');
    assert(upstream.from !== upstream.to, 'upstream rehearsal must be non-no-op');

    const rehearsal = document.rehearsal;
    assert(rehearsal && typeof rehearsal === 'object', 'rehearsal evidence is required');
    assert(rehearsal.result === 'passed', 'rehearsal result must equal passed');
    assert(shaPattern.test(rehearsal.postSyncSha), 'postSyncSha must be a full lowercase SHA');
    assert(Number.isInteger(rehearsal.ownedPatches) && rehearsal.ownedPatches > 0, 'ownedPatches must be positive');
    assert(rehearsal.identityMatches === rehearsal.ownedPatches, 'every owned patch must be an identity match');

    const contracts = document.contracts;
    assert(contracts && typeof contracts === 'object', 'contract evidence is required');
    assert(contracts.result === 'passed', 'contract result must equal passed');
    assert(contracts.testFiles === 174, 'contract evidence must record 174 test files');
    assert(contracts.tests === 1931, 'contract evidence must record 1931 tests');

    const ci = document.ci;
    assert(ci && typeof ci === 'object', 'CI evidence is required');
    assert(Number.isSafeInteger(ci.runId) && ci.runId > 0, 'CI runId must be a positive integer');
    assert(ci.headSha === document.testedHappyHerdSha, 'CI head SHA must equal the tested SHA');
    assert(ci.conclusion === 'success', 'CI conclusion must equal success');
    assert(ci.url === `https://github.com/NickGuAI/HappyHerd/actions/runs/${ci.runId}`, 'CI URL must identify the recorded run');
    assert(Array.isArray(ci.artifacts), 'CI artifacts must be an array');
    assert(ci.artifacts.includes(`contract-suite-${ci.runId}`), 'contract artifact is missing');
    assert(ci.artifacts.includes(`upstream-rehearsal-${ci.runId}`), 'rehearsal artifact is missing');

    const review = document.review;
    assert(review && typeof review === 'object', 'independent review evidence is required');
    assert(typeof review.reviewer === 'string' && review.reviewer.length > 0, 'reviewer is required');
    assert(review.verdict === 'accepted', 'independent review verdict must equal accepted');
    assert(review.reviewedHeadSha === document.testedHappyHerdSha, 'reviewed SHA must equal the tested SHA');
    assert(Array.isArray(review.findingsResolved), 'resolved findings must be an array');
    for (const findingId of requiredFindingIds) {
        assert(review.findingsResolved.includes(findingId), `missing resolved finding ${findingId}`);
    }
}

function assertCommitExists(sha, rehearsalMode) {
    const exists = spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' });
    assert(exists.status === 0, 'testedHappyHerdSha is not present in repository history');

    if (!rehearsalMode) {
        const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { stdio: 'ignore' });
        assert(ancestor.status === 0, 'testedHappyHerdSha is not an ancestor of HEAD');
    }
}

function selfTest() {
    const sha = 'a'.repeat(40);
    const runId = 123;
    const valid = {
        schemaVersion: 1,
        gate: 'A5',
        status: 'accepted',
        testedHappyHerdSha: sha,
        recordedAt: '2026-08-02T20:00:00Z',
        upstream: { from: 'b'.repeat(40), to: 'c'.repeat(40) },
        rehearsal: { result: 'passed', postSyncSha: 'd'.repeat(40), ownedPatches: 15, identityMatches: 15 },
        contracts: { result: 'passed', testFiles: 174, tests: 1931 },
        ci: {
            runId,
            headSha: sha,
            conclusion: 'success',
            url: `https://github.com/NickGuAI/HappyHerd/actions/runs/${runId}`,
            artifacts: [`contract-suite-${runId}`, `upstream-rehearsal-${runId}`],
        },
        review: {
            reviewer: 'independent-reviewer',
            verdict: 'accepted',
            reviewedHeadSha: sha,
            findingsResolved: [...requiredFindingIds],
        },
    };

    validateDocument(valid);
    for (const mutate of [
        (copy) => { copy.upstream.to = copy.upstream.from; },
        (copy) => { copy.rehearsal.identityMatches -= 1; },
        (copy) => { copy.contracts.tests -= 1; },
        (copy) => { copy.ci.conclusion = 'cancelled'; },
        (copy) => { copy.review.findingsResolved = []; },
    ]) {
        const invalid = structuredClone(valid);
        mutate(invalid);
        let rejected = false;
        try {
            validateDocument(invalid);
        } catch {
            rejected = true;
        }
        assert(rejected, 'self-test accepted invalid evidence');
    }

    console.log('a5-evidence: self-test ok (1 valid and 5 rejected documents)');
}

const [evidencePath, mode] = process.argv.slice(2);
if (evidencePath === '--self-test') {
    selfTest();
} else {
    assert(evidencePath, 'usage: verify-a5-evidence.mjs <evidence.json> [--rehearsal]');
    const document = JSON.parse(readFileSync(evidencePath, 'utf8'));
    validateDocument(document);
    assertCommitExists(document.testedHappyHerdSha, mode === '--rehearsal');
    console.log(`a5-evidence: ok (${document.testedHappyHerdSha.slice(0, 12)}; CI ${document.ci.runId})`);
}
