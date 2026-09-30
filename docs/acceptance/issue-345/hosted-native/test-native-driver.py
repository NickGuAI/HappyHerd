"""Exercise bounded diagnostic collection without Xcode or a simulator."""
import importlib.util
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('native_driver', Path(__file__).with_name('native-driver.py'))
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)


class OwnedCrashCollectionTests(unittest.TestCase):
    udid = 'A1111111-1111-4111-8111-111111111111'
    private = 'PRIVATE-account https://private.invalid/token /private/user/path'

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.device_set = self.root / 'Simulators'
        self.executable = self.device_set / self.udid / 'data/Containers/Bundle/Application/container/HappyHerd.app/HappyHerd'
        self.host_home = self.root / 'host'
        self.owned_reports = self.device_set / self.udid / 'data/Library/Logs/CrashReporter'
        self.host_reports = self.host_home / 'Library/Logs/DiagnosticReports'
        self.since = 1790791200
        self.until = self.since + 60

    def write_report(self, name='HappyHerd-private.ips', *, root=None, body=None, modified=None, data=None):
        root = root or self.host_reports
        root.mkdir(parents=True, exist_ok=True)
        if data is None:
            header = {'bug_type': '309', 'bundleID': driver.APP_ID, 'private': self.private}
            payload = {'procName': 'HappyHerd', 'procPath': str(self.executable),
                       'bundleInfo': {'CFBundleIdentifier': driver.APP_ID},
                       'captureTime': datetime.fromtimestamp(self.since + 1, timezone.utc).strftime('%Y-%m-%d %H:%M:%S.%f %z'),
                       'exception': {'type': 'EXC_CRASH', 'signal': 'SIGABRT'}, 'private': self.private}
            payload.update(body or {})
            data = (json.dumps(header) + '\n' + json.dumps(payload)).encode()
        path = root / name
        path.write_bytes(data)
        changed = self.since + 2 if modified is None else modified
        os.utime(path, (changed, changed))
        return path

    def collect(self):
        return driver.collect_owned_crash_reports(self.device_set, self.udid, self.executable,
                                                  self.since, host_home=self.host_home, until=self.until)

    def test_collects_both_owned_locations_without_paths_names_or_raw_report_content(self):
        self.write_report(root=self.owned_reports)
        self.write_report()
        result = self.collect()
        self.assertTrue(result['zeroReportsAreInconclusive'])
        self.assertEqual(len(result['reports']), 2)
        self.assertEqual([row['matchedReports'] for row in result['sources']], [1, 1])
        for report in result['reports']:
            self.assertTrue(report['reportModifiedDuringJourney'])
            self.assertTrue(report['installedProcessPathMatched'])
        for secret in (self.private, str(self.root), self.udid, 'HappyHerd-private', 'captureTime'):
            self.assertNotIn(secret, json.dumps(result))

    def test_stale_wrong_app_wrong_simulator_malformed_and_symlink_candidates_do_not_match(self):
        self.write_report('HappyHerd-stale.ips', modified=self.since - 1)
        self.write_report('HappyHerd-future.ips', modified=self.until + 1)
        self.write_report('HappyHerd-wrong-app.ips', body={'bundleInfo': {'CFBundleIdentifier': self.private}})
        self.write_report('HappyHerd-wrong-simulator.ips', body={'procPath': str(self.executable).replace(self.udid, 'B2222222-2222-4222-8222-222222222222')})
        target = self.write_report('HappyHerd-malformed.ips', data=self.private.encode())
        (self.host_reports / 'HappyHerd-link.ips').symlink_to(target)
        self.write_report('OtherApp-private.ips')
        result = self.collect()
        self.assertEqual(result['reports'], [])
        rejected = result['sources'][1]['rejected']
        self.assertEqual(rejected['outside-time-window'], 2)
        self.assertEqual(rejected['identity-mismatch'], 2)
        self.assertEqual(rejected['malformed'], 1)
        self.assertEqual(rejected['nonregular'], 1)
        self.assertEqual(len(result['rejectedIdentityReports']), 2)
        self.assertEqual({row['rejectionGate'] for row in result['rejectedIdentityReports']},
                         {'body-bundle-identifier', 'installed-path-scope'})
        self.assertNotIn(self.private, json.dumps(result))

    def test_rejected_candidate_retains_only_fixed_identity_diagnostics_and_byte_hash(self):
        path = self.write_report(body={'bundleInfo': {'CFBundleIdentifier': self.private},
                                      'classification': self.private, 'identityChecks': self.private,
                                      'rejectionGate': self.private, 'sourceSha256': self.private,
                                      'exception': {'type': 'EXC_CRASH', 'signal': 'SIGABRT'}})
        result = self.collect()
        self.assertEqual(result['reports'], [])
        self.assertEqual(len(result['rejectedIdentityReports']), 1)
        rejected = result['rejectedIdentityReports'][0]
        self.assertEqual(set(rejected), {'source', 'sourceSha256', 'rejectionGate', 'identityChecks'})
        self.assertEqual(rejected['sourceSha256'], driver.digest(path))
        self.assertEqual(rejected['rejectionGate'], 'body-bundle-identifier')
        self.assertTrue(rejected['identityChecks']['headerBundleMatches'])
        self.assertFalse(rejected['identityChecks']['bodyBundleIdentifierMatches'])
        self.assertTrue(rejected['identityChecks']['installedPathSuffixMatches'])
        self.assertNotIn('classification', rejected)
        self.assertNotIn('EXC_CRASH', json.dumps(result))
        self.assertNotIn(self.private, json.dumps(result))

    def test_invalid_owned_scope_and_symlink_report_directory_are_not_read(self):
        result = driver.collect_owned_crash_reports(self.device_set, self.udid, self.root / 'not-owned', self.since)
        self.assertEqual(result['notAvailableReason'], 'invalid-owned-scope')
        self.assertEqual(result['sources'], [])
        target = self.root / 'elsewhere'
        self.write_report(root=target)
        self.host_reports.parent.mkdir(parents=True)
        self.host_reports.symlink_to(target)
        result = self.collect()
        self.assertFalse(result['sources'][1]['available'])
        self.assertEqual(result['sources'][1]['notAvailableReason'], 'not-regular-directory')
        self.assertEqual(result['reports'], [])

    def test_candidate_listing_and_byte_budgets_are_explicit_and_bounded(self):
        for index in range(17):
            self.write_report(f'HappyHerd-{index}.ips')
        result = self.collect()
        self.assertTrue(result['candidateLimitReached'])
        self.assertEqual(len(result['reports']), 16)
        for index in range(17):
            self.write_report(f'HappyHerd-{index}.ips', body={'bundleInfo': {}})
        result = self.collect()
        self.assertTrue(result['candidateLimitReached'])
        self.assertEqual(len(result['rejectedIdentityReports']), 16)
        self.assertEqual(result['reports'], [])
        for index in range(17):
            self.write_report(f'HappyHerd-{index}.ips', body={'padding': 'x' * (1024 * 1024)})
        result = self.collect()
        self.assertTrue(result['byteLimitReached'])
        self.assertLessEqual(sum(row['bytesRead'] for row in result['sources']), 8 * 1024 * 1024)
        for index in range(130):
            self.write_report(f'Unrelated-{index}.ips')
        for path in self.host_reports.glob('HappyHerd-*.ips'):
            path.unlink()
        result = self.collect()
        self.assertTrue(result['sources'][1]['listingTruncated'])
        self.assertEqual(result['sources'][1]['entriesScanned'], 128)
        self.assertEqual(result['reports'], [])

    def test_oversized_or_unreadable_report_is_inconclusive_without_raw_error(self):
        self.write_report(data=b'x' * (driver.launch_diagnostics.MAX_CRASH_REPORT_BYTES + 1))
        result = self.collect()
        self.assertEqual(result['sources'][1]['rejected']['oversized'], 1)
        self.assertEqual(result['sources'][1]['bytesRead'], 0)
        self.write_report()
        with patch.object(driver.os, 'open', side_effect=PermissionError(self.private)):
            result = self.collect()
        self.assertEqual(result['sources'][1]['rejected']['unreadable'], 1)
        self.assertEqual(result['reports'], [])
        self.assertNotIn(self.private, json.dumps(result))


