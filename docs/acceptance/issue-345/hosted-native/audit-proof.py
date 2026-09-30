#!/usr/bin/env python3
"""Read-only issue345 proof audit. Receipt integrity is not screenshot/UI review."""
import argparse
import hashlib
import json
import re
from pathlib import Path, PurePosixPath
import subprocess
import sys

NATIVE_SHA = '4933c0c727b08f2dbe7f90ae5e261d89a917e0de'
ARCHIVE_SHA = '0a692dee476bc6fb12a79879a75fb7865c7ace0c2c3ab4960b90b26cc1d762b5'
PRODUCT_TREE = 'e8a2fb1ad9756a56306354861f3d62b73f5f6eb8'
NATIVE_STAGES = [
 '01-native-inbox-unread', '02-native-inbox-single-read', '03-native-inbox-done',
 '04-native-inbox-after-relaunch', '05-native-inbox-new-arrival', '06-native-inbox-remote-done',
 '07-native-account-a-unread', '08-native-account-a-done', '09-native-account-b-unread',
 '10-native-account-b-done', '11-native-account-a-restored', '12-native-race-new-arrival',
 '13-native-after-server-restart', '14-native-reconnected-new-arrival',
 '15-native-reconnected-done', '16-native-final-relaunch']
NATIVE_CAPTURES = ['00-native-server-before-authentication', '00a-native-inbox-before-assertions', *NATIVE_STAGES]
WEB_STAGES = [
 'exact-production-artifact', 'desktop-normal-auth-and-empty-inbox', 'desktop-real-feed-publication',
 'mobile-normal-restore-same-account', 'desktop-single-read-and-mobile-socket-update',
 'desktop-done-clears-both-clients', 'mobile-single-tap-and-done-tap-update-desktop',
 'already-read-done-and-repeat-delivery-are-idempotent', 'desktop-and-mobile-reload-retain-read-state',
 'offline-client-misses-receipt-and-reconciles-on-reconnect', 'real-latency-done-snapshot-preserves-incoming-update',
 'separate-account-isolation-through-real-ui-and-api', 'isolated-server-restart-retains-auth-and-disk-state']
WEB_CAPTURES = ['desktop-empty-inbox', 'desktop-two-unread', 'mobile-two-unread',
 'desktop-done-cleared', 'mobile-socket-cleared', 'mobile-done-cleared', 'mobile-offline-unread',
 'mobile-reconnected-cleared', 'desktop-new-arrival-unread', 'mobile-new-arrival-unread',
 'account-b-done-cleared', 'desktop-after-server-restart', 'mobile-after-server-restart']
COMPANION_CAPTURES = ['desktop-native-initial-unread', 'desktop-after-native-done-and-relaunch',
 'desktop-new-arrival-before-done', 'desktop-remote-done-cleared']
ACTIONS = ['prepare-scope', 'select-b', 'select-a', 'arm-race', 'race-pending', 'release-race',
 'restart', 'publish-after-restart', 'resume-web']
AT_ESCAPED_PROOF_FILES = {'native-app-archive.json', 'native-app-extracted.json'}
MARKERS = ['HH345_READY_FOR_NEW_ARRIVAL', 'HH345_READY_FOR_REMOTE_DONE',
 'HH345_NATIVE_ACCOUNT_SCOPE', 'HH345_NATIVE_DONE_RACE', 'HH345_NATIVE_SERVER_RESTART']
CONTROLLER_STAGES = ['fresh-isolated-server-and-production-migrations', 'thirteen-real-web-acceptance-stages',
 'prepare-native-account-with-two-real-unread-updates', 'native-done-reconciles-live-desktop-before-new-arrival',
 'real-desktop-done-clears-new-native-arrival', *['native-' + action for action in ACTIONS],
 'actual-native-xctest-and-sixteen-persisted-checkpoints']


def digest(data):
    return hashlib.sha256(data).hexdigest()


def unread(items):
    return {item['id'] for item in items if item['readAt'] is None}


