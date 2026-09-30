"""Exercise bounded diagnostic collection without Xcode or a simulator."""
import importlib.util
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