class ResourceProbeTests(unittest.TestCase):
    def test_success_keeps_exact_commands_bounds_output_and_sampling(self):
        for probe, command in (
            ('memory-pressure', ['/usr/bin/memory_pressure', '-Q']),
            ('swap-usage', ['/usr/sbin/sysctl', '-n', 'vm.swapusage']),
        ):
            receipt, save = {}, Mock()
            with self.subTest(probe=probe), patch.object(driver.subprocess, 'check_output', return_value='private raw output') as call:
                self.assertEqual(driver.resource_probe(probe, receipt, save), 'private raw output')
                call.assert_called_once_with(command, text=True, timeout=10)
                self.assertEqual(receipt, {})
                save.assert_not_called()

    def test_failure_attribution_is_fixed_and_rethrows_original_without_raw_data(self):
        for probe in ('memory-pressure', 'swap-usage'):
            for error, expected in (
                (subprocess.TimeoutExpired(['private-command'], 10, output='private-token', stderr='private-path'),
                 {'category': 'timed-out', 'timeoutSeconds': 10}),
                (subprocess.CalledProcessError(-15, ['private-command'], output='private-token', stderr='private-path'),
                 {'category': 'command-failed', 'returnCode': -15}),
                (FileNotFoundError(2, 'private-error', '/private/path'), {'category': 'unavailable'}),
                (ValueError('private-error https://private.invalid/token'), {'category': 'unexpected'}),
                (subprocess.CalledProcessError('private-return-code', ['private-command']), {'category': 'command-failed'}),
            ):
                receipt, save = {}, Mock()
                with self.subTest(probe=probe, category=expected['category']), \
                        patch.object(driver.subprocess, 'check_output', side_effect=error):
                    with self.assertRaises(type(error)) as caught:
                        driver.resource_probe(probe, receipt, save)
                    self.assertIs(caught.exception, error)
                    self.assertEqual(receipt, {'resourceProbeFailure': {'probe': probe, **expected}})
                    self.assertNotIn('private', json.dumps(receipt))
                    save.assert_called_once_with()

    def test_failed_diagnostic_write_does_not_replace_probe_failure(self):
        original = subprocess.TimeoutExpired(['private-command'], 10, output='private-token')
        receipt = {}
        with patch.object(driver.subprocess, 'check_output', side_effect=original):
            with self.assertRaises(subprocess.TimeoutExpired) as caught:
                driver.resource_probe('memory-pressure', receipt, Mock(side_effect=OSError('private-write-error')))
        self.assertIs(caught.exception, original)
        self.assertEqual(receipt['resourceProbeFailure'], {
            'probe': 'memory-pressure', 'category': 'timed-out', 'timeoutSeconds': 10,
        })


