#!/usr/bin/env python3
"""Run the issue-345 XCTest on a new private hosted iOS simulator.

Inputs: RUNNER_TEMP, HH345_SOURCE_SHA, HH345_NATIVE_SHA, HH345_APP_ARTIFACT
(directory with HappyHerd.app.zip/build-manifest.json/archive.sha256/signing-receipt.json),
HH345_APP_PATH (byte-faithful, normally Xcode-signed extracted app),
HH345_ARTIFACT_DIR (PRIVATE),
HH345_PROOF_DIR (public allowlist), HH345_FIRST_ID and HH345_SECOND_ID.
Requires selected Xcode, xcodegen and its matching installed iOS/iPhone 17 runtime.
The companion coordinator must already serve localhost:43547 and the real
isolated application API localhost:43545. No account secret enters this driver.
Stdout contains only the two static HH345 coordination markers.
"""
from pathlib import Path
import hashlib
import importlib.util
import json
import os
import platform
import plistlib
import re
import selectors
import shutil
import signal
import subprocess
import sys
import tempfile
import time

EXPECTED_SHA = '4933c0c727b08f2dbe7f90ae5e261d89a917e0de'
EXPECTED_ARCHIVE_SHA = '0a692dee476bc6fb12a79879a75fb7865c7ace0c2c3ab4960b90b26cc1d762b5'
APP_ID = 'app.happyherd.issue345.acceptance'
RUNNER_ID = 'app.happyherd.issue345.uitests.xctrunner'
MARKERS = ('HH345_READY_FOR_NEW_ARRIVAL', 'HH345_READY_FOR_REMOTE_DONE',
           'HH345_NATIVE_ACCOUNT_SCOPE', 'HH345_NATIVE_DONE_RACE', 'HH345_NATIVE_SERVER_RESTART')
STAGES = (
    '00-native-server-before-authentication', '00a-native-inbox-before-assertions',
    '01-native-inbox-unread',
    '02-native-inbox-single-read', '03-native-inbox-done',
    '04-native-inbox-after-relaunch', '05-native-inbox-new-arrival',
    '06-native-inbox-remote-done',
    '07-native-account-a-unread', '08-native-account-a-done',
    '09-native-account-b-unread', '10-native-account-b-done', '11-native-account-a-restored',
    '12-native-race-new-arrival', '13-native-after-server-restart',
    '14-native-reconnected-new-arrival', '15-native-reconnected-done', '16-native-final-relaunch',
)
UUID = r'[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}'
AUTH_PHASES = {'after-approval', 'notification-declined', 'bell-ready', 'failure'}
AUTH_STATES = {'unknown', 'not-running', 'background-suspended', 'background', 'foreground'}
AUTH_BOOLEANS = ('qrRouteVisible', 'loginVisible', 'bellVisible', 'appAlertPresent',
                 'systemAlertPresent', 'notificationPromptSeen', 'notificationPromptDeclined')
AUTH_FAILURES = {'login-control-missing', 'qr-unavailable', 'approval-unacknowledged', 'bell-unavailable'}
NATIVE_PHASES = {
    'setup', 'activate', 'startup-wait', 'startup-ready', 'open-server', 'server-field',
    'server-value', 'server-capture', 'open-root', 'auth', 'auth-login', 'auth-qr',
    'auth-approval', 'auth-bell', 'inbox-bell', 'inbox-popover', 'inbox-open-page',
    'inbox-ready', 'inbox-unread', 'single-read', 'single-read-navigation',
    'single-read-state', 'mark-all-read', 'all-read-state', 'relaunch', 'relaunch-bell',
    'persisted-read-state', 'new-arrival', 'remote-done', 'complete',
    'account-scope', 'account-logout', 'account-b', 'account-a', 'done-race', 'race-pending',
    'server-restart', 'reconnected-arrival', 'reconnected-done', 'final-relaunch',
}
NATIVE_BOOLEANS = ('uiQueried', 'loginVisible', 'qrRouteVisible', 'serverFieldVisible',
                   'appAlertPresent', 'systemAlertPresent')
