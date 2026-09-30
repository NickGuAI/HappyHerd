#!/usr/bin/env python3
"""Focused privacy and interpretation tests; all strings are synthetic."""
import importlib.util
import json
from pathlib import Path
import unittest


SPEC = importlib.util.spec_from_file_location(
    'launch_diagnostics', Path(__file__).with_name('launch-diagnostics.py'))
DIAGNOSTICS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DIAGNOSTICS)
classify = DIAGNOSTICS.classify_launch_messages


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
                    'signals': [], 'exceptionTypes': [], 'terminationReasons': [],
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

    def test_output_and_input_are_bounded(self):
        result = classify(f'Error Domain=NSPOSIXErrorDomain Code={code}' for code in range(10000))
        self.assertEqual(len(result['errorCodes']), DIAGNOSTICS.MAX_ERROR_CODES)
        self.assertLess(len(json.dumps(result)), 2500)
        result = classify('x' * (DIAGNOSTICS.MAX_MESSAGE_CHARS + 1) + 'Failed to launch app')
        self.assertEqual(result['categories'], ['unknown'])


if __name__ == '__main__':
    unittest.main()
