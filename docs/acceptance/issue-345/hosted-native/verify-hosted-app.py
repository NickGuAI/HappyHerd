#!/usr/bin/env python3
"""Verify issue345 hosted artifact without downloading, extracting, or running it.

archive: Read the hosted ZIP and manifest; write a new verification receipt.
extracted: Also verify an already-extracted app and inspect its Mach-O architecture.
Neither mode modifies the archive/app, starts a simulator, or performs cleanup.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import posixpath
import re
import stat
import subprocess
import sys
import time
import zipfile

BASE = Path(__file__).resolve().parent
EXPECTED_SHA = '4933c0c727b08f2dbe7f90ae5e261d89a917e0de'
EXPECTED_ARCHIVE_SHA = '0a692dee476bc6fb12a79879a75fb7865c7ace0c2c3ab4960b90b26cc1d762b5'
EXPECTED_PRODUCT_TREE = 'e8a2fb1ad9756a56306354861f3d62b73f5f6eb8'
EXPECTED_BUILD_MODE = 'xcode-default-simulator-signing'
EXPECTED_TIMESTAMP = '2026-09-30T10:55:41-04:00'
EXPECTED_RUN = 'https://github.com/NickGuAI/HappyHerd/actions/runs/36733047107'
EXPECTED_BUNDLE_ID = 'app.happyherd.issue345.acceptance'
EXPECTED_SERVER = b'http://127.0.0.1:43545'
APP_ROOT = 'HappyHerd.app'
HEX256 = re.compile(r'^[0-9a-f]{64}$')
VERIFICATION_CATEGORIES = {
    'artifact-validation', 'app-directory', 'symlink-resolution', 'symlink-outside-app',
    'unsupported-member-type', 'file-payload-mismatch', 'member-set-mismatch',
    'member-type-mismatch', 'link-target-mismatch', 'mode-mismatch', 'metadata-mismatch',
    'isolated-api-mismatch', 'architecture-mismatch', 'executable-type-mismatch',
    'signing-receipt-mismatch', 'signature-fields-mismatch', 'signature-parser-failure',
    'signature-identity-failure', 'signature-verification-failure',
}
DIAGNOSTIC_COUNTS = {
    'expectedFileCount', 'actualFileCount', 'missingFileCount', 'extraFileCount',
    'changedFileHashCount', 'missingMemberCount', 'extraMemberCount',
    'typeMismatchCount', 'linkTargetMismatchCount', 'modeMismatchCount',
}
SIGNATURE_CATEGORIES = {
    'missing', 'malformed', 'bounds', 'wrong-architecture', 'missing-signature',
    'missing-target', 'identity-mismatch', 'verification-failed', 'timeout',
    'unavailable', 'io', 'invalid-arguments', 'unexpected', 'self-test-failed',
}


class VerificationError(ValueError):
    """Private explanation plus code-owned, strictly allowlisted public fields."""
    def __init__(self, category, message, details=None):
        if category not in VERIFICATION_CATEGORIES:
            raise ValueError('Unknown verification category')
        super().__init__(message)
        self.category = category
        self.details = details or {}


def public_failure(error):
    known_types = {VerificationError, ValueError, TypeError, KeyError, OSError,
                   FileNotFoundError, PermissionError, IsADirectoryError, NotADirectoryError,
                   RuntimeError, AssertionError, UnicodeDecodeError, json.JSONDecodeError,
                   plistlib.InvalidFileException, subprocess.CalledProcessError, subprocess.TimeoutExpired}
    result = {'errorType': type(error).__name__ if type(error) in known_types else 'UnknownError'}
    if isinstance(error, VerificationError):
        details = {}
        for key, value in error.details.items():
            if key in DIAGNOSTIC_COUNTS and type(value) is int and value >= 0:
                details[key] = min(value, 1000000)
            elif key in ('expectedMode', 'actualMode') and type(value) is int and 0 <= value <= 0o7777:
                details[key] = value
            elif key == 'returnCode' and type(value) is int and -65535 <= value <= 65535:
                details[key] = value
            elif key == 'signatureCategory' and isinstance(value, str) and value in SIGNATURE_CATEGORIES:
                details[key] = value
        category = error.category if isinstance(error.category, str) and error.category in VERIFICATION_CATEGORIES else 'unknown'
        result['verificationFailure'] = {'category': category, 'details': details}
    return result


def require(condition, message, *, category='artifact-validation', details=None):
    if not condition:
        raise VerificationError(category, message, details)


def digest_stream(stream):
    digest = hashlib.sha256()
    while chunk := stream.read(1024 * 1024):
        digest.update(chunk)
    return digest.hexdigest()


def digest_file(path):
    with path.open('rb') as stream:
        return digest_stream(stream)


def safe_name(name):
    require(isinstance(name, str) and name and '\x00' not in name,
            'Empty/invalid archive path')
    require(not name.startswith('/') and '\\' not in name,
            f'Absolute or backslash archive path: {name!r}')
    parts = name.rstrip('/').split('/')
    require(all(part not in ('', '.', '..') for part in parts),
            f'Archive path traversal or noncanonical component: {name!r}')
    require(not re.match(r'^[A-Za-z]:', parts[0]), f'Drive-qualified path: {name!r}')
    return '/'.join(parts)


def load_json(path):
    with path.open(encoding='utf-8') as stream:
        return json.load(stream)


def signing_parser():
    spec = importlib.util.spec_from_file_location('hh345_native_signing_receipt', BASE.parent / 'native-signing-receipt.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_signing_receipt(artifact, manifest):
    path = artifact / 'signing-receipt.json'
    expected_hash = manifest.get('signingReceiptSha256')
    require(isinstance(expected_hash, str) and HEX256.fullmatch(expected_hash), 'Invalid signing receipt hash')
    require(digest_file(path) == expected_hash, 'Build signing receipt bytes differ from manifest')
    signing = load_json(path)
    require(signing.get('schemaVersion') == 1 and signing.get('verified') is True
            and signing.get('sourceSha') == EXPECTED_SHA,
            'Expected verified signing receipt from selected native build')
    require(signing.get('app') == {'status': 'parsed', 'bundleIdentifierMatches': True,
            'executableMatches': True, 'simulatorPlatform': True}, 'Signing app identity mismatch')
    for name in ('buildSettings', 'generatedEntitlements', 'machO'):
        require(signing.get(name, {}).get('status') == 'parsed', 'Incomplete build signing receipt')
    require(signing.get('codesign') == {'status': 'parsed', 'returnCode': 0}, 'Build codesign verification did not pass')
    require(signing['machO'].get('executableSha256') == manifest['files'].get('HappyHerd'),
            'Signing receipt executable hash differs from manifest')
    return signing


def verify_macho_signing(data, signing):
    # The producer emits only fixed fields; reread the selected executable's
    # signature without printing raw identifiers, entitlement values or output.
    parser = signing_parser()
    try:
        actual = parser.summarize_macho(data)
    except parser.SafeFailure as error:
        raise VerificationError('signature-parser-failure', 'Executable signature could not be parsed',
                                {'signatureCategory': error.category}) from error
    require(signing['machO'] == {'status': 'parsed', **actual}, 'Executable signing fields differ from build receipt',
            category='signature-fields-mismatch')
    return actual


def metadata_checks(info_bytes, config_bytes, bundle_hash, manifest):
    info = plistlib.loads(info_bytes)
    config = json.loads(config_bytes)
    require(info.get('CFBundleIdentifier') == EXPECTED_BUNDLE_ID, 'Info.plist bundle ID mismatch')
    require(info.get('DTPlatformName') == 'iphonesimulator', 'Not an iOS simulator artifact')
    require('iPhoneSimulator' in info.get('CFBundleSupportedPlatforms', []),
            'Info.plist does not declare iPhoneSimulator')
    executable = info.get('CFBundleExecutable')
    require(isinstance(executable, str) and safe_name(executable) == executable
            and '/' not in executable, 'Unexpected executable path')
    app_metadata = config.get('extra', {}).get('app', {})
    require(app_metadata.get('buildCommitSha') == EXPECTED_SHA, 'app.config source SHA mismatch')
    require(app_metadata.get('buildCommitTimestamp') == EXPECTED_TIMESTAMP,
            'app.config commit timestamp mismatch')
    require(config.get('ios', {}).get('bundleIdentifier') == EXPECTED_BUNDLE_ID,
            'app.config bundle ID mismatch')
    require(str(config.get('ios', {}).get('buildNumber')) == str(info.get('CFBundleVersion')),
            'Build number differs between app.config and Info.plist')
    require(config.get('version') == info.get('CFBundleShortVersionString'),
            'App version differs between app.config and Info.plist')
    require(manifest['bundleSha256'] == bundle_hash, 'main.jsbundle manifest hash mismatch')
    require(manifest['appConfigSha256'] == hashlib.sha256(config_bytes).hexdigest(),
            'app.config manifest hash mismatch')
    return {
        'sourceSha': app_metadata['buildCommitSha'],
        'sourceCommitTimestamp': app_metadata['buildCommitTimestamp'],
        'bundleIdentifier': info['CFBundleIdentifier'],
        'executable': executable,
        'version': info.get('CFBundleShortVersionString'),
        'buildNumber': info.get('CFBundleVersion'),
        'platform': info.get('DTPlatformName'),
        'sdkName': info.get('DTSDKName'),
        'xcode': info.get('DTXcode'),
        'minimumOSVersion': info.get('MinimumOSVersion'),
        'appTransportSecurity': info.get('NSAppTransportSecurity'),
        'bundleSha256': bundle_hash,
        'appConfigSha256': manifest['appConfigSha256'],
    }


def verify_archive(artifact):
    require(HEX256.fullmatch(EXPECTED_ARCHIVE_SHA), 'Signed archive selection is pending verified build evidence')
    archive = artifact / 'HappyHerd.app.zip'
    manifest_path = artifact / 'build-manifest.json'
    checksum_path = artifact / 'archive.sha256'
    lines = checksum_path.read_text().splitlines()
    require(len(lines) == 1, 'archive.sha256 must contain one checksum')
    match = re.fullmatch(r'([0-9a-fA-F]{64})\s+\*?(.+)', lines[0])
    require(match is not None, 'Invalid archive.sha256 syntax')
    checksum_name = safe_name(match.group(2))
    require(PurePosixPath(checksum_name).name == archive.name, 'Checksum filename mismatch')
    archive_hash = digest_file(archive)
    require(archive_hash == match.group(1).lower() == EXPECTED_ARCHIVE_SHA, 'Downloaded archive SHA256 mismatch')
    manifest = load_json(manifest_path)
    for key, expected in {
        'sourceSha': EXPECTED_SHA,
        'nativeBuildMode': EXPECTED_BUILD_MODE,
        'productTree': EXPECTED_PRODUCT_TREE,
        'configuration': 'Release',
        'architecture': 'arm64',
        'bundleIdentifier': EXPECTED_BUNDLE_ID,
        'taskSpecificNativeSourcePatches': [],
    }.items():
        require(manifest.get(key) == expected, f'Build manifest {key} mismatch')
    require(manifest.get('revenueCatSourcePatched') is False,
            'Hosted manifest does not attest unpatched RevenueCat')
    expected_files = manifest.get('files')
    require(isinstance(expected_files, dict) and expected_files, 'Missing app file manifest')
    for name, value in expected_files.items():
        require(safe_name(name) == name and HEX256.fullmatch(value),
                f'Invalid manifest path/hash: {name!r}')
    for key in ['bundleSha256', 'appConfigSha256']:
        require(isinstance(manifest.get(key), str) and HEX256.fullmatch(manifest[key]),
                f'Invalid {key}')
    config_path = manifest.get('appConfigPath')
    require(isinstance(config_path, str) and safe_name(config_path) == config_path,
            'Invalid app.config path')
    require(config_path.endswith('EXConstants.bundle/app.config'), 'Unexpected app.config location')

    signing = load_signing_receipt(artifact, manifest)
    entries, member_receipts, metadata_members = {}, [], []
    with zipfile.ZipFile(archive) as zipped:
        seen, seen_casefold = set(), set()
        for item in zipped.infolist():
            name = safe_name(item.filename)
            require(name not in seen and name.casefold() not in seen_casefold,
                    f'Duplicate/case-colliding archive path: {name}')
            seen.add(name); seen_casefold.add(name.casefold())
            require(not item.flag_bits & 1, f'Encrypted ZIP member: {name}')
            mode = item.external_attr >> 16
            kind = ('directory' if item.is_dir() else
                    'symlink' if stat.S_ISLNK(mode) else 'file')
            require(stat.S_IFMT(mode) in (0, stat.S_IFREG, stat.S_IFDIR, stat.S_IFLNK),
                    f'Unsupported archive member type: {name}')
            if kind != 'directory':
                with zipped.open(item) as stream:
                    payload_hash = digest_stream(stream)
            else:
                payload_hash = None
            record = {'path': name, 'kind': kind, 'bytes': item.file_size,
                      'mode': stat.S_IMODE(mode), 'payloadSha256': payload_hash}
            if name == '__MACOSX' or name.startswith('__MACOSX/'):
                require(kind != 'symlink', 'Unexpected resource metadata symlink')
                metadata_members.append(record)
                continue
            require(name == APP_ROOT or name.startswith(APP_ROOT + '/'),
                    f'Unexpected archive root: {name}')
            relative = name[len(APP_ROOT):].lstrip('/')
            if not relative:
                require(kind == 'directory', 'App root is not a directory')
                continue
            record['path'] = relative
            if kind == 'symlink':
                target = zipped.read(item).decode('utf-8')
                require(target and not target.startswith('/') and '\\' not in target
                        and '\x00' not in target and not re.match(r'^[A-Za-z]:', target),
                        f'Unsafe symlink target: {relative}')
                resolved = posixpath.normpath(posixpath.join(posixpath.dirname(relative), target))
                require(resolved != '..' and not resolved.startswith('../'),
                        f'Symlink escapes app root: {relative}')
                record['target'] = target
            entries[relative] = {'info': item, **record}
            member_receipts.append(record)

        directories = {''}
        for name, row in entries.items():
            if row['kind'] == 'directory':
                directories.add(name)
            parts = name.split('/')
            directories.update('/'.join(parts[:i]) for i in range(1, len(parts)))
            require(all(entries.get('/'.join(parts[:i]), {}).get('kind') != 'symlink'
                        for i in range(1, len(parts))),
                    f'Archive member nested below a symlink: {name}')

        def resolve(name):
            for _ in range(40):
                parts = name.split('/') if name else []
                for index in range(1, len(parts) + 1):
                    prefix = '/'.join(parts[:index])
                    row = entries.get(prefix, {})
                    if row.get('kind') == 'symlink':
                        name = posixpath.normpath(posixpath.join(
                            posixpath.dirname(prefix), row['target'], *parts[index:]))
                        require(name != '..' and not name.startswith('../'),
                                f'Indirect symlink escape: {prefix}')
                        if name == '.': name = ''
                        break
                else:
                    require(name in entries or name in directories, f'Dangling link/path: {name}')
                    return name
            raise ValueError(f'Symlink cycle: {name}')

        actual_files = {}
        for name, row in entries.items():
            resolved = resolve(name)
            target = entries.get(resolved)
            if target and target['kind'] == 'file':
                actual_files[name] = target['payloadSha256']
        require(actual_files == expected_files,
                'ZIP app file set/hash mismatch: missing=' + str(sorted(set(expected_files) - set(actual_files)))
                + ', extra=' + str(sorted(set(actual_files) - set(expected_files)))
                + ', changed=' + str(sorted(n for n in set(actual_files) & set(expected_files)
                                           if actual_files[n] != expected_files[n])))
        configs = [name for name in actual_files if name.endswith('EXConstants.bundle/app.config')]
        require(configs == [config_path], 'Expected exactly one EXConstants app.config')

        def read_app(name):
            target = entries[resolve(name)]
            require(target['kind'] == 'file', f'Not a regular app file: {name}')
            return zipped.read(target['info'])

        bundle = read_app('main.jsbundle')
        require(EXPECTED_SERVER in bundle, 'Isolated API43545 missing from main.jsbundle')
        metadata = metadata_checks(read_app('Info.plist'), read_app(config_path),
                                   hashlib.sha256(bundle).hexdigest(), manifest)
        require(metadata['executable'] in actual_files, 'Executable missing from file manifest')
        verify_macho_signing(read_app(metadata['executable']), signing)

    return {
        'archivePath': str(archive), 'archiveBytes': archive.stat().st_size,
        'archiveSha256': archive_hash, 'buildManifestSha256': digest_file(manifest_path),
        'sourceSha': EXPECTED_SHA, 'expectedWorkflowRun': EXPECTED_RUN,
        'nativeBuildMode': EXPECTED_BUILD_MODE, 'productTree': EXPECTED_PRODUCT_TREE,
        'signingReceiptSha256': manifest['signingReceiptSha256'],
        'manifestAttestsNoTaskSpecificNativeSourcePatches': True,
        'manifestAttestsRevenueCatSourceUnpatched': True,
        'appFileCount': len(actual_files), 'appMembers': member_receipts,
        'resourceMetadataMemberCount': len(metadata_members),
        'resourceMetadataMembers': metadata_members,
        'metadata': metadata, 'containsIsolatedApiUrl': True,
        'archivePathTraversalCheck': 'passed',
    }, manifest


def verify_extracted(app, archive_receipt, manifest):
    require(app.is_dir() and not app.is_symlink(), 'Expected an extracted app directory, not a symlink',
            category='app-directory')
    root = app.resolve()
    actual_files, all_non_directories = {}, {}
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            path = Path(directory) / name
            relative = path.relative_to(root).as_posix()
            if path.is_symlink():
                try:
                    resolved = path.resolve(strict=True)
                except (OSError, RuntimeError) as error:
                    raise VerificationError('symlink-resolution', 'Extracted symlink could not be resolved') from error
                require(resolved.is_relative_to(root), f'Extracted symlink escapes app: {relative}',
                        category='symlink-outside-app')
                all_non_directories[relative] = {'kind': 'symlink', 'target': str(path.readlink())}
                if resolved.is_file(): actual_files[relative] = digest_file(path)
            elif path.is_file():
                actual_files[relative] = digest_file(path)
                all_non_directories[relative] = {'kind': 'file'}
            else:
                require(path.is_dir(), f'Unsupported extracted file type: {relative}',
                        category='unsupported-member-type')
    expected_files = manifest['files']
    counts = {
        'expectedFileCount': len(expected_files), 'actualFileCount': len(actual_files),
        'missingFileCount': len(expected_files.keys() - actual_files.keys()),
        'extraFileCount': len(actual_files.keys() - expected_files.keys()),
        'changedFileHashCount': sum(actual_files[name] != expected_files[name]
                                   for name in actual_files.keys() & expected_files.keys()),
    }
    require(actual_files == manifest['files'], 'Extracted app file set/hashes differ from hosted manifest',
            category='file-payload-mismatch', details=counts)
    expected_non_dirs = {r['path']: r for r in archive_receipt['appMembers'] if r['kind'] != 'directory'}
    counts.update(missingMemberCount=len(expected_non_dirs.keys() - all_non_directories.keys()),
                  extraMemberCount=len(all_non_directories.keys() - expected_non_dirs.keys()))
    require(set(all_non_directories) == set(expected_non_dirs), 'Extracted file/link set differs from ZIP',
            category='member-set-mismatch', details=counts)
    counts.update(typeMismatchCount=0, linkTargetMismatchCount=0, modeMismatchCount=0)
    for name, row in all_non_directories.items():
        expected = expected_non_dirs[name]
        if row['kind'] != expected['kind']:
            counts['typeMismatchCount'] += 1
        elif row['kind'] == 'symlink':
            counts['linkTargetMismatchCount'] += row['target'] != expected['target']
        elif expected['mode']:
            counts['modeMismatchCount'] += stat.S_IMODE((root/name).stat().st_mode) != expected['mode']
    for name, row in all_non_directories.items():
        expected = expected_non_dirs[name]
        require(row['kind'] == expected['kind'], f'Extracted member type mismatch: {name}',
                category='member-type-mismatch', details=counts)
        if row['kind'] == 'symlink':
            require(row['target'] == expected['target'], f'Extracted link target mismatch: {name}',
                    category='link-target-mismatch', details=counts)
        elif expected['mode']:
            require(stat.S_IMODE((root/name).stat().st_mode) == expected['mode'],
                    f'Extracted mode differs from ZIP: {name}', category='mode-mismatch',
                    details={**counts, 'expectedMode': expected['mode'],
                             'actualMode': stat.S_IMODE((root/name).stat().st_mode)})
    try:
        metadata = metadata_checks((root/'Info.plist').read_bytes(),
            (root/manifest['appConfigPath']).read_bytes(), digest_file(root/'main.jsbundle'), manifest)
    except VerificationError as error:
        raise VerificationError('metadata-mismatch', 'Extracted app metadata mismatch') from error
    require(EXPECTED_SERVER in (root/'main.jsbundle').read_bytes(), 'Extracted bundle API mismatch',
            category='isolated-api-mismatch')
    executable = root / metadata['executable']
    architectures = subprocess.check_output(['xcrun', 'lipo', '-archs', str(executable)], text=True).strip()
    file_description = subprocess.check_output(['/usr/bin/file', str(executable)], text=True).strip()
    require(architectures.split() == ['arm64'], 'Extracted executable is not arm64-only',
            category='architecture-mismatch')
    require('Mach-O' in file_description and 'executable arm64' in file_description,
            'Unexpected Mach-O executable type', category='executable-type-mismatch')
    try:
        signing = load_signing_receipt(Path(archive_receipt['archivePath']).parent, manifest)
    except VerificationError as error:
        raise VerificationError('signing-receipt-mismatch', 'Selected signing receipt mismatch') from error
    parser = signing_parser()
    try:
        parser.inspect_app(root)
    except parser.SafeFailure as error:
        raise VerificationError('signature-identity-failure', 'Signature app identity check failed',
                                {'signatureCategory': error.category}) from error
    actual_signing = verify_macho_signing(executable.read_bytes(), signing)
    try:
        codesign_result = parser.verify_codesign(root)
    except parser.SafeFailure as error:
        raise VerificationError('signature-verification-failure', 'Extracted app codesign verification did not pass',
                                {'signatureCategory': error.category,
                                 'returnCode': error.fields.get('returnCode')}) from error
    require(codesign_result == {'returnCode': 0}, 'Extracted app codesign verification did not pass',
            category='signature-verification-failure')
    return {'appPath': str(root), 'appFileCount': len(actual_files),
            'buildSigningVerified': True, 'executableSha256': actual_signing['executableSha256'],
            'signingReceiptSha256': manifest['signingReceiptSha256'],
            'allFileHashesMatchArchiveManifest': True,
            'archiveModesAndSymlinkTargetsMatch': True,
            'executableArchitectures': architectures, 'executableDescription': file_description,
            'metadata': metadata}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['archive', 'extracted'])
    parser.add_argument('--artifact-dir', type=Path, default=BASE/'hosted-build/attempt3')
    parser.add_argument('--app', type=Path, help='Already-extracted HappyHerd.app; required in extracted mode')
    parser.add_argument('--receipt', type=Path, required=True, help='New receipt path; existing files are never overwritten')
    args = parser.parse_args()
    require(not args.receipt.exists(), 'Receipt already exists; choose a new path to preserve it')
    require(args.receipt.parent.is_dir(), 'Receipt parent directory does not exist')
    require((args.mode == 'extracted') == (args.app is not None), '--app is required only in extracted mode')
    receipt = {'startedAt': time.time(), 'mode': args.mode, 'verified': False,
               'scope': 'Artifact verification only; no simulator/install/launch/native gesture proof',
               'scriptSha256': digest_file(Path(__file__))}
    code = 0
    try:
        archive_receipt, manifest = verify_archive(args.artifact_dir.resolve())
        receipt['archive'] = archive_receipt
        if args.mode == 'extracted':
            receipt['extracted'] = verify_extracted(args.app, archive_receipt, manifest)
        receipt['verified'] = True
    except Exception as error:
        receipt.update(public_failure(error))
        code = 1
    receipt['finishedAt'] = time.time()
    with args.receipt.open('x', encoding='utf-8') as output:
        json.dump(receipt, output, indent=2); output.write('\n')
    print(json.dumps({key: receipt[key] for key in
                      ('verified', 'mode', 'errorType', 'verificationFailure') if key in receipt}, indent=2))
    return code


if __name__ == '__main__':
    sys.exit(main())