def cursor(value):
    assert re.fullmatch(r'0-[0-9]+', value), 'invalid fixed-format feed cursor'
    return int(value[2:])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact', type=Path, required=True)
    parser.add_argument('--source-sha', required=True)
    parser.add_argument('--repo', type=Path, default=Path.cwd())
    parser.add_argument('--build-manifest', type=Path,
                        help='Original selected build manifest bytes, not the reformatted retained copy')
    args = parser.parse_args()
    if not re.fullmatch('[0-9a-f]{40}', args.source_sha):
        parser.error('source SHA must contain exactly 40 lowercase hexadecimal characters')
    root = args.artifact.resolve()
    failures, passed = [], []

    def check(name, operation):
        try:
            operation()
            passed.append(name)
        except AssertionError as error:
            # Every assertion message below is fixed, code-owned prose.
            failures.append({'check': name, 'reason': str(error) or 'required evidence differs'})
        except Exception as error:
            failures.append({'check': name, 'reason': 'missing or malformed required evidence',
                             'type': type(error).__name__})

    def load(name):
        path = root / name
        if not path.is_file() or path.is_symlink():
            return {}
        return json.loads(path.read_text())

    controller = load('controller.json')
    server = load('server.json')
    web = load('web/web-acceptance.json')
    transport = load('native/native-transport.json')
    archive_receipt = load('native-app-archive.json')
    extracted_receipt = load('native-app-extracted.json')
    signing = load('native-app-signing.json')
    attempts = [p for p in (root / 'native').glob('*') if p.is_dir() and re.fullmatch('[0-9]+', p.name)]
    attempt = attempts[0].name if len(attempts) == 1 else 'missing-attempt'
    native_prefix = 'native/' + attempt
    native = load(native_prefix + '/receipt.json')
    summary = load(native_prefix + '/test-summary.json')
    proof = load('proof-manifest.json')
    # The retained JSON escapes public image-scale suffixes to avoid the
    # repository's email-pattern scanner. Reconstruct the original bytes before
    # checking their unchanged build-manifest hash; no other bytes are rewritten.
    manifest_path = args.build_manifest or args.repo / 'docs/acceptance/issue-345/native-signed-build-manifest.json'
    manifest_bytes = manifest_path.read_bytes()
    if args.build_manifest is None:
        manifest_bytes = manifest_bytes.replace(b'\\u0040', b'@')
    manifest = json.loads(manifest_bytes)
    expected = {'controller.json', 'server.json', 'toolchain.txt', 'native-app-archive.json',
                'native-app-extracted.json', 'native-app-signing.json', 'native/native-transport.json',
                'web/web-acceptance.json', native_prefix + '/receipt.json', native_prefix + '/test-summary.json'}
    expected.update('web/' + name + '.png' for name in WEB_CAPTURES)
    expected.update('web-native/' + name + '.png' for name in COMPANION_CAPTURES)
    expected.update(native_prefix + '/png/' + name + '.png' for name in NATIVE_CAPTURES)

    def files_check():
        assert len(attempts) == 1, 'expected exactly one native attempt directory'
        paths = list(root.rglob('*'))
        assert not any(path.is_symlink() or not (path.is_file() or path.is_dir()) for path in paths), 'nonregular proof member'
        expected_dirs = {PurePosixPath(*PurePosixPath(name).parts[:index]).as_posix()
                         for name in expected for index in range(1, len(PurePosixPath(name).parts))}
        assert {path.relative_to(root).as_posix() for path in paths if path.is_dir()} == expected_dirs, 'proof directory missing or outside exact allowlist'
        assert isinstance(proof.get('files'), list), 'completion proof manifest is absent'
        actual = {path.relative_to(root).as_posix() for path in paths if path.is_file()}
        assert actual == expected | {'proof-manifest.json'}, 'proof files missing or outside exact JSON/PNG allowlist'
        rows = proof['files']
        names = [row['path'] for row in rows]
        assert len(names) == len(set(names)) and set(names) == expected, 'proof manifest must cover each allowed file exactly once'
        for row in rows:
            name = row['path']
            path = PurePosixPath(name)
            assert not path.is_absolute() and all(part not in ('', '.', '..') for part in name.split('/')) and '\\' not in name, 'unsafe manifest member'
            data = (root / name).read_bytes()
            # The original downloaded files also work here. Only these two
            # documented JSON receipts use reversible publication escaping.
            if name in AT_ESCAPED_PROOF_FILES:
                data = data.replace(b'\\u0040', b'@')
            assert type(row['bytes']) is int and row['bytes'] == len(data), 'proof member size mismatch'
            assert re.fullmatch('[0-9a-f]{64}', row['sha256']) and row['sha256'] == digest(data), 'proof member hash mismatch'
            if name.endswith('.png'):
                assert data.startswith(b'\x89PNG\r\n\x1a\n'), 'expected PNG signature'
    check('exact-proof-manifest-and-35-png-files', files_check)

    def source_check():
        for value in (controller['sourceSha'], server['sourceSha'], web['sourceRevision'], native['sourceSha'], transport['serverSourceSha']):
            assert value == args.source_sha, 'exact source SHA binding mismatch'
        for value in (controller['nativeBuildSha'], native['nativeSourceSha'], transport['nativeBuildSha'], manifest['sourceSha']):
            assert value == NATIVE_SHA, 'selected native build binding mismatch'
        for sha in (args.source_sha, NATIVE_SHA):
            tree = subprocess.check_output(['git', 'rev-parse', sha + ':server'], cwd=args.repo, text=True).strip()
            assert tree == PRODUCT_TREE, 'product source tree differs from selected native build'
        assert (root / 'toolchain.txt').read_text().splitlines()[:2] == [args.source_sha, PRODUCT_TREE], 'hosted toolchain provenance mismatch'
        swift = subprocess.check_output(['git', 'show', args.source_sha + ':docs/acceptance/issue-345/hosted-native/xcuitest/Tests/InboxAcceptanceTests.swift'], cwd=args.repo)
        assert native['testSourceSha256'] == digest(swift), 'actual XCTest source hash differs from exact audited head'
        verifier = subprocess.check_output(['git', 'show', args.source_sha + ':docs/acceptance/issue-345/hosted-native/verify-hosted-app.py'], cwd=args.repo)
        assert archive_receipt['scriptSha256'] == extracted_receipt['scriptSha256'] == digest(verifier), 'artifact verifier hash differs from exact audited head'
    check('exact-head-and-selected-product-provenance', source_check)

    def artifact_check():
        assert archive_receipt['verified'] is True and extracted_receipt['verified'] is True, 'prerequisite artifact verification incomplete'
        assert archive_receipt['mode'] == 'archive' and extracted_receipt['mode'] == 'extracted'
        assert archive_receipt['archive'] == extracted_receipt['archive'], 'archive/extracted receipt mismatch'
        archive, extracted = archive_receipt['archive'], extracted_receipt['extracted']
        artifact = controller['artifactVerification']
        retained = json.loads((args.repo / 'docs/acceptance/issue-345/native-signed-build-manifest.json').read_text())
        assert manifest == retained, 'original selected build manifest differs from retained evidence'
        assert archive['archiveSha256'] == artifact['archiveSha256'] == native['app']['archiveSha256'] == ARCHIVE_SHA
        assert archive['sourceSha'] == artifact['sourceSha'] == extracted['metadata']['sourceSha'] == NATIVE_SHA
        assert archive['buildManifestSha256'] == artifact['buildManifestSha256'] == native['app']['buildManifestSha256'] == digest(manifest_bytes)
        assert archive['productTree'] == manifest['productTree'] == artifact['unchangedServerTree'] == PRODUCT_TREE
        assert archive['nativeBuildMode'] == manifest['nativeBuildMode'] == artifact['normalSigning']['variant'] == 'xcode-default-simulator-signing'
        assert len(manifest['files']) == archive['appFileCount'] == extracted['appFileCount'] == artifact['appFileCount'] == native['app']['filesVerified'] == 736
        for key in ('manifestAttestsNoTaskSpecificNativeSourcePatches', 'manifestAttestsRevenueCatSourceUnpatched', 'containsIsolatedApiUrl'):
            assert archive[key] is True
        assert manifest['taskSpecificNativeSourcePatches'] == [] and manifest['revenueCatSourcePatched'] is False
        for key in ('allFileHashesMatchArchiveManifest', 'archiveModesAndSymlinkTargetsMatch', 'buildSigningVerified'):
            assert extracted[key] is True
        assert signing['verified'] is True and signing['sourceSha'] == NATIVE_SHA
        assert signing['app'] == {'status': 'parsed', 'bundleIdentifierMatches': True, 'executableMatches': True, 'simulatorPlatform': True}
        assert signing['codesign'] == {'status': 'parsed', 'returnCode': 0}
        assert signing['machO']['architecture'] == 'arm64' and signing['machO']['thin'] is True and signing['machO']['codeSignaturePresent'] is True
        signing_hash = digest((root / 'native-app-signing.json').read_bytes())
        assert signing_hash == manifest['signingReceiptSha256'] == archive['signingReceiptSha256'] == extracted['signingReceiptSha256'] == native['app']['signingReceiptSha256'] == artifact['normalSigning']['signingReceiptSha256']
        assert signing['machO']['executableSha256'] == extracted['executableSha256'] == native['app']['executableSha256'] == manifest['files']['HappyHerd'] == artifact['normalSigning']['executableSha256']
        assert archive['metadata'] == extracted['metadata']
        assert native['app']['bundleSha256'] == artifact['bundleSha256'] == manifest['bundleSha256'] == archive['metadata']['bundleSha256']
        assert artifact['appConfigSha256'] == manifest['appConfigSha256'] == archive['metadata']['appConfigSha256']
        for key in ('installedAllManifestFilesVerified', 'installedArtifactHashesVerified', 'buildSigningVerified', 'exactPrivateDestinationVerified', 'originalXctestrunUnchanged'):
            assert native[key] is True, 'installed artifact/runtime verification incomplete'
        restoration = native['installedFrameworkModeRestoration']
        assert restoration['observedMismatchCount'] == restoration['changedCount'] in (0, 6)
        assert restoration['restorationApplied'] is (restoration['changedCount'] == 6)
        if restoration['restorationApplied']:
            assert restoration['frameworkIdentityVerified'] is True and restoration['expectedMode'] == 0o755 and restoration['observedMode'] == 0o644
        for key in ('byteHashesUnchanged', 'allManifestFilesVerified', 'strictSignatureVerified'):
            assert restoration[key] is True, 'post-preparation hashes/modes/signature incomplete'
    check('selected-archive-signing-and-installed-736-files', artifact_check)

    def web_check():
        assert web['status'] == 'PASS' and not web.get('failure'), 'Web journey did not pass'
        assert [row['name'] for row in web['checks']] == WEB_STAGES and all(row['status'] == 'PASS' for row in web['checks']), 'all thirteen original Web stages required'
        assert web['bundle']['embeddedSourceRevision'] == args.source_sha
        assert web['captures'] == [name + '.png' for name in WEB_CAPTURES]
        required = {('POST', '/v1/auth'), ('GET', '/v1/feed'), ('POST', '/v1/feed/read'), ('POST', '/v1/feed/automation-blocked')}
        assert required <= {(row['method'], row['path']) for row in web['endpointStatuses'] if row['status'] == 200}, 'real auth/feed HTTP proof missing'
        assert any(row['source'] == 'mobile-A' and row['type'] == 'feed-read' for row in web['socketUpdates']), 'real mobile socket acknowledgement missing'
        assert any(row['event'] == 'offline-disconnect-proved-before-done' for row in web['socketConnections']), 'Web offline/reconnect proof missing'
        for alias in ('A', 'B'):
            assert any(row['label'] == 'after-server-restart' and row['account'] == alias for row in web['feedSnapshots']), 'Web durable account snapshot missing'
    check('all-thirteen-real-web-stages-and-transports', web_check)

    def completion_check():
        assert controller['status'] == 'PASS' and not controller.get('firstFailure'), 'controller did not reach full native completion'
        assert [row['name'] for row in controller['stages']] == CONTROLLER_STAGES and all(row['status'] == 'PASS' for row in controller['stages']), 'complete ordered controller stages required'
        assert native['passed'] is True and native['exitCode'] == 0 and native['phase'] == 'completed', 'native XCTest did not pass'
        assert not native.get('errorType') and not native['nativeFailures'] and not native['authFailures']
        assert summary == native['testSummary'] == controller['nativeProof']['tests']
        assert summary['result'] == 'Passed' and summary['totalTestCount'] == summary['passedTests'] == 1 and summary['failedTests'] == summary['skippedTests'] == 0
        assert native['markers'] == MARKERS
        assert controller['nativeDriverExit'] == {'code': 0, 'signal': None}
        assert controller['nativeProof']['receipt'] == native_prefix + '/receipt.json' and controller['nativeProof']['summary'] == native_prefix + '/test-summary.json'
        assert controller['nativeProof']['screenshotsVerified'] == len(NATIVE_CAPTURES)
        assert controller['captures'] == ['web-native/' + name + '.png' for name in COMPANION_CAPTURES]
    check('actual-xctest-completion-with-zero-skips', completion_check)

    def capture_check():
        shots = native['screenshots']
        assert sorted(row['stage'] for row in shots) == sorted(NATIVE_CAPTURES), 'all eighteen original native captures required'
        for shot in shots:
            assert shot['file'] == 'png/' + shot['stage'] + '.png'
            data = (root / native_prefix / shot['file']).read_bytes()
            assert len(data) == shot['bytes'] and digest(data) == shot['sha256'], 'native screenshot receipt binding mismatch'
    check('all-eighteen-native-screenshot-bindings', capture_check)

    checkpoints = transport.get('checkpoints', [])
    by_stage = {row['stage']: row for row in checkpoints}
    def checkpoint_check():
        assert [row['stage'] for row in checkpoints] == NATIVE_STAGES, 'full sixteen ordered persisted native checkpoints required'
        assert all(row['passed'] is True for row in checkpoints) and not transport.get('firstFailure')
        assert transport['actions'] == ACTIONS, 'native action sequence incomplete'
        assert [row['account'] for row in checkpoints] == ['A'] * 8 + ['B'] * 2 + ['A'] * 6
        assert [len(unread(row['items'])) for row in checkpoints] == [2, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 2, 0, 0], 'native per-stage unread state differs'
        previous = None
        for row in checkpoints:
            snapshots = row['snapshots']
            assert row['items'] == snapshots[row['account']]
            assert {item['id'] for item in snapshots['A']}.isdisjoint(item['id'] for item in snapshots['B']), 'account feed identities overlap'
            for alias in ('A', 'B'):
                items = snapshots[alias]
                assert len({item['id'] for item in items}) == len(items), 'duplicate feed identity'
                assert all(re.fullmatch(r'0-[0-9]+', item['cursor']) and (item['readAt'] is None or type(item['readAt']) is int) for item in items)
                if previous:
                    current = {item['id']: item for item in items}
                    for old in previous['snapshots'][alias]:
                        assert old['id'] in current and current[old['id']]['cursor'] == old['cursor'], 'existing durable feed identity disappeared or changed'
                        if old['readAt'] is not None:
                            assert current[old['id']]['readAt'] == old['readAt'], 'previously read timestamp was rewritten'
            previous = row
        first, second = controller['firstId'], controller['secondId']
        assert native['nonsecretFeedIds'] == [first, second] == [transport['firstId'], transport['secondId']]
        assert unread(checkpoints[0]['items']) == {first, second}
        assert unread(checkpoints[1]['items']) == {second}
        assert checkpoints[2]['items'] == checkpoints[3]['items']
        assert unread(checkpoints[4]['items']) == {transport['incomingId']}
        assert checkpoints[11]['snapshots'] == checkpoints[12]['snapshots'], 'restart changed persisted accounts'
        assert checkpoints[14]['snapshots'] == checkpoints[15]['snapshots'], 'final relaunch changed persisted accounts'
        assert controller['finalFeed'] == checkpoints[-1]['items'] and not unread(controller['finalFeed'])
    check('sixteen-native-checkpoints-and-durable-read-timestamps', checkpoint_check)

    def account_check():
        links = transport['links']
        assert [link['account'] for link in links] == ['A', 'B', 'A'] and [link['epoch'] for link in links] == [0, 1, 2], 'normal A-to-B-to-A QR linking is incomplete'
        assert all(link[key] is True for link in links for key in ('authorized', 'storedCiphertextMatches', 'tokenPresent'))
        assert transport['approvalEndpointStatus'] == 200
        assert sum(row['phase'] == 'bell-ready' for row in native['authDiagnostics']) == 3, 'three native authenticated bell-ready states required'
        assert native['nativePhases'].count('auth-login') == 3 and 'account-b' in native['nativePhases'] and 'account-a' in native['nativePhases']
        assert links[0]['approvedAt'] < checkpoints[0]['at']
        assert checkpoints[7]['at'] < links[1]['approvedAt'] < checkpoints[8]['at']
        assert checkpoints[9]['at'] < links[2]['approvedAt'] < checkpoints[10]['at']
        protected = unread(checkpoints[10]['items'])
        assert len(protected) == 1 and unread(checkpoints[8]['snapshots']['A']) == unread(checkpoints[9]['snapshots']['A']) == protected
        assert unread(checkpoints[6]['snapshots']['B']) == unread(checkpoints[7]['snapshots']['B']) == unread(checkpoints[8]['items'])
        assert not unread(checkpoints[9]['items']) and all(not unread(row['snapshots']['B']) for row in checkpoints[10:])
    check('native-normal-A-B-A-auth-and-account-scope', account_check)

    def race_check():
        assert 'nativeRace' in controller, 'native pending-Done race receipt is absent'
        race, relay = controller['nativeRace'], controller['nativeTransportRelay']
        assert race['nativePendingObserved'] is True and race['nativeArrivalObservedWhilePending'] is True, 'native arrival while Done pending was not observed'
        assert relay['failed'] is False and relay['nativeClientVerified'] is True
        assert relay['armCount'] == relay['heldCount'] == relay['releaseCount'] == 1, 'exactly one native-origin request must be held and forwarded'
        assert [row['type'] for row in relay['events']] == ['armed', 'held', 'released']
        assert all(row['through'] == race['through'] for row in relay['events'])
        assert cursor(race['incomingCursor']) > cursor(race['through'])
        assert unread(checkpoints[10]['items']) == {race['beforeId']} and unread(checkpoints[11]['items']) == {race['incomingId']}
        before = {item['id']: item for item in checkpoints[10]['items']}
        after = {item['id']: item for item in checkpoints[11]['items']}
        assert before[race['beforeId']]['cursor'] == race['through'] and before[race['beforeId']]['readAt'] is None
        assert after[race['beforeId']]['readAt'] is not None and after[race['incomingId']]['cursor'] == race['incomingCursor']
    check('native-origin-pending-Done-newer-arrival-race', race_check)

    def restart_check():
        assert 'nativeRestart' in controller, 'native durable restart/reconnect receipt is absent'
        restart, relay = controller['nativeRestart'], controller['nativeTransportRelay']
        assert restart['accountsRetained'] == ['A', 'B'] and restart['snapshots'] == checkpoints[11]['snapshots']
        assert restart['restarts'] == server['restarts'] == 2
        assert restart['browserContextsOffline'] is True and restart['nativeReceivedAfterReconnect'] is True, 'native-only post-restart arrival proof missing'
        assert restart['previousPid'] != restart['currentPid'] and all(type(restart[key]) is int and restart[key] > 1 for key in ('previousPid', 'currentPid'))
        old, new = restart['previousNativeConnection'], restart['reconnectedNativeConnection']
        connections = {row['id']: row for row in relay['connections']}
        assert old != new and connections[old]['connected'] is True and connections[old]['closed'] is True and connections[new]['connected'] is True
        assert unread(checkpoints[13]['items']) > unread(checkpoints[12]['items']) and len(unread(checkpoints[13]['items'])) == 2
        assert not unread(checkpoints[14]['items']) and not unread(checkpoints[15]['items'])
        starts = [row for row in server['events'] if row['type'] == 'serve-start']
        assert sum(row['type'] == 'explicit-restart-request' for row in server['events']) == 2, 'exactly two intentional isolated server restarts required'
        assert len(starts) == 3 and len({row['serverPid'] for row in starts}) == 3 and len({row['runnerPid'] for row in starts}) == 1
        assert starts[1]['serverPid'] == restart['previousPid'] and starts[2]['serverPid'] == restart['currentPid']
    check('durable-native-only-server-restart-and-reconnect', restart_check)

    def cleanup_check():
        assert native['cleanup'] == {'shutdownExitCode': 0, 'deleteExitCode': 0}, 'owned simulator cleanup incomplete'
        assert native['resourceStopped'] is False
        policy, resources = native['resourcePolicy'], native['resources']
        assert policy['hostDiskMinimumGiB'] == 10 and policy['memoryAvailableMinimumPercent'] == 15 and policy['localHostThresholdsChanged'] is False
        assert resources['sampleCount'] > 0 and resources['minimumDiskFreeBytes'] >= 10 * 1024**3 and resources['minimumMemoryAvailablePercent'] >= 15
        assert server.get('stoppedAt') and not server.get('firstFailure'), 'owned server cleanup incomplete'
        assert server['appliedMigrations'] == controller['migrationCount'] == len(server['migrationNames']) == 41
        assert len(set(server['migrationNames'])) == 41
        events = server['events']
        exits = [row for row in events if row['type'] in ('migrate-exit', 'serve-exit')]
        assert len(exits) == 1 + sum(row['type'] == 'serve-start' for row in events) and all(row['code'] == 0 and row['signal'] is None for row in exits)
        assert all(row['port'] == 43546 for row in events if row['type'] == 'serve-start')
    check('original-resource-thresholds-and-owned-cleanup', cleanup_check)

    result = {
        'auditStatus': 'RECEIPT_CHECKS_PASS' if not failures else 'INCOMPLETE_OR_FAILED',
        'sourceSha': args.source_sha, 'nativeSourceSha': NATIVE_SHA,
        'passedChecks': passed, 'failures': failures,
        'observedCounts': {'nativeCheckpoints': len(checkpoints), 'nativeCaptures': len(native.get('screenshots', [])),
                           'nativeAuthEpochs': len(transport.get('links', [])), 'webStages': len(web.get('checks', []))},
        'missingNativeCheckpoints': [name for name in NATIVE_STAGES if name not in by_stage],
        'limits': ['This is a read-only receipt/source/hash audit, not a new simulator execution.',
                   'All 35 PNGs still require separate visual and publication privacy review.',
                   'Native-only connection attribution uses the exact-head controller assertions and fixed receipt flags; the relay intentionally records no account or raw socket payloads.',
                   'GitHub exact-head CI, installers, image/goldens, current-main and mergeability remain separate gates.'],
    }
    print(json.dumps(result, indent=2))
    return 0 if not failures else 1


if __name__ == '__main__':
    sys.exit(main())
