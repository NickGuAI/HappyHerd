#!/usr/bin/env python3
"""Verify issue345 hosted artifact without downloading, extracting, or running it.

archive: Read the hosted ZIP and manifest; write a new verification receipt.
extracted: Also verify an already-extracted app and inspect its Mach-O architecture.
Neither mode modifies the archive/app, starts a simulator, or performs cleanup.
"""
from __future__ import annotations
import argparse
import hashlib
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
EXPECTED_SHA = '67a22ead631e384802e5f7a8657ff674c07ab28d'
EXPECTED_TIMESTAMP = '2026-09-30T00:33:49-04:00'
EXPECTED_RUN = 'https://github.com/NickGuAI/HappyHerd/actions/runs/36669543990'
EXPECTED_BUNDLE_ID = 'app.happyherd.issue345.acceptance'
EXPECTED_SERVER = b'http://127.0.0.1:43545'
APP_ROOT = 'HappyHerd.app'
HEX256 = re.compile(r'^[0-9a-f]{64}$')


def require(condition, message):
    if not condition:
        raise ValueError(message)


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
    require(archive_hash == match.group(1).lower(), 'Downloaded archive SHA256 mismatch')
    manifest = load_json(manifest_path)
    for key, expected in {
        'sourceSha': EXPECTED_SHA,
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

    return {
        'archivePath': str(archive), 'archiveBytes': archive.stat().st_size,
        'archiveSha256': archive_hash, 'buildManifestSha256': digest_file(manifest_path),
        'sourceSha': EXPECTED_SHA, 'expectedWorkflowRun': EXPECTED_RUN,
        'manifestAttestsNoTaskSpecificNativeSourcePatches': True,
        'manifestAttestsRevenueCatSourceUnpatched': True,
        'appFileCount': len(actual_files), 'appMembers': member_receipts,
        'resourceMetadataMemberCount': len(metadata_members),
        'resourceMetadataMembers': metadata_members,
        'metadata': metadata, 'containsIsolatedApiUrl': True,
        'archivePathTraversalCheck': 'passed',
    }, manifest


def verify_extracted(app, archive_receipt, manifest):
    require(app.is_dir() and not app.is_symlink(), 'Expected an extracted app directory, not a symlink')
    root = app.resolve()
    actual_files, all_non_directories = {}, {}
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            path = Path(directory) / name
            relative = path.relative_to(root).as_posix()
            if path.is_symlink():
                resolved = path.resolve(strict=True)
                require(resolved.is_relative_to(root), f'Extracted symlink escapes app: {relative}')
                all_non_directories[relative] = {'kind': 'symlink', 'target': str(path.readlink())}
                if resolved.is_file(): actual_files[relative] = digest_file(path)
            elif path.is_file():
                actual_files[relative] = digest_file(path)
                all_non_directories[relative] = {'kind': 'file'}
            else:
                require(path.is_dir(), f'Unsupported extracted file type: {relative}')
    require(actual_files == manifest['files'], 'Extracted app file set/hashes differ from hosted manifest')
    expected_non_dirs = {r['path']: r for r in archive_receipt['appMembers'] if r['kind'] != 'directory'}
    require(set(all_non_directories) == set(expected_non_dirs), 'Extracted file/link set differs from ZIP')
    for name, row in all_non_directories.items():
        expected = expected_non_dirs[name]
        require(row['kind'] == expected['kind'], f'Extracted member type mismatch: {name}')
        if row['kind'] == 'symlink':
            require(row['target'] == expected['target'], f'Extracted link target mismatch: {name}')
        elif expected['mode']:
            require(stat.S_IMODE((root/name).stat().st_mode) == expected['mode'],
                    f'Extracted mode differs from ZIP: {name}')
    metadata = metadata_checks((root/'Info.plist').read_bytes(),
        (root/manifest['appConfigPath']).read_bytes(), digest_file(root/'main.jsbundle'), manifest)
    require(EXPECTED_SERVER in (root/'main.jsbundle').read_bytes(), 'Extracted bundle API mismatch')
    executable = root / metadata['executable']
    architectures = subprocess.check_output(['xcrun', 'lipo', '-archs', str(executable)], text=True).strip()
    file_description = subprocess.check_output(['/usr/bin/file', str(executable)], text=True).strip()
    require(architectures.split() == ['arm64'], 'Extracted executable is not arm64-only')
    require('Mach-O' in file_description and 'executable arm64' in file_description,
            'Unexpected Mach-O executable type')
    return {'appPath': str(root), 'appFileCount': len(actual_files),
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
        receipt['error'] = f'{type(error).__name__}: {error}'
        code = 1
    receipt['finishedAt'] = time.time()
    with args.receipt.open('x', encoding='utf-8') as output:
        json.dump(receipt, output, indent=2); output.write('\n')
    print(json.dumps({'verified': receipt['verified'], 'mode': args.mode,
                      'receipt': str(args.receipt), 'error': receipt.get('error')}, indent=2))
    return code


if __name__ == '__main__':
    sys.exit(main())