AUTH_LOG_PATTERNS = {
    'qrDecryptSuccess': r'\bAuthentication successful\b',
    'qrDecryptFailure': r'Failed to decrypt response\. Please try again\.',
    'credentialWriteFailure': r'Error setting credentials:',
    'backupStateWriteFailure': r'Error setting account key backup state:',
    'missingEntitlementName': r'\berrSecMissingEntitlement\b',
    'missingEntitlementStatus': r'(?<![\w-])-34018(?!\w)',
    'missingEntitlementMessage': r"A required entitlement (?:isn't present|is missing)\.",
}
LAUNCH_LOG_PREDICATE = (
    '(process == "HappyHerd" OR ((process == "runningboardd" OR '
    'process == "SpringBoard" OR process == "launchd" OR process == "launchd_sim" OR '
    'process == "amfid" OR process == "ReportCrash") AND '
    'eventMessage CONTAINS "' + APP_ID + '")) AND ('
    'messageType == error OR messageType == fault OR '
    + ' OR '.join('eventMessage CONTAINS[c] "' + term + '"' for term in
                  ('denied', 'reject', 'failed', 'crash', 'signature', 'entitlement')) + ')'
)
launch_spec = importlib.util.spec_from_file_location(
    'launch_diagnostics', Path(__file__).with_name('launch-diagnostics.py'))
launch_diagnostics = importlib.util.module_from_spec(launch_spec)
launch_spec.loader.exec_module(launch_diagnostics)

AUTH_LOG_PREDICATE = 'process == "HappyHerd" AND (' + ' OR '.join(
    'eventMessage CONTAINS "' + text + '"' for text in (
        'Authentication successful', 'Failed to decrypt response.',
        'Error setting credentials:', 'Error setting account key backup state:',
        'errSecMissingEntitlement', '-34018', 'A required entitlement',
    )) + ')'


def auth_log_counts(messages):
    """Publish only counts of code-owned strings, never input messages."""
    counts = dict.fromkeys(AUTH_LOG_PATTERNS, 0)
    for message in messages:
        for name, pattern in AUTH_LOG_PATTERNS.items():
            counts[name] += len(re.findall(pattern, message))
    return counts


def private_test_auth_counts(path):
    result = {'source': 'private-xctest-log', 'available': False,
              'counts': auth_log_counts([]), 'outputLimitReached': False}
    try:
        # This log already exists privately. Do not make another raw copy.
        with path.open('rb') as stream:
            data = stream.read(1024 * 1024 + 1)
        result.update(available=True, outputLimitReached=len(data) > 1024 * 1024,
                      counts=auth_log_counts([data[:1024 * 1024].decode('utf-8', errors='replace')]))
    except OSError:
        result['notAvailableReason'] = 'read-failed'
    return result


