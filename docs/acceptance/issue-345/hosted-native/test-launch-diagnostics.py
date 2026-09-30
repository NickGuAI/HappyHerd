#!/usr/bin/env python3
"""Focused privacy and interpretation tests; all strings are synthetic."""
import importlib.util
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import unittest


SPEC = importlib.util.spec_from_file_location(
    'launch_diagnostics', Path(__file__).with_name('launch-diagnostics.py'))
DIAGNOSTICS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DIAGNOSTICS)
classify = DIAGNOSTICS.classify_launch_messages


class OwnedCrashReportTests(unittest.TestCase):
    app_id = 'app.happyherd.issue345.acceptance'
    udid = 'A1111111-1111-4111-8111-111111111111'
    other_udid = 'B2222222-2222-4222-8222-222222222222'
    executable = '/private/owned/Simulators/' + udid + '/data/Containers/Bundle/Application/owned-container/HappyHerd.app/HappyHerd'
    since = datetime(2026, 9, 30, 18, 0, tzinfo=timezone.utc).timestamp()
    private = 'PRIVATE-account https://private.invalid/token /private/user/path'

    def report(self, header=None, body=None):
        metadata = {'bug_type': '309', 'bundleID': self.app_id, 'app_name': self.private}
        payload = {'procName': 'HappyHerd', 'procPath': self.executable,
                   'bundleInfo': {'CFBundleIdentifier': self.app_id},
                   'captureTime': '2026-09-30 18:00:01.1234 +0000',
                   'coalitionName': 'com.apple.CoreSimulator.SimDevice.' + self.udid,
                   'exception': {'type': 'EXC_CRASH', 'signal': 'SIGABRT', 'message': self.private},
                   'termination': {'namespace': 'SIGNAL', 'code': 6, 'indicator': self.private},
                   'crashReporterKey': self.private}
        metadata.update(header or {})
        payload.update(body or {})
        return (json.dumps(metadata) + '\n' + json.dumps(payload)).encode()

    def classify(self, data):
        return DIAGNOSTICS.classify_owned_crash_report(
            data, app_id=self.app_id, installed_executable=self.executable,
            simulator_udid=self.udid, since=self.since, until=self.since + 60)

    def test_owned_recent_crash_exposes_only_classification_and_hash(self):
        data = self.report()
        result = self.classify(data)
        self.assertEqual(result['status'], 'matched')
        self.assertEqual(result['sourceSha256'], hashlib.sha256(data).hexdigest())
        for key in ('bundleIdentifierMatched', 'installedProcessPathMatched',
                    'simulatorCoalitionMatched', 'capturedDuringJourney'):
            self.assertIs(result[key], True)
        self.assertEqual(result['classification']['categories'], ['process-exited-or-crashed'])
        self.assertEqual(result['classification']['signals'], ['SIGABRT'])
        self.assertEqual(result['termination'], {'namespace': 'SIGNAL', 'code': 6})
        for secret in (self.private, self.udid, self.app_id, 'HappyHerd', 'procPath', 'crashReporterKey'):
            self.assertNotIn(secret, json.dumps(result))

    def test_bundle_process_path_and_simulator_conflicts_are_rejected(self):
        for header, body in (
            ({'bundleID': self.private}, {}),
            ({}, {'bundleInfo': {'CFBundleIdentifier': self.private}}),
            ({}, {'procName': self.private}),
            ({}, {'procPath': self.executable.replace(self.udid, self.other_udid)}),
            ({}, {'procPath': self.executable.replace('owned-container', 'another-container')}),
            ({}, {'procPath': '/Applications/HappyHerd.app/HappyHerd'}),
            ({}, {'procPath': '/private/wrong/HappyHerd'}),
            ({}, {'procPath': self.executable.replace('/data/', '/data/../data/')}),
            ({}, {'coalitionName': 'com.apple.CoreSimulator.SimDevice.' + self.other_udid}),
            ({}, {'procPath': None, 'coalitionName': self.private}),
        ):
            with self.subTest(body=body):
                self.assertEqual(self.classify(self.report(header, body)), {'status': 'identity-mismatch'})

    def test_redacted_user_prefix_or_wholly_unavailable_path_requires_exact_scope(self):
        body = {'procPath': self.executable.replace('/private/owned', '/Users/USER/owned')}
        self.assertIs(self.classify(self.report(body=body))['installedProcessPathMatched'], True)
        for missing in (None, '', '<redacted>', '<private>'):
            result = self.classify(self.report(body={'procPath': missing}))
            self.assertEqual(result['status'], 'matched')
            self.assertIs(result['installedProcessPathMatched'], False)
            self.assertIs(result['simulatorCoalitionMatched'], True)

    def test_capture_timestamp_is_required_and_bounded(self):
        for capture in (None, 1, self.private, '2026-09-30 18:00:01',
                        '2026-09-30T17:59:59Z', '2026-09-30T18:01:01Z'):
            self.assertEqual(self.classify(self.report(body={'captureTime': capture})), {'status': 'time-mismatch'})
        result = self.classify(self.report(body={'captureTime': '2026-09-30 14:00:01.0000 -0400'}))
        self.assertEqual(result['status'], 'matched')

    def test_malformed_duplicate_unsupported_and_oversized_reports_do_not_classify(self):
        for data in (b'private raw text', b'\xff', b'{}', self.report() + b'\n{}',
                     self.report().replace(b'"bug_type": "309"', b'"bug_type":"private","bug_type":"309"'),
                     self.report().replace(b'"code": 6', b'"code": NaN'),
                     b'{}\n' + b'[' * 2000 + b']' * 2000):
            self.assertEqual(self.classify(data), {'status': 'malformed'})
        self.assertEqual(self.classify(self.report(header={'bug_type': 'private'})), {'status': 'unsupported-report'})
        self.assertEqual(self.classify(b'x' * (DIAGNOSTICS.MAX_CRASH_REPORT_BYTES + 1)), {'status': 'oversized'})

    def test_known_tags_use_only_faulting_or_exception_frames(self):
        frames = [{'symbol': symbol, 'imageOffset': 1234, 'private': self.private} for symbol in (
            'RCTFatal', '-[RCTExceptionsManager reportFatalException:stack:exceptionId:extraDataAsJSON:]',
            'RCTTriggerReloadCommandListeners', '-[RCTHost didReceiveReloadCommand]',
            'closure #1 in RecreateReactContextProcedure.run(procedureContext:)', self.private)]
        result = self.classify(self.report(body={'threads': [
            {'triggered': False, 'frames': [{'symbol': 'RCTFatal'}]},
            {'triggered': True, 'name': self.private, 'frames': frames}]}))
        self.assertEqual(result['faultingOrExceptionBacktraceTags'],
                         ['expo-updates-reload', 'react-fatal', 'react-js-fatal', 'react-reload'])
        self.assertNotIn(self.private, json.dumps(result))
        result = self.classify(self.report(body={'threads': [{'triggered': False, 'frames': frames}]}))
        self.assertEqual(result['faultingOrExceptionBacktraceTags'], [])
        result = self.classify(self.report(body={'lastExceptionBacktrace': [{'symbol': 'RCTFatalException'}]}))
        self.assertEqual(result['faultingOrExceptionBacktraceTags'], ['react-fatal'])

    def test_unknown_enum_and_unbounded_code_values_never_escape(self):
        for code in (True, '6', -1, 0x100000000, self.private):
            result = self.classify(self.report(body={
                'exception': {'type': self.private, 'signal': self.private},
                'termination': {'namespace': self.private, 'code': code},
                'lastExceptionBacktrace': [{'symbol': self.private}],
            }))
            self.assertEqual(result['classification']['categories'], ['unknown'])
            self.assertEqual(result['termination'], {})
            self.assertEqual(result['faultingOrExceptionBacktraceTags'], [])
            self.assertNotIn(self.private, json.dumps(result))

    def test_frame_inspection_is_bounded_and_reports_truncation(self):
        frames = [{'symbol': 'private-symbol'}] * 64 + [{'symbol': 'RCTFatal'}]
        result = self.classify(self.report(body={'lastExceptionBacktrace': frames,
                                               'threads': [{'triggered': True, 'frames': frames}]}))
        self.assertTrue(result['frameInspectionTruncated'])
        self.assertEqual(result['framesInspected'], 128)
        self.assertEqual(result['symbolizedFramesInspected'], 128)
        self.assertEqual(result['faultingOrExceptionBacktraceTags'], [])


