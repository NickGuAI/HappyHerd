"""Verifier and selected-artifact contracts: no build, install or launch proof.

The fixture's signature has parser structure, not a valid cryptographic signature.
Only external lipo/file/codesign calls are mocked; payload and signing parsers run.
Archive pins are replaced solely in scoped mocks, never in production source.
"""
import ast
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import plistlib
import re
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
driver = load_module('hh345_fixture_driver', BASE / 'native-driver.py')


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


class SelectedArtifactProvenanceTests(unittest.TestCase):
    def test_selected_artifact_agrees_across_all_retained_consumers(self):
        # Read the driver as syntax only: importing/running it is unnecessary.
        driver = ast.parse((BASE / 'native-driver.py').read_text())
        constants = {}
        for name in ('EXPECTED_SHA', 'EXPECTED_ARCHIVE_SHA'):
            assignments = [node.value for node in driver.body
                           if isinstance(node, ast.Assign)
                           and any(isinstance(target, ast.Name) and target.id == name
                                   for target in node.targets)]
            self.assertEqual(len(assignments), 1, f'Driver must define one {name}')
            constants[name] = ast.literal_eval(assignments[0])
        self.assertRegex(verifier.EXPECTED_SHA, r'^[0-9a-f]{40}$')
        self.assertRegex(verifier.EXPECTED_ARCHIVE_SHA, r'^[0-9a-f]{64}$')
        self.assertEqual(constants, {'EXPECTED_SHA': verifier.EXPECTED_SHA,
                                    'EXPECTED_ARCHIVE_SHA': verifier.EXPECTED_ARCHIVE_SHA})

        def one(pattern, text, consumer):
            matches = re.findall(pattern, text, re.MULTILINE)
            self.assertEqual(len(matches), 1, f'Expected one selected-artifact field in {consumer}')
            return matches[0]

        # These narrow matches require the live preflight assertion and the
        # retained workflow's actual environment/download step, not comments.
        controller = (BASE / 'controller.mjs').read_text()
        controller_sha = one(
            r"^[ \t]*assert\.equal\(nativeSha, '([0-9a-f]{40})'\);[ \t]*$",
            controller, 'controller preflight')
        self.assertEqual(controller_sha, verifier.EXPECTED_SHA,
                         'Controller preflight rejects the selected native artifact')

        # The recipe remains authoritative after the temporary active workflow
        # is removed; this regression never depends on .github/workflows/.
        workflow = (BASE.parent / 'native-journey-workflow.yml').read_text()
        workflow_sha = one(r'^      HH345_NATIVE_SHA: ([0-9a-f]{40})[ \t]*$',
                           workflow, 'retained journey environment')
        download = one(r'^      - uses: actions/download-artifact@[^\n]+\n'
                       r'((?:^        [^\n]*\n)+)', workflow, 'retained journey download step')
        artifact_name = one(r'^          name: ([^\s#]+)[ \t]*$', download, 'download artifact name')
        run_id = one(r'^          run-id: ([0-9]+)[ \t]*$', download, 'download run ID')
        self.assertEqual(workflow_sha, verifier.EXPECTED_SHA)
        self.assertEqual(artifact_name, 'issue-345-native-signed-' + verifier.EXPECTED_SHA)
        self.assertEqual(verifier.EXPECTED_RUN,
                         'https://github.com/NickGuAI/HappyHerd/actions/runs/' + run_id)

        manifest = json.loads((BASE.parent / 'native-signed-build-manifest.json').read_text())
        self.assertEqual(manifest['sourceSha'], verifier.EXPECTED_SHA)
        self.assertEqual(manifest['productTree'], verifier.EXPECTED_PRODUCT_TREE)
        self.assertEqual(manifest['nativeBuildMode'], verifier.EXPECTED_BUILD_MODE)


class HostedAppVerifierTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='hh345-verifier-fixture-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.artifact = self.root / 'artifact'
        self.artifact.mkdir()
        self.app = self.root / 'extracted' / verifier.APP_ROOT
        self.config_path = 'EXConstants.bundle/app.config'
        self.executable_paths = {'HappyHerd'}
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
                    stat.S_IFREG | (0o755 if name in self.executable_paths else 0o644))
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

    def verify_extracted(self, app, archive_receipt, manifest, returncode=0, operation=None):
        def codesign(command, **kwargs):
            self.assertEqual(command, ['codesign', '--verify', '--strict', str(app.resolve())])
            self.assertEqual(kwargs, {'stdout': subprocess.PIPE, 'stderr': subprocess.PIPE,
                                      'timeout': 30, 'check': False})
            return subprocess.CompletedProcess(command, returncode, b'private fixture output', b'private fixture error')
        with patch.object(verifier.subprocess, 'check_output', side_effect=self.tool_output), \
                patch.object(signer.subprocess, 'run', side_effect=codesign) as strict_verify:
            result = operation() if operation else verifier.verify_extracted(app, archive_receipt, manifest)
            strict_verify.assert_called_once()
            return result

    def framework_installed_fixture(self, invalid_identity=None):
        dylib = struct.pack('<8I', 0xfeedfacf, 0x100000c, 0, 6, 0, 0, 0, 0)
        fat = struct.pack('>7I', 0xcafebabe, 1, 0x100000c, 0, 32, len(dylib), 2) + bytes(4) + dylib
        last = sorted(driver.FRAMEWORK_EXECUTABLES)[-1]
        for name in driver.FRAMEWORK_EXECUTABLES:
            path = self.app / name
            path.parent.mkdir(parents=True)
            info = {'CFBundleExecutable': path.name, 'CFBundlePackageType': 'FMWK'}
            payload = fat
            if name == last and invalid_identity == 'declaration':
                info['CFBundleExecutable'] = 'private-wrong-executable'
            if name == last and invalid_identity == 'macho':
                payload = b'private-not-a-macho'
            self.payloads[name] = payload
            self.payloads[str(Path(name).parent / 'Info.plist')] = plistlib.dumps(info)
            self.executable_paths.add(name)
        for name, payload in self.payloads.items():
            (self.app / name).write_bytes(payload)
            (self.app / name).chmod(0o755 if name in self.executable_paths else 0o644)
        self.manifest['files'] = {name: sha256(payload) for name, payload in self.payloads.items()}
        self.write_manifest()
        self.write_archive()
        archive_receipt, manifest = self.verify_archive(pin=sha256(self.archive.read_bytes()))
        device_set = self.root / 'owned-devices'
        installed = device_set / verifier.APP_ROOT
        shutil.copytree(self.app, installed)
        for name in driver.FRAMEWORK_EXECUTABLES:
            (installed / name).chmod(0o644)
        return installed, device_set, archive_receipt, manifest

    def prepare_frameworks(self, fixture, returncode=0):
        installed, device_set, archive_receipt, manifest = fixture
        self.preparation_receipt = {}
        return self.verify_extracted(installed, archive_receipt, manifest, returncode,
            operation=lambda: driver.verify_installed_app(installed, device_set, archive_receipt, manifest,
                verifier, self.preparation_receipt, lambda: None))

    def test_exact_six_installed_framework_modes_restore_without_source_or_byte_changes(self):
        fixture = self.framework_installed_fixture()
        archive_hash = sha256(self.archive.read_bytes())
        result = self.prepare_frameworks(fixture)
        restoration = self.preparation_receipt['installedFrameworkModeRestoration']
        self.assertEqual(restoration['observedMismatchCount'], 6)
        self.assertEqual(restoration['changedCount'], 6)
        for key in ('restorationApplied', 'frameworkIdentityVerified', 'byteHashesUnchanged',
                    'allManifestFilesVerified', 'strictSignatureVerified'):
            self.assertTrue(restoration[key])
        self.assertEqual((restoration['expectedMode'], restoration['observedMode']), (0o755, 0o644))
        self.assertTrue(result['archiveModesAndSymlinkTargetsMatch'])
        self.assertEqual(sha256(self.archive.read_bytes()), archive_hash)
        for name, payload in self.payloads.items():
            self.assertEqual((fixture[0] / name).read_bytes(), payload)
            self.assertEqual((self.app / name).read_bytes(), payload)
            self.assertEqual(stat.S_IMODE((self.app / name).stat().st_mode),
                             0o755 if name in self.executable_paths else 0o644)
        self.assertNotIn('Frameworks/', json.dumps(restoration))
        self.assertNotIn(str(self.root), json.dumps(restoration))

    def test_matching_installed_modes_require_no_restoration(self):
        fixture = self.framework_installed_fixture()
        for name in driver.FRAMEWORK_EXECUTABLES:
            (fixture[0] / name).chmod(0o755)
        with patch.object(driver.os, 'fchmod') as chmod:
            self.prepare_frameworks(fixture)
            chmod.assert_not_called()
        restoration = self.preparation_receipt['installedFrameworkModeRestoration']
        self.assertEqual(restoration['changedCount'], 0)
        self.assertEqual(restoration['observedMismatchCount'], 0)
        self.assertFalse(restoration['restorationApplied'])
        self.assertTrue(restoration['strictSignatureVerified'])

    def test_partial_extra_unexpected_mode_and_hash_deltas_reject_before_any_chmod(self):
        original = self.framework_installed_fixture()
        name = sorted(driver.FRAMEWORK_EXECUTABLES)[-1]
        for change in ('partial', 'extra', 'substituted', 'mode', 'hash', 'symlink', 'hardlink'):
            installed = original[1] / change / verifier.APP_ROOT
            shutil.copytree(original[0], installed)
            path = installed / name
            if change == 'partial': path.chmod(0o755)
            elif change == 'extra': (installed / 'assets/noncritical.txt').chmod(0o600)
            elif change == 'substituted':
                path.chmod(0o755)
                (installed / 'assets/noncritical.txt').chmod(0o600)
            elif change == 'mode': path.chmod(0o600)
            elif change == 'hash': path.write_bytes(b'private-changed-bytes')
            else:
                outside = self.root / ('private-' + change)
                outside.write_bytes(path.read_bytes())
                outside.chmod(0o644)
                path.unlink()
                if change == 'symlink': path.symlink_to(outside)
                else: os.link(outside, path)
            with self.subTest(change=change), patch.object(driver.os, 'fchmod') as chmod:
                with self.assertRaises((driver.DriverRequirementError, verifier.VerificationError)):
                    self.prepare_frameworks((installed, *original[1:]))
                chmod.assert_not_called()
                self.assertEqual(self.preparation_receipt['installedFrameworkModeRestoration']['changedCount'], 0)

    def test_all_framework_identities_are_validated_before_first_chmod(self):
        for invalid in ('declaration', 'macho'):
            # Each identity case uses its own fixture instance/directory.
            test = HostedAppVerifierTests()
            test.setUp()
            try:
                fixture = test.framework_installed_fixture(invalid)
                with self.subTest(invalid=invalid), patch.object(driver.os, 'fchmod') as chmod:
                    with self.assertRaises(driver.DriverRequirementError):
                        test.prepare_frameworks(fixture)
                    chmod.assert_not_called()
                    for name in driver.FRAMEWORK_EXECUTABLES:
                        self.assertEqual(stat.S_IMODE((fixture[0] / name).stat().st_mode), 0o644)
            finally:
                test.doCleanups()

    def test_framework_restoration_cannot_target_an_unowned_app(self):
        fixture = self.framework_installed_fixture()
        with patch.object(driver.os, 'fchmod') as chmod:
            with self.assertRaises(driver.DriverRequirementError):
                self.prepare_frameworks((self.app, *fixture[1:]))
            chmod.assert_not_called()

    def test_framework_restoration_still_requires_final_strict_signature_success(self):
        fixture = self.framework_installed_fixture()
        with self.assertRaises(verifier.VerificationError) as failure:
            self.prepare_frameworks(fixture, returncode=1)
        self.assertEqual(failure.exception.category, 'signature-verification-failure')
        restoration = self.preparation_receipt['installedFrameworkModeRestoration']
        self.assertTrue(restoration['restorationApplied'])
        self.assertEqual(restoration['changedCount'], 6)
        self.assertFalse(restoration['strictSignatureVerified'])

    def test_complete_file_verification_runs_after_restoring_framework_modes(self):
        fixture = self.framework_installed_fixture()
        original_chmod = driver.os.fchmod
        calls = []
        def chmod_then_change_other_payload(descriptor, mode):
            original_chmod(descriptor, mode)
            calls.append(mode)
            if len(calls) == 6:
                (fixture[0] / 'assets/noncritical.txt').write_bytes(b'private-after-restoration-change')
        with patch.object(driver.os, 'fchmod', side_effect=chmod_then_change_other_payload):
            with self.assertRaises(verifier.VerificationError) as failure:
                self.prepare_frameworks(fixture)
        self.assertEqual(failure.exception.category, 'file-payload-mismatch')
        restoration = self.preparation_receipt['installedFrameworkModeRestoration']
        self.assertEqual(restoration['changedCount'], 6)
        self.assertFalse(restoration['allManifestFilesVerified'])

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

    def public_verification_failure(self, app, archive_receipt, manifest):
        with patch.object(verifier.subprocess, 'check_output') as architecture, \
                patch.object(signer.subprocess, 'run') as codesign:
            with self.assertRaises(ValueError) as failure:
                verifier.verify_extracted(app, archive_receipt, manifest)
            architecture.assert_not_called()
            codesign.assert_not_called()
        return verifier.public_failure(failure.exception)['verificationFailure']

    def test_payload_diagnostic_counts_missing_extra_and_hash_changes_without_names(self):
        archive_receipt, manifest = self.verify_archive()
        (self.app / 'assets/noncritical.txt').unlink()
        (self.app / 'private-account-token-secret').write_bytes(b'private payload')
        (self.app / 'main.jsbundle').write_bytes(b'private changed content')
        diagnostic = self.public_verification_failure(self.app, archive_receipt, manifest)
        self.assertEqual(diagnostic['category'], 'file-payload-mismatch')
        self.assertEqual({key: diagnostic['details'][key] for key in
                          ('missingFileCount', 'extraFileCount', 'changedFileHashCount')},
                         {'missingFileCount': 1, 'extraFileCount': 1, 'changedFileHashCount': 1})
        self.assertNotIn('private', json.dumps(diagnostic))
        self.assertNotIn(str(self.root), json.dumps(diagnostic))

    def test_mode_diagnostic_preserves_rejection_and_reports_bounded_modes(self):
        archive_receipt, manifest = self.verify_archive()
        (self.app / 'assets/noncritical.txt').chmod(0o600)
        diagnostic = self.public_verification_failure(self.app, archive_receipt, manifest)
        self.assertEqual(diagnostic['category'], 'mode-mismatch')
        self.assertEqual(diagnostic['details']['modeMismatchCount'], 1)
        self.assertEqual(diagnostic['details']['expectedMode'], 0o644)
        self.assertEqual(diagnostic['details']['actualMode'], 0o600)
        self.assertEqual(diagnostic['details']['changedFileHashCount'], 0)

    def test_same_hash_type_and_link_target_changes_remain_distinct_failures(self):
        asset = 'assets/noncritical.txt'
        self.payloads[asset] = self.payloads['main.jsbundle']
        (self.app / asset).write_bytes(self.payloads[asset])
        self.manifest['files'][asset] = sha256(self.payloads[asset])
        self.write_manifest()
        self.write_archive()
        receipt, manifest = self.verify_archive(pin=sha256(self.archive.read_bytes()))
        (self.app / asset).unlink()
        (self.app / asset).symlink_to('../main.jsbundle')
        diagnostic = self.public_verification_failure(self.app, receipt, manifest)
        self.assertEqual(diagnostic['category'], 'member-type-mismatch')
        self.assertEqual(diagnostic['details']['typeMismatchCount'], 1)
        receipt['appMembers'] = [dict(row, kind='symlink', target='../main.jsbundle')
                                 if row['path'] == asset else row for row in receipt['appMembers']]
        (self.app / asset).unlink()
        (self.app / asset).symlink_to('../assets/../main.jsbundle')
        diagnostic = self.public_verification_failure(self.app, receipt, manifest)
        self.assertEqual(diagnostic['category'], 'link-target-mismatch')
        self.assertEqual(diagnostic['details']['linkTargetMismatchCount'], 1)

    def test_extra_directory_link_is_classified_even_without_a_file_hash_delta(self):
        receipt, manifest = self.verify_archive()
        (self.app / 'private-extra-link').symlink_to('assets')
        diagnostic = self.public_verification_failure(self.app, receipt, manifest)
        self.assertEqual(diagnostic['category'], 'member-set-mismatch')
        self.assertEqual(diagnostic['details']['extraMemberCount'], 1)
        self.assertEqual(diagnostic['details']['extraFileCount'], 0)
        self.assertNotIn('private', json.dumps(diagnostic))

    def test_unsafe_and_unresolved_links_and_unsupported_types_have_safe_categories(self):
        receipt, manifest = self.verify_archive()
        outside = self.root / 'private-account-secret'
        outside.write_bytes(b'private content')
        path = self.app / 'private-member-secret'
        for target, category in ((outside, 'symlink-outside-app'),
                                 (self.root / 'private-missing-secret', 'symlink-resolution')):
            with self.subTest(category=category):
                path.symlink_to(target)
                try:
                    diagnostic = self.public_verification_failure(self.app, receipt, manifest)
                    self.assertEqual(diagnostic['category'], category)
                    self.assertNotIn('private', json.dumps(diagnostic))
                finally:
                    path.unlink()
        os.mkfifo(path)
        diagnostic = self.public_verification_failure(self.app, receipt, manifest)
        self.assertEqual(diagnostic['category'], 'unsupported-member-type')

    def test_public_cli_omits_raw_typed_and_unknown_error_details(self):
        errors = [ValueError('https://private.invalid/token=private-secret'),
                  verifier.VerificationError('mode-mismatch', 'private-path-secret',
                      {'modeMismatchCount': 2, 'expectedMode': 0o644, 'actualMode': 0o600,
                       'private-field-secret': 'private-value-secret'})]
        for index, error in enumerate(errors):
            output = self.root / f'private-receipt-{index}.json'
            console = io.StringIO()
            with patch.object(sys, 'argv', ['verify-hosted-app', 'archive', '--receipt', str(output)]), \
                    patch.object(verifier, 'verify_archive', side_effect=error), \
                    contextlib.redirect_stdout(console):
                self.assertEqual(verifier.main(), 1)
            public = output.read_text() + console.getvalue()
            self.assertNotIn('private', public)
            self.assertNotIn('https://', public)
            self.assertNotIn(str(self.root), public)
            self.assertEqual(json.loads(output.read_text())['errorType'], type(error).__name__)

    def test_unknown_cli_failure_never_publishes_its_raw_message(self):
        output = self.root / 'failure.json'
        console = io.StringIO()
        with patch.object(sys, 'argv', ['verify-hosted-app', 'archive', '--receipt', str(output)]), \
                patch.object(verifier, 'verify_archive', side_effect=ValueError('private-secret')), \
                contextlib.redirect_stdout(console):
            self.assertEqual(verifier.main(), 1)
        self.assertNotIn('private-secret', output.read_text() + console.getvalue())

    def test_actual_zip_traversal_failure_never_publishes_member_name(self):
        self.write_archive([('HappyHerd.app/../private-member-secret', b'private contents', stat.S_IFREG | 0o644)])
        output = self.root / 'failure.json'
        console = io.StringIO()
        with patch.object(sys, 'argv', ['verify-hosted-app', 'archive', '--artifact-dir', str(self.artifact),
                                      '--receipt', str(output)]), \
                patch.object(verifier, 'EXPECTED_ARCHIVE_SHA', sha256(self.archive.read_bytes())), \
                contextlib.redirect_stdout(console):
            self.assertEqual(verifier.main(), 1)
        public = output.read_text() + console.getvalue()
        self.assertNotIn('private', public)
        self.assertNotIn(str(self.root), public)
        self.assertEqual(json.loads(output.read_text())['verificationFailure']['category'], 'artifact-validation')

    def test_public_diagnostics_filter_untrusted_values_and_bound_counts(self):
        error = verifier.VerificationError('mode-mismatch', 'private exception detail', {
            'modeMismatchCount': 10**30, 'missingFileCount': 'private-token',
            'expectedMode': -1, 'actualMode': 0o10000, 'private-key': 'private-value',
        })
        diagnostic = verifier.public_failure(error)['verificationFailure']
        self.assertEqual(diagnostic['details'], {'modeMismatchCount': 1000000})
        self.assertNotIn('private', json.dumps(diagnostic))
        unknown_error = type('private-secret-exception-name', (Exception,), {})('private message')
        self.assertEqual(verifier.public_failure(unknown_error), {'errorType': 'UnknownError'})

    def test_codesign_nonzero_result_fails_extracted_verification(self):
        archive_receipt, manifest = self.verify_archive()
        with self.assertRaises(verifier.VerificationError) as failure:
            self.verify_extracted(self.app, archive_receipt, manifest, returncode=1)
        public = verifier.public_failure(failure.exception)
        self.assertEqual(public['verificationFailure'], {
            'category': 'signature-verification-failure',
            'details': {'signatureCategory': 'verification-failed', 'returnCode': 1},
        })
        self.assertNotIn('private fixture', json.dumps(public))

    def test_malformed_signature_is_classified_without_parser_inputs(self):
        with self.assertRaises(verifier.VerificationError) as failure:
            verifier.verify_macho_signing(b'private malformed executable', self.signing)
        public = verifier.public_failure(failure.exception)
        self.assertEqual(public['verificationFailure']['category'], 'signature-parser-failure')
        self.assertEqual(public['verificationFailure']['details']['signatureCategory'], 'bounds')
        self.assertNotIn('private', json.dumps(public))

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