def bounded_log_diagnostic(command, env, cwd, timeout=20, limit=256 * 1024,
                           classify=auth_log_counts, field='counts'):
    """Read a selected owned-simulator log in memory; never persist raw output."""
    result = {'source': 'owned-simulator-unified-log', 'startedAt': time.time(),
              'available': False, 'exitCode': None, field: classify([]),
              'outputLimitReached': False, 'timedOut': False}
    process = None
    data = bytearray()
    try:
        process = subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, start_new_session=True)
        deadline = time.monotonic() + timeout
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while selector.get_map():
                if time.monotonic() >= deadline:
                    result.update(timedOut=True, notAvailableReason='timed-out')
                    break
                for key, _ in selector.select(min(0.25, max(0, deadline - time.monotonic()))):
                    chunk = os.read(key.fd, min(8192, limit + 1 - len(data)))
                    if not chunk:
                        selector.unregister(key.fileobj)
                    else:
                        data.extend(chunk)
                if len(data) > limit:
                    result.update(outputLimitReached=True, notAvailableReason='output-limit')
                    break
        if 'notAvailableReason' not in result:
            try:
                process.wait(timeout=max(0.01, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                result.update(timedOut=True, notAvailableReason='timed-out')
    except Exception:
        result['notAvailableReason'] = 'command-unavailable'
    finally:
        if process is not None:
            bounded_stop = result['timedOut'] or result['outputLimitReached']
            if process.poll() is None or bounded_stop:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.wait(timeout=2)
                if bounded_stop:
                    # A leader may exit while its child still holds the pipe.
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            result['exitCode'] = process.returncode
            if process.stdout is not None:
                process.stdout.close()
        result['finishedAt'] = time.time()
    if 'notAvailableReason' not in result:
        if result['exitCode'] != 0:
            result['notAvailableReason'] = 'command-failed'
        else:
            try:
                entries = json.loads(data)
                if not isinstance(entries, list):
                    raise ValueError()
                result.update(available=True)
                result[field] = classify(
                    entry['eventMessage'] for entry in entries if isinstance(entry, dict)
                    and isinstance(entry.get('eventMessage'), str))
            except (ValueError, UnicodeError):
                result['notAvailableReason'] = 'unreadable-result'
    return result


def parse_auth_diagnostic(line):
    """Accept only the complete, typed, code-owned diagnostic marker."""
    prefix = 'HH345_AUTH_DIAGNOSTICS '
    if not line.startswith(prefix):
        return None
    pairs = [part.split('=', 1) for part in line[len(prefix):].split(' ')]
    expected = {'phase', 'appState', *AUTH_BOOLEANS}
    if len(pairs) != len(expected) or any(len(pair) != 2 for pair in pairs):
        return None
    fields = dict(pairs)
    if set(fields) != expected or fields['phase'] not in AUTH_PHASES or fields['appState'] not in AUTH_STATES:
        return None
    if any(fields[key] not in ('true', 'false') for key in AUTH_BOOLEANS):
        return None
    return {'phase': fields['phase'], 'appState': fields['appState'],
            **{key: fields[key] == 'true' for key in AUTH_BOOLEANS}}


def parse_native_diagnostic(line):
    """Static phases are retained even if an optional failure-state query fails."""
    phase = re.fullmatch(r'HH345_NATIVE_(PHASE|FAILURE) phase=([a-z-]+)', line)
    if phase:
        if phase[2] in NATIVE_PHASES:
            return {'kind': phase[1].lower(), 'phase': phase[2]}
        return None
    prefix = 'HH345_NATIVE_STATE '
    if not line.startswith(prefix):
        return None
    pairs = [part.split('=', 1) for part in line[len(prefix):].split(' ')]
    expected = {'phase', 'appState', *NATIVE_BOOLEANS}
    if len(pairs) != len(expected) or any(len(pair) != 2 for pair in pairs):
        return None
    fields = dict(pairs)
    if set(fields) != expected or fields['phase'] not in NATIVE_PHASES or fields['appState'] not in AUTH_STATES:
        return None
    if any(fields[key] not in ('true', 'false') for key in NATIVE_BOOLEANS):
        return None
    if fields['uiQueried'] == 'false' and any(fields[key] != 'false' for key in NATIVE_BOOLEANS[1:]):
        return None
    return {'kind': 'state', 'phase': fields['phase'], 'appState': fields['appState'],
            **{key: fields[key] == 'true' for key in NATIVE_BOOLEANS}}


class DriverRequirementError(RuntimeError):
    """A static, code-owned failure message safe for the public receipt."""


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def require(condition, message):
    if not condition:
        raise DriverRequirementError(message)


def main():
    source = Path(__file__).resolve().parent
    attempt = str(time.time_ns())
    private = Path(os.environ['HH345_ARTIFACT_DIR']).resolve() / 'native-private' / attempt
    proof = Path(os.environ['HH345_PROOF_DIR']).resolve() / 'native' / attempt
    require(not private.is_relative_to(proof) and not proof.is_relative_to(private),
            'Private results and public proof must be separate.')
    private.mkdir(parents=True)
    proof.mkdir(parents=True)
    work = Path(tempfile.mkdtemp(prefix='hh345-native-', dir=os.environ['RUNNER_TEMP']))
    device_set = work / 'Simulators'
    device_set.mkdir()
    (work / 'tmp').mkdir()
    env = {key: os.environ[key] for key in ('PATH', 'HOME', 'USER', 'LOGNAME', 'DEVELOPER_DIR')
           if key in os.environ}
    env.update(TMPDIR=str(work / 'tmp') + '/', TZ='UTC', LANG='en_US.UTF-8')
    simctl = ['/usr/bin/xcrun', 'simctl', '--set', str(device_set)]
    receipt = {
        'attempt': attempt, 'startedAt': time.time(), 'phase': 'preflight',
        'sourceSha': os.environ.get('HH345_SOURCE_SHA'),
        'nativeSourceSha': EXPECTED_SHA, 'platform': 'iOS Simulator (not physical device)',
        'taskSpecificNativeSourcePatches': [], 'resourceStopped': False,
        'resourcePolicy': {'hostDiskMinimumGiB': 10, 'memoryAvailableMinimumPercent': 15,
                           'swapPolicy': 'record only on this independent hosted host',
                           'localHostThresholdsChanged': False},
        'commands': [], 'markers': [], 'qrDiagnostics': [], 'authDiagnostics': [], 'authFailures': [], 'screenshots': [],
        'nativePhases': [], 'nativeFailures': [], 'nativeStates': [],
        'passed': False,
    }
    samples = []
    active = None
    udid = None
    result = private / 'test.xcresult'
    status = 1

    def save():
        (private / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')

    def resources():
        memory = subprocess.check_output(['/usr/bin/memory_pressure', '-Q'], text=True, timeout=10)
        swap = subprocess.check_output(['/usr/sbin/sysctl', '-n', 'vm.swapusage'], text=True, timeout=10)
        match = re.search(r'used = ([\d.]+)([MG])', swap)
        return {
            'time': time.time(), 'diskFreeBytes': shutil.disk_usage(work).free,
            'memoryAvailablePercent': int(re.search(r'free percentage: (\d+)%', memory).group(1)),
            'swapUsedMiB': float(match.group(1)) * (1024 if match.group(2) == 'G' else 1),
        }

    def check_resources():
        sample = resources()
        samples.append(sample)
        receipt['resources'] = {
            'initial': samples[0], 'latest': sample, 'sampleCount': len(samples),
            'minimumDiskFreeBytes': min(s['diskFreeBytes'] for s in samples),
            'minimumMemoryAvailablePercent': min(s['memoryAvailablePercent'] for s in samples),
            'maximumSwapUsedMiB': max(s['swapUsedMiB'] for s in samples),
        }
        if sample['diskFreeBytes'] < 10 * 1024**3 or sample['memoryAvailablePercent'] < 15:
            receipt['resourceStopped'] = True
        save()
        require(not receipt['resourceStopped'], 'Hosted resource floor crossed.')

    def stop_active():
        if active is not None and active.poll() is None:
            try:
                os.killpg(active.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                active.wait(timeout=15)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(active.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                active.wait()

    def scan_output(chunk, pending):
        pending += chunk
        lines = pending.split('\n')
        for line in lines[:-1]:
            line = line.strip()
            if line in MARKERS and line not in receipt['markers']:
                receipt['markers'].append(line)
                save()
                print(line, flush=True)
            if line.startswith('HH345_QR_DIAGNOSTICS '):
                fields = dict(re.findall(r'(\w+)=(\d+|true|false)', line))
                allowed = {}
                for key in ('attempts', 'featuresMax'):
                    if key in fields and fields[key].isdigit():
                        allowed[key] = int(fields[key])
                for key in ('payloadPresent', 'linkShapeMatched', 'routeVisible',
                            'errorAlertPresent', 'decoderSetupError'):
                    if fields.get(key) in ('true', 'false'):
                        allowed[key] = fields[key] == 'true'
                if allowed:
                    receipt['qrDiagnostics'].append(allowed)
                    save()
            native_diagnostic = parse_native_diagnostic(line)
            if native_diagnostic is not None:
                kind = native_diagnostic.pop('kind')
                if kind == 'state':
                    receipt['nativeStates'].append(native_diagnostic)
                else:
                    receipt['nativePhases' if kind == 'phase' else 'nativeFailures'].append(native_diagnostic['phase'])
                save()
            auth_diagnostic = parse_auth_diagnostic(line)
            if auth_diagnostic is not None:
                receipt['authDiagnostics'].append(auth_diagnostic)
                save()
            failure = re.fullmatch(r'HH345_AUTH_FAILURE reason=([a-z-]+)', line)
            if failure and failure[1] in AUTH_FAILURES:
                receipt['authFailures'].append(failure[1])
                save()
        return lines[-1][-2048:]

    def run(command, phase, timeout=300, check=True):
        nonlocal active
        receipt['phase'] = phase
        check_resources()
        log_path = private / (phase + '.log')
        entry = {'phase': phase, 'startedAt': time.time()}
        receipt['commands'].append(entry)
        save()
        with log_path.open('w') as output:
            active = subprocess.Popen(command, cwd=work, env=env, stdout=output,
                                      stderr=subprocess.STDOUT, start_new_session=True)
            try:
                pending = ''
                with log_path.open() as reader:
                    while active.poll() is None:
                        check_resources()
                        pending = scan_output(reader.read(), pending)
                        require(time.time() - entry['startedAt'] < timeout, 'Owned command timed out.')
                        time.sleep(2)
                    scan_output(reader.read() + '\n', pending)
                entry['exitCode'] = active.returncode
                entry['finishedAt'] = time.time()
                save()
                check_resources()
                if check:
                    require(active.returncode == 0, 'Owned command failed; private log retained.')
            finally:
                stop_active()
                entry.update(exitCode=active.returncode, finishedAt=time.time())
                save()
        return log_path, active.returncode

    def command_json(command, phase):
        log, _ = run(command, phase)
        return json.loads(log.read_text())

    def installed(bundle_id):
        log, _ = run(simctl + ['get_app_container', udid, bundle_id, 'app'],
                     'container-' + bundle_id.rsplit('.', 1)[-1])
        path = Path(log.read_text().strip()).resolve()
        require(path.is_relative_to(device_set), 'App container must belong to the private set.')
        require(plistlib.loads((path / 'Info.plist').read_bytes())['CFBundleIdentifier'] == bundle_id,
                'Installed bundle identity mismatch.')
        return path

    def export_evidence():
        raw_summary = command_json(
            ['/usr/bin/xcrun', 'xcresulttool', 'get', 'test-results', 'summary',
             '--path', str(result), '--compact'], 'result-summary')
        summary = {}
        for key in ('totalTestCount', 'passedTests', 'failedTests', 'skippedTests', 'expectedFailures'):
            if isinstance(raw_summary.get(key), int):
                summary[key] = raw_summary[key]
        if raw_summary.get('result') in ('Passed', 'Failed', 'Skipped', 'Expected Failure', 'unknown'):
            summary['result'] = raw_summary['result']
        (proof / 'test-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
        receipt['testSummary'] = summary
        # Read only XCTest failure text; the classifier emits fixed enums and
        # allowlisted Apple domains/numeric codes, never descriptions or URLs.
        failures = raw_summary.get('testFailures', [])
        receipt['xctestLaunchFailures'] = launch_diagnostics.classify_launch_messages(
            row[key] for row in failures if isinstance(row, dict)
            for key in ('failureText', 'message') if isinstance(row.get(key), str))
        save()
        attachments = private / 'attachments'
        run(['/usr/bin/xcrun', 'xcresulttool', 'export', 'attachments', '--path', str(result),
             '--output-path', str(attachments)], 'export-private-attachments')
        manifest = json.loads((attachments / 'manifest.json').read_text())
        png_dir = proof / 'png'
        png_dir.mkdir()
        for test in manifest:
            for attachment in test.get('attachments', []):
                label = attachment.get('suggestedHumanReadableName', '')
                for stage in STAGES:
                    if not re.fullmatch(re.escape(stage) + r'_\d+_' + UUID + r'\.png', label):
                        continue
                    name = attachment['exportedFileName']
                    require(Path(name).name == name and name.endswith('.png'), 'Unexpected attachment path.')
                    image = attachments / name
                    with image.open('rb') as stream:
                        require(stream.read(8) == b'\x89PNG\r\n\x1a\n', 'Expected intentional PNG attachment.')
                    destination = png_dir / (stage + '.png')
                    require(not destination.exists(), 'Duplicate intentional screenshot.')
                    shutil.copy2(image, destination)
                    receipt['screenshots'].append({'stage': stage, 'file': 'png/' + destination.name,
                                                   'sha256': digest(destination), 'bytes': destination.stat().st_size})
        return summary

    def interrupted(_signal, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    save()
    try:
        require(sys.platform == 'darwin' and platform.machine() == 'arm64', 'Expected arm64 hosted macOS.')
        require(os.environ.get('HH345_NATIVE_SHA') == EXPECTED_SHA, 'Native source must be the verified normal-signing build.')
        require(re.fullmatch(r'[0-9a-f]{64}', EXPECTED_ARCHIVE_SHA), 'Signed archive selection is pending verified build evidence.')
        require(re.fullmatch(r'[0-9a-f]{40}', receipt['sourceSha'] or ''), 'Expected proof source SHA.')
        check_resources()
        receipt['hardware'] = {
            'architecture': platform.machine(),
            'memoryBytes': int(subprocess.check_output(['/usr/sbin/sysctl', '-n', 'hw.memsize'], text=True)),
            'cpuCount': int(subprocess.check_output(['/usr/sbin/sysctl', '-n', 'hw.ncpu'], text=True)),
            'macOSVersion': subprocess.check_output(['/usr/bin/sw_vers', '-productVersion'], text=True).strip(),
        }
        xcode_log, _ = run(['/usr/bin/xcodebuild', '-version'], 'xcode-version')
        receipt['xcodeVersion'] = xcode_log.read_text().strip()
        artifact = Path(os.environ['HH345_APP_ARTIFACT']).resolve()
        app = Path(os.environ['HH345_APP_PATH']).resolve()
        verification_spec = importlib.util.spec_from_file_location('hh345_selected_app', source / 'verify-hosted-app.py')
        verifier = importlib.util.module_from_spec(verification_spec)
        verification_spec.loader.exec_module(verifier)
        require(verifier.EXPECTED_SHA == EXPECTED_SHA and verifier.EXPECTED_ARCHIVE_SHA == EXPECTED_ARCHIVE_SHA,
                'Driver and selected artifact verifier must agree.')
        archive_receipt, manifest = verifier.verify_archive(artifact)
        extracted = verifier.verify_extracted(app, archive_receipt, manifest)
        require(extracted['buildSigningVerified'] is True, 'Expected strictly verified normal Xcode signing.')
        signing_path = Path(os.environ['HH345_PROOF_DIR']) / 'native-app-signing.json'
        require(digest(signing_path) == manifest['signingReceiptSha256'],
                'Published signing receipt differs from selected build manifest.')
        files = manifest['files']
        receipt['buildSigningVerified'] = True
        info = plistlib.loads((app / 'Info.plist').read_bytes())
        require(info['CFBundleIdentifier'] == APP_ID and info['DTPlatformName'] == 'iphonesimulator',
                'Expected isolated simulator app.')
        config = json.loads((app / manifest['appConfigPath']).read_text())
        require(config['extra']['app']['buildCommitSha'] == EXPECTED_SHA, 'Embedded source SHA mismatch.')
        require(b'http://127.0.0.1:43545' in (app / 'main.jsbundle').read_bytes(), 'Isolated API missing.')
        receipt['app'] = {'archiveSha256': EXPECTED_ARCHIVE_SHA, 'filesVerified': len(files),
                          'bundleSha256': digest(app / 'main.jsbundle'),
                          'executableSha256': digest(app / info['CFBundleExecutable']),
                          'buildManifestSha256': digest(artifact / 'build-manifest.json'),
                          'bundleIdentifier': APP_ID,
                          'signingReceiptSha256': digest(signing_path)}
        first_id, second_id = os.environ.get('HH345_FIRST_ID', ''), os.environ.get('HH345_SECOND_ID', '')
        require(first_id and second_id and first_id != second_id, 'Expected two distinct nonsecret feed IDs.')
        receipt['nonsecretFeedIds'] = [first_id, second_id]
        test_project = work / 'xcuitest'
        shutil.copytree(source / 'xcuitest', test_project)
        receipt['testSourceSha256'] = digest(test_project / 'Tests/InboxAcceptanceTests.swift')
        generator = shutil.which('xcodegen', path=env['PATH'])
        require(generator is not None, 'Workflow must provide xcodegen.')
        run([generator, 'generate', '--spec', str(test_project / 'project.yml'),
             '--project', str(test_project)], 'generate-test-project')
        derived = work / 'UITestDerivedData'
        project = test_project / 'HH345Acceptance.xcodeproj'
        run(['/usr/bin/xcodebuild', '-project', str(project), '-scheme', 'HH345UITests',
             '-configuration', 'Debug', '-sdk', 'iphonesimulator',
             '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', str(derived),
             '-jobs', '1', 'CODE_SIGNING_ALLOWED=NO', 'ARCHS=arm64', 'ONLY_ACTIVE_ARCH=YES',
             'IPHONEOS_DEPLOYMENT_TARGET=17.0', 'COMPILER_INDEX_STORE_ENABLE=NO',
             '-resultBundlePath', str(private / 'build.xcresult'), 'build-for-testing'],
            'build-tests', timeout=900)
        products = derived / 'Build/Products'
        originals = list(products.glob('HH345UITests_iphonesimulator*.xctestrun'))
        require(len(originals) == 1, 'Expected one generated simulator manifest.')
        original = originals[0]
        original_hash = digest(original)
        runner = products / 'Debug-iphonesimulator/HH345UITests-Runner.app'
        runner_info = plistlib.loads((runner / 'Info.plist').read_bytes())
        require(runner_info['CFBundleIdentifier'] == RUNNER_ID, 'Runner identity mismatch.')
        runner_binary = runner / runner_info['CFBundleExecutable']
        test_relative = 'PlugIns/HH345UITests.xctest/HH345UITests'
        receipt['runner'] = {'bundleIdentifier': RUNNER_ID, 'executableSha256': digest(runner_binary),
                             'testExecutableSha256': digest(runner / test_relative),
                             'originalXctestrunSha256': original_hash}

        sdk_log, _ = run(['/usr/bin/xcrun', '--sdk', 'iphonesimulator', '--show-sdk-version'],
                         'simulator-sdk-version')
        sdk_version = sdk_log.read_text().strip()
        require(sdk_version == '26.2', 'Expected the selected Xcode 26.2 simulator SDK.')
        runtimes = command_json(simctl + ['list', 'runtimes', '-j'], 'list-runtimes')['runtimes']
        receipt['runtimeSelection'] = {
            'sdkVersion': sdk_version, 'policy': 'exact installed SDK-version match',
            'installedIOS': [{k: r[k] for k in ('identifier', 'version', 'isAvailable') if k in r}
                             for r in runtimes if r['identifier'].startswith('com.apple.CoreSimulator.SimRuntime.iOS-')],
        }
        choices = [r for r in runtimes if r.get('isAvailable') and
                   r.get('version') == sdk_version and
                   r['identifier'].startswith('com.apple.CoreSimulator.SimRuntime.iOS-')]
        require(choices, 'Installed SDK-matching iOS runtime required; driver never installs runtimes.')
        runtime = max(choices, key=lambda r: tuple(int(n) for n in r['version'].split('.')))
        device_type = 'com.apple.CoreSimulator.SimDeviceType.iPhone-17'
        types = command_json(simctl + ['list', 'devicetypes', '-j'], 'list-device-types')['devicetypes']
        require(any(t['identifier'] == device_type for t in types), 'Installed iPhone 17 type required.')
        log, _ = run(simctl + ['create', 'Issue 345 hosted acceptance', device_type, runtime['identifier']],
                     'create-private-device')
        udid = log.read_text().strip()
        require(re.fullmatch(UUID, udid), 'Expected newly created private UDID.')
        receipt['simulator'] = {'udid': udid, 'deviceType': device_type, 'privateDeviceSet': True,
                                'runtime': {k: runtime[k] for k in ('identifier', 'version', 'buildversion')}}
        save()
        prefix = ['/usr/bin/xcodebuild', '-DVTSimulatorSetLocation=' + str(device_set)]
        destinations, _ = run(prefix + ['-project', str(project), '-scheme', 'HH345UITests',
                                      '-sdk', 'iphonesimulator', '-showdestinations'], 'showdestinations')
        available = destinations.read_text().split('Available destinations for', 1)[-1].split('Ineligible destinations for', 1)[0]
        receipt['destinationCheck'] = {
            'outputSha256': digest(destinations),
            'selectedUDIDPresentAnywhere': udid.lower() in destinations.read_text().lower(),
            'selectedUDIDIneligible': udid.lower() in destinations.read_text().split('Ineligible destinations for', 1)[-1].lower() if 'Ineligible destinations for' in destinations.read_text() else False,
            'selectedUDIDAvailable': bool(re.search(r'id:\s*' + re.escape(udid) + r'\s*[,}]', available, re.IGNORECASE)),
            'availableSimulatorOSVersions': sorted(set(re.findall(r'platform:iOS Simulator[^}]*OS:([0-9.]+)', available))),
        }
        save()
        require(receipt['destinationCheck']['selectedUDIDAvailable'],
                'Exact private UDID unavailable to xcodebuild.')
        receipt['exactPrivateDestinationVerified'] = True
        run(simctl + ['boot', udid, '--arch=arm64'], 'boot-private-device')
        run(simctl + ['bootstatus', udid], 'wait-for-boot', timeout=600)
        run(simctl + ['install', udid, str(app)], 'install-app')
        run(simctl + ['install', udid, str(runner)], 'install-runner')
        installed_app = installed(APP_ID)
        installed_runner = installed(RUNNER_ID)
        require(digest(installed_app / 'main.jsbundle') == receipt['app']['bundleSha256'] and
                digest(installed_app / info['CFBundleExecutable']) == receipt['app']['executableSha256'] and
                digest(installed_app / 'Info.plist') == files['Info.plist'] and
                digest(installed_app / manifest['appConfigPath']) == files[manifest['appConfigPath']],
                'Installed production app hash mismatch.')
        installed_verification = verifier.verify_extracted(installed_app, archive_receipt, manifest)
        require(installed_verification['allFileHashesMatchArchiveManifest'] is True
                and installed_verification['appFileCount'] == len(files)
                and installed_verification['buildSigningVerified'] is True,
                'Installed app must preserve every selected manifest file and its signature.')
        receipt['installedAllManifestFilesVerified'] = True
        require(digest(installed_runner / runner_info['CFBundleExecutable']) == digest(runner_binary) and
                digest(installed_runner / test_relative) == digest(runner / test_relative),
                'Installed test runner hash mismatch.')
        receipt['installedArtifactHashesVerified'] = True
        specification = plistlib.loads(original.read_bytes())
        target = specification['HH345UITests']
        require(target.get('UseUITargetAppProvidedByTests') is True and
                not target.get('UseDestinationArtifacts'), 'Expected generated simulator transport.')
        target.update(SystemAttachmentLifetime='keepNever', UserAttachmentLifetime='keepAlways',
                      PreferredScreenCaptureFormat='screenshots', ParallelizationEnabled=False)
        target.setdefault('EnvironmentVariables', {}).update(HH345_FIRST_ID=first_id, HH345_SECOND_ID=second_id)
        adapted = products / 'HH345UITests.hosted.xctestrun'
        adapted.write_bytes(plistlib.dumps(specification))
        receipt['runner']['adaptedXctestrunSha256'] = digest(adapted)
        _, test_code = run(prefix + [
            'test-without-building', '-xctestrun', str(adapted), '-destination',
            'platform=iOS Simulator,id=' + udid + ',arch=arm64', '-destination-timeout', '30',
            '-parallel-testing-enabled', 'NO', '-maximum-concurrent-test-simulator-destinations', '1',
            '-only-testing:HH345UITests/InboxAcceptanceTests/testNativeInboxReadJourney',
            '-collect-test-diagnostics', 'never', '-testLanguage', 'en', '-testRegion', 'US',
            '-resultBundlePath', str(result)], 'native-journey', timeout=1500, check=False)
        # The device belongs to this attempt. Inspect only its HappyHerd process,
        # after the actual journey and before cleanup; raw log bytes stay in memory.
        log_diagnostic = bounded_log_diagnostic(
            simctl + ['spawn', udid, 'log', 'show', '--last', '10m', '--style', 'json',
                      '--info', '--debug', '--predicate', AUTH_LOG_PREDICATE], env, work)
        launch_log = bounded_log_diagnostic(
            simctl + ['spawn', udid, 'log', 'show', '--last', '10m', '--style', 'json',
                      '--info', '--predicate', LAUNCH_LOG_PREDICATE], env, work,
            classify=launch_diagnostics.classify_launch_messages, field='classification')
        private_launch = {'source': 'private-xctest-log-tail', 'available': False}
        try:
            with (private / 'native-journey.log').open('rb') as stream:
                stream.seek(0, os.SEEK_END)
                length = stream.tell()
                stream.seek(max(0, length - 1024 * 1024))
                data = stream.read(1024 * 1024)
            private_launch.update(available=True, outputLimitReached=length > len(data),
                                  classification=launch_diagnostics.classify_launch_messages(
                                      [data.decode('utf-8', errors='replace')]))
        except OSError:
            private_launch['notAvailableReason'] = 'read-failed'
        receipt['launchLogDiagnostics'] = {
            'zeroMatchesAreInconclusive': True, 'sources': [private_launch, launch_log],
        }
        receipt['commands'].append({
            'phase': 'sanitized-launch-log-diagnostic',
            **{key: launch_log[key] for key in ('startedAt', 'finishedAt', 'exitCode')},
        })
        receipt['authLogDiagnostics'] = {
            'zeroCountsAreInconclusive': True,
            'sources': [private_test_auth_counts(private / 'native-journey.log'), log_diagnostic],
        }
        receipt['commands'].append({
            'phase': 'sanitized-auth-log-diagnostic',
            **{key: log_diagnostic[key] for key in ('startedAt', 'finishedAt', 'exitCode')},
        })
        save()
        require(digest(original) == original_hash, 'Original generated manifest changed.')
        receipt['originalXctestrunUnchanged'] = True
        summary = export_evidence()
        require(test_code == 0 and summary.get('result') == 'Passed' and summary.get('passedTests') == 1
                and summary.get('totalTestCount') == 1 and summary.get('failedTests') == 0
                and summary.get('skippedTests') == 0, 'Actual native test did not pass.')
        require({row['stage'] for row in receipt['screenshots']} == set(STAGES), 'Missing intentional screenshots.')
        require(receipt['markers'] == list(MARKERS), 'Missing ordered native coordination markers.')
        receipt.update(passed=True, phase='completed')
        status = 0
    except KeyboardInterrupt:
        receipt.update(errorType='Interrupted', interrupted=True)
        status = 130
    except DriverRequirementError as error:
        # Every require() call supplies a literal message owned by this driver.
        receipt.update(errorType=type(error).__name__, failureReason=str(error))
        status = 1
    except Exception as error:
        receipt['errorType'] = type(error).__name__
        # Only a static, code-owned phase and error type are published.
        status = 1
    finally:
        stop_active()
        cleanup = {}
        if udid and re.fullmatch(UUID, udid):
            for operation in ('shutdown', 'delete'):
                try:
                    with (private / ('cleanup-' + operation + '.log')).open('w') as output:
                        code = subprocess.run(simctl + [operation, udid], env=env, stdout=output,
                                              stderr=subprocess.STDOUT, timeout=60).returncode
                    cleanup[operation + 'ExitCode'] = code
                except Exception as error:
                    cleanup[operation + 'ErrorType'] = type(error).__name__
            if cleanup.get('deleteExitCode') != 0:
                status = 1
        receipt.update(cleanup=cleanup, finishedAt=time.time(), exitCode=status)
        save()
        # This dictionary contains only explicitly selected public fields. Raw
        # logs, full xcresult, exported AX attachments and device data stay private.
        (proof / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    return status


if __name__ == '__main__':
    sys.exit(main())
