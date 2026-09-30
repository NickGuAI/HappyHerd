"""Synthetic verifier contracts only: no build, simulator, install or launch proof.

The fixture's signature has parser structure, not a valid cryptographic signature.
Only external lipo/file/codesign calls are mocked; payload and signing parsers run.
Archive pins are replaced solely in scoped mocks, never in production source.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import plistlib
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.dont_write_bytecode = True
BASE = Path(__file__).resolve().parent


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


verifier = load_module('hh345_fixture_verifier', BASE / 'verify-hosted-app.py')
signer = load_module('hh345_fixture_signer', BASE.parent / 'native-signing-receipt.py')


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def synthetic_macho():
    identifier = b'synthetic-parser-fixture\0'
    hash_offset = 44 + len(identifier)
    directory = (struct.pack('>9I4BI', 0xfade0c02, hash_offset + 32, 0x20001,
                             2, hash_offset, 44, 0, 1, 48, 32, 2, 0, 12, 0)
                 + identifier + bytes(32))
    signature = struct.pack('>5I', 0xfade0cc0, 20 + len(directory), 1, 0, 20) + directory
    return (struct.pack('<8I', 0xfeedfacf, 0x100000c, 0, 2, 1, 16, 0, 0)
            + struct.pack('<4I', 0x1d, 16, 48, len(signature)) + signature)


class HostedAppVerifierTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='hh345-verifier-fixture-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.artifact = self.root / 'artifact'
        self.artifact.mkdir()
        self.app = self.root / 'extracted' / verifier.APP_ROOT
        self.config_path = 'EXConstants.bundle/app.config'
        info = {
            'CFBundleIdentifier': verifier.EXPECTED_BUNDLE_ID,
            'CFBundleExecutable': 'HappyHerd', 'CFBundleVersion': '1',
            'CFBundleShortVersionString': '1.0', 'DTPlatformName': 'iphonesimulator',
            'CFBundleSupportedPlatforms': ['iPhoneSimulator'],
            'DTSDKName': 'iphonesimulator26.2', 'DTXcode': '2620',
            'MinimumOSVersion': '15.1',
        }
        config = {
            'version': '1.0',
            'ios': {'bundleIdentifier': verifier.EXPECTED_BUNDLE_ID, 'buildNumber': '1'},
            'extra': {'app': {'buildCommitSha': verifier.EXPECTED_SHA,
                              'buildCommitTimestamp': verifier.EXPECTED_TIMESTAMP}},
        }
        self.payloads = {
            'Info.plist': plistlib.dumps(info), 'HappyHerd': synthetic_macho(),
            'main.jsbundle': b'synthetic fixture ' + verifier.EXPECTED_SERVER,
            self.config_path: json.dumps(config).encode(),
            'assets/noncritical.txt': b'complete-manifest fixture asset',
        }
        for name, contents in self.payloads.items():
            path = self.app / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(contents)
            path.chmod(0o755 if name == 'HappyHerd' else 0o644)
        self.signing = {
            'schemaVersion': 1, 'verified': True, 'sourceSha': verifier.EXPECTED_SHA,
            'app': {'status': 'parsed', **signer.inspect_app(self.app)},
            'buildSettings': {'status': 'parsed', **signer.summarize_build_settings(json.dumps([
                {'target': 'HappyHerd', 'buildSettings': {'CODE_SIGNING_ALLOWED': 'YES',
                  'CODE_SIGNING_REQUIRED': 'YES', 'CODE_SIGN_IDENTITY': '-'}}]).encode())},
            'generatedEntitlements': {'status': 'parsed', **signer.generated_entitlements(self.root / 'absent-derived-data')},
            'machO': {'status': 'parsed', **signer.summarize_macho(self.payloads['HappyHerd'])},
            'codesign': {'status': 'parsed', 'returnCode': 0},
        }
        self.manifest = {
            'sourceSha': verifier.EXPECTED_SHA, 'nativeBuildMode': verifier.EXPECTED_BUILD_MODE,
            'productTree': verifier.EXPECTED_PRODUCT_TREE, 'configuration': 'Release',
            'architecture': 'arm64', 'bundleIdentifier': verifier.EXPECTED_BUNDLE_ID,
            'taskSpecificNativeSourcePatches': [], 'revenueCatSourcePatched': False,
            'files': {name: sha256(contents) for name, contents in self.payloads.items()},
            'bundleSha256': sha256(self.payloads['main.jsbundle']),
            'appConfigSha256': sha256(self.payloads[self.config_path]),
            'appConfigPath': self.config_path,
        }
        self.write_signing()
        self.write_archive()
        self.initial_pin = sha256(self.archive.read_bytes())
        self.parser_patch = patch.object(verifier, 'signing_parser', return_value=signer)
        self.parser_patch.start()
        self.addCleanup(self.parser_patch.stop)

    @property
    def archive(self):
        return self.artifact / 'HappyHerd.app.zip'

    def write_manifest(self):
        (self.artifact / 'build-manifest.json').write_text(json.dumps(self.manifest))

    def write_signing(self):
        data = json.dumps(self.signing, indent=2).encode() + b'\n'
        (self.artifact / 'signing-receipt.json').write_bytes(data)
        self.manifest['signingReceiptSha256'] = sha256(data)
        self.write_manifest()

    def write_checksum(self):
        (self.artifact / 'archive.sha256').write_text(sha256(self.archive.read_bytes()) + '  HappyHerd.app.zip\n')

    def write_archive(self, extras=()):
        entries = [(verifier.APP_ROOT + '/' + name, contents,
                    stat.S_IFREG | (0o755 if name == 'HappyHerd' else 0o644))
                   for name, contents in sorted(self.payloads.items())]
        with zipfile.ZipFile(self.archive, 'w') as archive:
            for name, contents, mode in entries + list(extras):
                item = zipfile.ZipInfo(name)
                item.create_system = 3
                item.external_attr = mode << 16
                archive.writestr(item, contents)
        self.write_checksum()

    def verify_archive(self, pin=None):
        with patch.object(verifier, 'EXPECTED_ARCHIVE_SHA', pin or self.initial_pin):
            return verifier.verify_archive(self.artifact)

    def tool_output(self, command, **kwargs):
        self.assertEqual(kwargs, {'text': True})
        if command[:3] == ['xcrun', 'lipo', '-archs']:
            self.assertEqual(len(command), 4)
            return 'arm64\n'
        self.assertEqual(command[0], '/usr/bin/file')
        self.assertEqual(len(command), 2)
        return 'synthetic-fixture: Mach-O 64-bit executable arm64\n'

    def verify_extracted(self, app, archive_receipt, manifest, returncode=0):
        def codesign(command, **kwargs):
            self.assertEqual(command, ['codesign', '--verify', '--strict', str(app.resolve())])
            self.assertEqual(kwargs, {'stdout': subprocess.PIPE, 'stderr': subprocess.PIPE,
                                      'timeout': 30, 'check': False})
            return subprocess.CompletedProcess(command, returncode, b'private fixture output', b'private fixture error')
        with patch.object(verifier.subprocess, 'check_output', side_effect=self.tool_output), \
                patch.object(signer.subprocess, 'run', side_effect=codesign) as strict_verify:
            result = verifier.verify_extracted(app, archive_receipt, manifest)
            strict_verify.assert_called_once()
            return result

    def test_synthetic_archive_binds_selected_source_mode_tree_and_signing(self):
        receipt, manifest = self.verify_archive()
        self.assertEqual(receipt['sourceSha'], verifier.EXPECTED_SHA)
        self.assertEqual(receipt['nativeBuildMode'], 'xcode-default-simulator-signing')
        self.assertEqual(receipt['productTree'], verifier.EXPECTED_PRODUCT_TREE)
        self.assertEqual(receipt['archiveSha256'], self.initial_pin)
        self.assertEqual(receipt['appFileCount'], len(self.payloads))
        self.assertEqual(receipt['signingReceiptSha256'], manifest['signingReceiptSha256'])
        self.assertEqual(self.signing['machO']['executableSha256'], manifest['files']['HappyHerd'])

    def test_extracted_and_installed_container_copies_check_every_payload(self):
        archive_receipt, manifest = self.verify_archive()
        # This copy models the installed-container verifier input, not an install.
        installed = self.root / 'synthetic-installed-container' / verifier.APP_ROOT
        shutil.copytree(self.app, installed)
        for app in (self.app, installed):
            with self.subTest(container=app.parent.name):
                result = self.verify_extracted(app, archive_receipt, manifest)
                self.assertTrue(result['allFileHashesMatchArchiveManifest'])
                self.assertTrue(result['buildSigningVerified'])
                self.assertTrue(result['archiveModesAndSymlinkTargetsMatch'])
                self.assertEqual(result['appFileCount'], len(self.payloads))
                self.assertEqual(result['executableSha256'], manifest['files']['HappyHerd'])

    def test_pending_pin_stops_before_reading_artifact(self):
        with patch.object(verifier, 'EXPECTED_ARCHIVE_SHA', 'PENDING_VERIFIED_SIGNED_ARCHIVE_SHA256'), \
                patch.object(verifier, 'digest_file') as read:
            with self.assertRaisesRegex(ValueError, 'selection is pending'):
                verifier.verify_archive(self.artifact)
            read.assert_not_called()

    def test_changed_archive_and_changed_checksum_do_not_replace_fixed_pin(self):
        with zipfile.ZipFile(self.archive, 'a') as archive:
            archive.comment = b'changed fixture archive bytes'
        self.write_checksum()
        self.assertNotEqual(sha256(self.archive.read_bytes()), self.initial_pin)
        with self.assertRaisesRegex(ValueError, 'Downloaded archive SHA256 mismatch'):
            self.verify_archive()

    def test_signing_receipt_bytes_must_match_manifest_hash(self):
        path = self.artifact / 'signing-receipt.json'
        path.write_bytes(path.read_bytes() + b'\n')
        with self.assertRaisesRegex(ValueError, 'signing receipt bytes differ'):
            self.verify_archive()

    def test_receipt_schema_must_match_producer_contract(self):
        self.signing['schemaVersion'] = 2
        self.write_signing()
        with self.assertRaisesRegex(ValueError, 'Expected verified signing receipt'):
            self.verify_archive()

    def test_wrong_build_mode_and_product_tree_fail(self):
        for field in ('nativeBuildMode', 'productTree'):
            with self.subTest(field=field):
                original = self.manifest[field]
                self.manifest[field] = 'wrong-fixture-value'
                self.write_manifest()
                with self.assertRaisesRegex(ValueError, 'Build manifest ' + field + ' mismatch'):
                    self.verify_archive()
                self.manifest[field] = original
                self.write_manifest()

    def test_receipt_executable_hash_must_match_manifest(self):
        self.signing['machO']['executableSha256'] = '0' * 64
        self.write_signing()
        with self.assertRaisesRegex(ValueError, 'Signing receipt executable hash differs'):
            self.verify_archive()

    def test_actual_macho_summary_is_reparsed_despite_matching_receipt_hash(self):
        self.signing['machO']['codeDirectoryFlags'] = 123
        self.write_signing()
        with self.assertRaisesRegex(ValueError, 'Executable signing fields differ'):
            self.verify_archive()

    def test_noncritical_asset_tamper_or_extra_file_fails_before_tools(self):
        archive_receipt, manifest = self.verify_archive()
        for container in ('extracted', 'installed'):
            for change in ('tamper', 'extra'):
                with self.subTest(container=container, change=change):
                    app = self.root / (container + '-' + change) / verifier.APP_ROOT
                    shutil.copytree(self.app, app)
                    relative = 'assets/noncritical.txt' if change == 'tamper' else 'assets/unmanifested.txt'
                    (app / relative).write_bytes(b'changed fixture asset')
                    with patch.object(verifier.subprocess, 'check_output') as architecture, \
                            patch.object(signer.subprocess, 'run') as codesign:
                        with self.assertRaisesRegex(ValueError, 'file set/hashes differ'):
                            verifier.verify_extracted(app, archive_receipt, manifest)
                        architecture.assert_not_called()
                        codesign.assert_not_called()

    def test_codesign_nonzero_result_fails_extracted_verification(self):
        archive_receipt, manifest = self.verify_archive()
        with self.assertRaises(signer.SafeFailure) as failure:
            self.verify_extracted(self.app, archive_receipt, manifest, returncode=1)
        self.assertEqual(failure.exception.category, 'verification-failed')
        self.assertEqual(failure.exception.fields, {'returnCode': 1})
        self.assertNotIn('private fixture', str(failure.exception))

    def test_zip_traversal_and_escaping_symlink_guards_remain_active(self):
        for name, contents, mode, message in (
            ('HappyHerd.app/../outside', b'fixture', stat.S_IFREG | 0o644, 'path traversal'),
            ('HappyHerd.app/unsafe-link', b'../../outside', stat.S_IFLNK | 0o777, 'Symlink escapes app root'),
        ):
            with self.subTest(name=name):
                self.write_archive([(name, contents, mode)])
                # Pin this malformed synthetic ZIP to reach its structural guard.
                with self.assertRaisesRegex(ValueError, message):
                    self.verify_archive(pin=sha256(self.archive.read_bytes()))


if __name__ == '__main__':
    unittest.main()
