"""Exercise bounded diagnostic collection without Xcode or a simulator."""
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('native_driver', Path(__file__).with_name('native-driver.py'))
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)


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