class LaunchDiagnosticsTests(unittest.TestCase):
    def test_nested_launch_rejection_and_crash_are_both_retained(self):
        result = classify([
            'Failed to launch private.example.app: Error Domain=FBSOpenApplicationServiceErrorDomain '
            'Code=1 "The request was denied by service delegate." '
            'NSUnderlyingError=Error Domain=RBSRequestErrorDomain Code=5 '
            '"The process exited unexpectedly."',
            'Exception Type: EXC_CRASH (SIGABRT)\n'
            'Termination Reason: Namespace DYLD, Code 1 Library missing\n'
            '/private/secret-user/location',
        ])
        self.assertEqual(result['categories'], ['launch-rejected', 'process-exited-or-crashed'])
        self.assertEqual(result['errorCodes'], [
            {'domain': 'FBSOpenApplicationServiceErrorDomain', 'code': 1},
            {'domain': 'RBSRequestErrorDomain', 'code': 5},
        ])
        self.assertEqual(result['signals'], ['SIGABRT'])
        self.assertEqual(result['exceptionTypes'], ['EXC_CRASH'])
        self.assertEqual(result['terminationReasons'], ['dynamic-linker'])
        self.assertEqual(result['subtypes'], ['launch-denied', 'process-crash'])

    def test_domain_and_code_renderings(self):
        result = classify([
            '(com.apple.dt.xctest.error error 10002.)',
            '(FBSOpenApplicationServiceErrorDomain error 1.)',
            'NSPOSIXErrorDomain Code: 13',
            'Domain: NSOSStatusErrorDomain, Code: -34018',
            'Error Domain="NSCocoaErrorDomain" Code=260',
            'RBSRequestErrorDomain code=5',
        ])
        self.assertEqual(result['errorCodes'], [
            {'domain': 'FBSOpenApplicationServiceErrorDomain', 'code': 1},
            {'domain': 'NSCocoaErrorDomain', 'code': 260},
            {'domain': 'NSOSStatusErrorDomain', 'code': -34018},
            {'domain': 'NSPOSIXErrorDomain', 'code': 13},
            {'domain': 'RBSRequestErrorDomain', 'code': 5},
            {'domain': 'com.apple.dt.xctest.error', 'code': 10002},
        ])

    def test_launch_timeout(self):
        for message in (
            'Application launch timed out.',
            'Timed out waiting for the application to launch.',
            'Timed out waiting for application to become foreground.',
            'Timeout during application launch.',
        ):
            with self.subTest(message=message):
                result = classify([message])
                self.assertEqual(result['categories'], ['launch-timed-out'])
                self.assertEqual(result['subtypes'], ['timeout'])

    def test_fixed_subtypes(self):
        cases = {
            'signature-invalid': 'Failed to launch: code signature is invalid.',
            'entitlement-invalid': 'Failed to launch: missing entitlements.',
            'launch-denied': 'The launch request was denied.',
            'debugger-attach-failed': 'Failed to attach debugger to process.',
            'executable-missing': 'The executable was not found.',
        }
        for subtype, message in cases.items():
            with self.subTest(subtype=subtype):
                result = classify([message])
                self.assertEqual(result['categories'], ['launch-rejected'])
                self.assertEqual(result['subtypes'], [subtype])

    def test_library_validation_is_signature_subtype(self):
        result = classify(['Unable to launch application: Library Validation failed.'])
        self.assertEqual(result['subtypes'], ['signature-invalid'])

    def test_normal_exit_is_not_mislabeled_a_crash(self):
        result = classify(['Process exited with code 0.', 'Process terminated by SIGTERM.'])
        self.assertEqual(result['categories'], ['process-exited-or-crashed'])
        self.assertEqual(result['subtypes'], [])
        self.assertEqual(result['signals'], ['SIGTERM'])

    def test_missing_keychain_entitlement_alone_is_not_launch_rejection(self):
        result = classify(['Error setting credentials: errSecMissingEntitlement'])
        self.assertEqual(result['categories'], ['unknown'])
        self.assertEqual(result['subtypes'], ['entitlement-invalid'])

    def test_json_crash_fields_are_allowlisted(self):
        result = classify(['{"exception":{"type":"EXC_BAD_ACCESS","signal":"SIGSEGV"},'
                           '"termination":{"namespace":"CODESIGNING","indicator":"Invalid Signature"},'
                           '"user":"private-secret"}'])
        self.assertEqual(result['categories'], ['process-exited-or-crashed'])
        self.assertEqual(result['subtypes'], ['signature-invalid', 'process-crash'])
        self.assertEqual(result['terminationReasons'], ['code-signing'])
        self.assertEqual(result['signals'], ['SIGSEGV'])

    def test_success_and_unrelated_timeout_do_not_claim_launch_failure(self):
        result = classify([
            'Application launch succeeded. Process is running. Code signature is valid.',
            'Entitlements are valid; launch was permitted. No crash detected.',
            'HTTP request timed out; no application launch timeout occurred.',
            'No debugger attachment failed.',
        ])
        self.assertEqual(result['categories'], ['unknown'])
        self.assertEqual(result['subtypes'], [])
        self.assertEqual(classify(['HTTP request timed out.'])['categories'], ['unknown'])

    def test_unknown_and_non_string_inputs(self):
        for messages in ([], ['Opaque XCTest failure.'], [None, 17, {'message': 'private'}]):
            with self.subTest(messages=messages):
                self.assertEqual(classify(messages), {
                    'categories': ['unknown'], 'subtypes': [], 'errorCodes': [],
                    'signals': [], 'exceptionTypes': [], 'terminationReasons': [], 'serviceReasons': [],
                })

    def test_no_private_text_or_untrusted_enum_can_escape(self):
        private = 'SECRET-user-token-account-12345'
        result = classify([
            f'Failed to launch https://{private}.invalid/secret?token={private}',
            f'Error Domain={private} Code=42',
            f'Error Domain=NSPOSIXErrorDomain.{private} Code=13',
            f'Error Domain=NSPOSIXErrorDomain Code=13{private}',
            'Error Domain=NSPOSIXErrorDomain Code=999999999999999',
            'Error Domain=NSPOSIXErrorDomain Code=-65536',
            'Error Domain=NSPOSIXErrorDomain Code=12.34',
            f'Exception Type: {private}\nTermination Signal: {private}',
            f'{{"namespace":"{private}","signal":"{private}","type":"{private}"}}',
            f'Hierarchy: button name="{private}" URL=https://example.invalid/{private}',
        ])
        self.assertEqual(result['categories'], ['launch-rejected'])
        self.assertEqual(result['errorCodes'], [])
        self.assertEqual(result['signals'], [])
        self.assertEqual(result['exceptionTypes'], [])
        self.assertEqual(result['terminationReasons'], [])
        serialized = json.dumps(result)
        for forbidden in (private, 'https', 'token', 'Hierarchy', 'example.invalid'):
            self.assertNotIn(forbidden, serialized)

    def test_fixed_service_reason_and_codesigning_diagnosis(self):
        result = classify(['Failed to launch: request was denied by service delegate '
                           'for reason: Security (has inadequate codesigning entitlements). '
                           'BSErrorCodeDescription=RequestDenied '
                           'error domain=fbsopenapplicationserviceerrordomain code=1',
                           'BSErrorCodeDescription=SECRET-private-value',
                           'for reason: Security-private-value',
                           'RBSRequestErrorDomain:5'])
        self.assertEqual(result['serviceReasons'], ['Security', 'RequestDenied'])
        self.assertIn('entitlement-invalid', result['subtypes'])
        self.assertEqual(result['errorCodes'], [
            {'domain': 'FBSOpenApplicationServiceErrorDomain', 'code': 1},
            {'domain': 'RBSRequestErrorDomain', 'code': 5}])
        self.assertNotIn('SECRET', json.dumps(result))

    def test_output_and_input_are_bounded(self):
        result = classify(f'Error Domain=NSPOSIXErrorDomain Code={code}' for code in range(10000))
        self.assertEqual(len(result['errorCodes']), DIAGNOSTICS.MAX_ERROR_CODES)
        self.assertLess(len(json.dumps(result)), 2500)
        result = classify('x' * (DIAGNOSTICS.MAX_MESSAGE_CHARS + 1) + 'Failed to launch app')
        self.assertEqual(result['categories'], ['unknown'])


if __name__ == '__main__':
    unittest.main()