class DiagnosticCollectionTests(unittest.TestCase):
    def collect(self, script, **options):
        return driver.bounded_log_diagnostic(
            [sys.executable, '-c', script], os.environ.copy(), Path.cwd(), **options)

    def test_auth_counts_remain_compatible(self):
        result = self.collect('print(\'[ {"eventMessage": "Authentication successful"} ]\')')
        self.assertTrue(result['available'])
        self.assertEqual(result['counts']['qrDecryptSuccess'], 1)

    def test_swift_phase_contract_matches_public_diagnostic_allowlist(self):
        source = Path(__file__).with_name('xcuitest') / 'Tests/InboxAcceptanceTests.swift'
        body = re.search(r'private enum NativePhase: String \{(.*?)\n    \}', source.read_text(), re.DOTALL)
        self.assertIsNotNone(body)
        phases = set()
        for declaration in re.findall(r'^\s*case (.+)$', body[1], re.MULTILINE):
            for item in declaration.split(','):
                parts = item.strip().split(' = ')
                phases.add(parts[-1].strip('"'))
        self.assertEqual(phases, driver.NATIVE_PHASES,
                         'Swift phase additions must not silently disappear from sanitized receipts')
        for phase in phases:
            for kind in ('PHASE', 'FAILURE'):
                self.assertEqual(driver.parse_native_diagnostic(f'HH345_NATIVE_{kind} phase={phase}'),
                                 {'kind': kind.lower(), 'phase': phase})

    def test_logout_diagnostics_accept_fixed_state_and_reject_private_additions(self):
        phases = sorted(phase for phase in driver.NATIVE_PHASES if phase.startswith('account-logout'))
        self.assertEqual(len(phases), 9)
        for phase in phases:
            state = (f'HH345_NATIVE_STATE phase={phase} appState=foreground '
                     'uiQueried=true loginVisible=false qrRouteVisible=false serverFieldVisible=false '
                     'appAlertPresent=false systemAlertPresent=false')
            parsed = driver.parse_native_diagnostic(state)
            self.assertEqual(parsed['phase'], phase)
            self.assertTrue(parsed['uiQueried'])
            self.assertFalse(parsed['appAlertPresent'])
            for invalid in (state + ' url=https://private.invalid/secret',
                            state.replace('appState=foreground', 'appState=private-secret'),
                            state.replace('loginVisible=false', 'loginVisible=private-secret'),
                            state.replace(f'phase={phase}', 'phase=account-logout-private-secret'),
                            f'HH345_NATIVE_FAILURE phase={phase} private=secret'):
                self.assertIsNone(driver.parse_native_diagnostic(invalid))

    def test_logout_row_diagnostic_distinguishes_missing_ambiguous_and_hittable(self):
        for swipes, prefix, rows, hittable in ((0, 0, 0, False), (7, 0, 1, False),
                                             (12, 0, 1, True), (12, 1, 2, False),
                                             (12, 100, 100, False)):
            line = (f'HH345_LOGOUT_DIAGNOSTICS swipes={swipes} prefixMatches={prefix} '
                    f'rowMatches={rows} rowHittable={str(hittable).lower()} '
                    'scrollViewPresent=true appAlertPresent=false')
            self.assertEqual(driver.parse_logout_diagnostic(line), {
                'swipes': swipes, 'prefixMatches': prefix, 'rowMatches': rows,
                'rowHittable': hittable, 'scrollViewPresent': True, 'appAlertPresent': False,
            })

    def test_logout_row_diagnostic_rejects_private_extra_duplicate_or_malformed_fields(self):
        line = ('HH345_LOGOUT_DIAGNOSTICS swipes=12 prefixMatches=0 rowMatches=1 '
                'rowHittable=true scrollViewPresent=true appAlertPresent=false')
        for invalid in (line + ' label=private-account',
                        line + ' url=https://private.invalid/token',
                        line + ' rowMatches=1',
                        line.replace('prefixMatches=0', 'rowMatches=1'),
                        line.replace('swipes=12', 'swipes=13'),
                        line.replace('swipes=12', 'swipes=-1'),
                        line.replace('swipes=12', 'swipes=12.0'),
                        line.replace('rowMatches=1', 'rowMatches=101'),
                        line.replace('rowMatches=1', 'rowMatches=private-secret'),
                        line.replace('rowMatches=1', 'rowMatches=0'),
                        line.replace('rowMatches=1', 'rowMatches=2'),
                        line.replace('rowHittable=true', 'rowHittable=private-secret'),
                        line.replace('scrollViewPresent=true', 'scrollViewPresent=1'),
                        line.replace('appAlertPresent=false', 'appAlertPresent=private-secret'),
                        line + '\nprivate-account'):
            with self.subTest(invalid=invalid):
                self.assertIsNone(driver.parse_logout_diagnostic(invalid))

    def test_launch_output_contains_no_raw_fields(self):
        message = 'Failed to launch private-app https://private.invalid/secret Error Domain=FBSOpenApplicationServiceErrorDomain Code=1'
        result = self.collect('print(' + repr(json.dumps([{'eventMessage': message, 'private': 'secret'}])) + ')',
                              classify=driver.launch_diagnostics.classify_launch_messages,
                              field='classification')
        self.assertTrue(result['available'])
        self.assertIn('launch-rejected', result['classification']['categories'])
        encoded = json.dumps(result)
        for private in ('private-app', 'private.invalid', 'secret', 'eventMessage'):
            self.assertNotIn(private, encoded)

    def test_output_limit_does_not_publish_partial_bytes(self):
        result = self.collect('print("private-value" * 1000)', limit=64)
        self.assertEqual(result['notAvailableReason'], 'output-limit')
        self.assertTrue(result['outputLimitReached'])
        self.assertFalse(result['available'])
        self.assertNotIn('private-value', json.dumps(result))

    def test_invalid_json_and_nonzero_exit_are_static(self):
        for script, reason in [('print("private-value")', 'unreadable-result'),
                               ('raise SystemExit("private-value")', 'command-failed')]:
            with self.subTest(reason=reason):
                result = self.collect(script)
                self.assertFalse(result['available'])
                self.assertEqual(result['notAvailableReason'], reason)
                self.assertNotIn('private-value', json.dumps(result))

    def test_timeout_stops_child_holding_pipe_after_leader_exits(self):
        with tempfile.TemporaryDirectory() as directory:
            escaped = Path(directory) / 'child-escaped'
            script = ('import os,signal,time\n'
                      'if os.fork() == 0:\n'
                      ' signal.signal(signal.SIGTERM, signal.SIG_IGN)\n'
                      ' time.sleep(1)\n'
                      f' open({str(escaped)!r}, "w").write("escaped")\n'
                      ' os._exit(0)\n'
                      'os._exit(0)\n')
            result = self.collect(script, timeout=0.2)
            self.assertTrue(result['timedOut'])
            self.assertEqual(result['notAvailableReason'], 'timed-out')
            time.sleep(1.1)
            self.assertFalse(escaped.exists(), 'Owned diagnostic child survived its output deadline')


if __name__ == '__main__':
    unittest.main()
