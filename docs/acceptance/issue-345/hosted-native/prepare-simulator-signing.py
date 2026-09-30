#!/usr/bin/env python3
"""Create a signature-only simulator derivative of the verified hosted67 app.

Never modifies the original artifact or app. The sole entitlement identifies
this isolated simulator app's private default keychain group; no signing
certificate, developer account, shared group or account material is used.
"""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import os
import plistlib
import shutil
import stat
import struct
import subprocess
import time
import uuid

EXPECTED_SHA = '67a22ead631e384802e5f7a8657ff674c07ab28d'
EXPECTED_ARCHIVE_SHA = 'd28905ccf3fcf3d8156a44798a018d766d123afeb3982585a0bcbc56ad8d6133'
APP_ID = 'app.happyherd.issue345.acceptance'
ENTITLEMENTS = {'application-identifier': 'HH345SIM01.' + APP_ID}
SIGNATURE_RESOURCE = '_CodeSignature/CodeResources'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest_bytes(value):
    return hashlib.sha256(value).hexdigest()


def digest_file(path):
    with path.open('rb') as stream:
        result = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def inventory(app):
    require(app.is_dir() and not app.is_symlink(), 'Expected a regular app directory')
    root = app.resolve()
    files, nodes = {}, {}
    for directory, dirs, names in os.walk(root, followlinks=False):
        for name in sorted(dirs + names):
            path = Path(directory) / name
            relative = path.relative_to(root).as_posix()
            mode = stat.S_IMODE(path.lstat().st_mode)
            if path.is_symlink():
                require(path.resolve(strict=True).is_relative_to(root), 'App symlink escapes bundle')
                nodes[relative] = {'kind': 'symlink', 'target': os.readlink(path), 'mode': mode}
                if path.is_file():
                    files[relative] = digest_file(path)
            elif path.is_file():
                files[relative] = digest_file(path)
                nodes[relative] = {'kind': 'file', 'mode': mode}
            else:
                require(path.is_dir(), 'Unsupported app node')
                nodes[relative] = {'kind': 'directory', 'mode': mode}
    return dict(sorted(files.items())), nodes


def macho_identity(data):
    """Hash every section and all pre-signature bytes, except signing metadata."""
    require(len(data) >= 32, 'Truncated Mach-O header')
    header = struct.unpack_from('<8I', data)
    require(header[0] == 0xfeedfacf and header[1] == 0x100000c and header[3] == 2,
            'Expected thin arm64 Mach-O executable')
    command_end = 32 + header[5]
    require(command_end <= len(data), 'Truncated load commands')
    sections, uuids, signature_commands, signing_ranges = [], [], [], []
    offset = 32
    for _ in range(header[4]):
        require(offset + 8 <= command_end, 'Truncated load command')
        command, length = struct.unpack_from('<II', data, offset)
        require(length >= 8 and length % 8 == 0 and offset + length <= command_end,
                'Invalid load command size')
        if command == 0x19:  # LC_SEGMENT_64
            require(length >= 72, 'Truncated segment')
            name = data[offset + 8:offset + 24].rstrip(b'\0').decode('ascii')
            count = struct.unpack_from('<I', data, offset + 64)[0]
            require(length == 72 + count * 80, 'Segment section count mismatch')
            if name == '__LINKEDIT':
                # codesign can resize the signature and its enclosing segment.
                signing_ranges.extend([(offset + 32, 8), (offset + 48, 8)])
            for index in range(count):
                start = offset + 72 + index * 80
                section_name, segment_name, address, size, file_offset, align, reloc, reloc_count, flags, r1, r2, r3 = struct.unpack_from('<16s16sQQ8I', data, start)
                section_name = section_name.rstrip(b'\0').decode('ascii')
                segment_name = segment_name.rstrip(b'\0').decode('ascii')
                require(segment_name == name, 'Section segment mismatch')
                zero_fill = flags & 0xff in (1, 0xc, 0x12)
                require(zero_fill or file_offset + size <= len(data), 'Section outside executable')
                sections.append({'segment': name, 'section': section_name, 'address': address,
                                 'size': size, 'fileOffset': file_offset, 'alignment': align,
                                 'relocationOffset': reloc, 'relocationCount': reloc_count,
                                 'flags': flags, 'reserved': [r1, r2, r3], 'zeroFill': zero_fill,
                                 'sha256': None if zero_fill else digest_bytes(data[file_offset:file_offset + size])})
        elif command == 0x1b:  # LC_UUID
            require(length == 24, 'Invalid UUID command')
            uuids.append(str(uuid.UUID(bytes=data[offset + 8:offset + 24])))
        elif command == 0x1d:  # LC_CODE_SIGNATURE
            require(length == 16, 'Invalid signature command')
            signature_commands.append(struct.unpack_from('<II', data, offset + 8))
            signing_ranges.append((offset + 8, 8))
        offset += length
    require(offset == command_end and len(uuids) == 1 and len(signature_commands) == 1,
            'Unexpected Mach-O command layout')
    signature_offset, signature_size = signature_commands[0]
    require(command_end <= signature_offset and signature_size >= 12
            and signature_offset + signature_size == len(data), 'Unexpected signature placement')
    require(all(section['zeroFill'] or section['fileOffset'] + section['size'] <= signature_offset
                for section in sections), 'Section overlaps signature')
    normalized = bytearray(data[:signature_offset])
    for start, length in signing_ranges:
        normalized[start:start + length] = b'\0' * length
    return {'uuid': uuids[0], 'sections': sections, 'signatureOffset': signature_offset,
            'signatureSize': signature_size, 'unsignedPayloadSha256': digest_bytes(normalized)}


def signed_entitlements(data, identity):
    start, size = identity['signatureOffset'], identity['signatureSize']
    magic, length, count = struct.unpack_from('>III', data, start)
    require(magic == 0xfade0cc0 and length <= size and 12 + count * 8 <= length,
            'Invalid signature superblob')
    blobs = {}
    for index in range(count):
        slot, relative = struct.unpack_from('>II', data, start + 12 + index * 8)
        require(slot not in blobs and relative >= 12 + count * 8 and relative + 8 <= length,
                'Invalid signature slot')
        blob_magic, blob_length = struct.unpack_from('>II', data, start + relative)
        require(blob_length >= 8 and relative + blob_length <= length, 'Truncated signature blob')
        blobs[slot] = (blob_magic, data[start + relative:start + relative + blob_length])
    require(0 in blobs and 5 in blobs and blobs[5][0] == 0xfade7171,
            'Missing signed XML entitlements')
    directory_magic, directory = blobs[0]
    require(directory_magic == 0xfade0c02 and len(directory) >= 24, 'Missing CodeDirectory')
    require(struct.unpack_from('>I', directory, 12)[0] & 2, 'Expected ad-hoc signature')
    identifier_offset = struct.unpack_from('>I', directory, 20)[0]
    require(24 <= identifier_offset < len(directory), 'Invalid signing identifier')
    identifier = directory[identifier_offset:].split(b'\0', 1)[0].decode('ascii')
    require(identifier == APP_ID, 'Signing identifier mismatch')
    entitlements = plistlib.loads(blobs[5][1][8:])
    require(entitlements == ENTITLEMENTS, 'Unexpected entitlement claim')
    return entitlements


def verify_variant(original_app, signed_app, manifest):
    """Read-only revalidation for the controller/driver; emits no raw data."""
    original_app, signed_app = Path(original_app), Path(signed_app)
    require(original_app.resolve() != signed_app.resolve(), 'Original and derivative must differ')
    require(manifest.get('sourceSha') == EXPECTED_SHA and manifest.get('architecture') == 'arm64'
            and manifest.get('configuration') == 'Release' and manifest.get('bundleIdentifier') == APP_ID
            and manifest.get('taskSpecificNativeSourcePatches') == []
            and manifest.get('revenueCatSourcePatched') is False, 'Unexpected source manifest')
    original_files, original_nodes = inventory(original_app)
    signed_files, signed_nodes = inventory(signed_app)
    require(original_files == manifest['files'] and len(original_files) == 729,
            'Original app differs from verified hosted artifact')
    info = plistlib.loads((original_app / 'Info.plist').read_bytes())
    executable = info['CFBundleExecutable']
    require(info['CFBundleIdentifier'] == APP_ID and info['DTPlatformName'] == 'iphonesimulator'
            and executable == 'HappyHerd', 'Unexpected original app identity')
    require(original_nodes[executable]['kind'] == 'file' and signed_nodes.get(executable) == original_nodes[executable],
            'Executable file type/mode changed')
    require(set(original_nodes) <= set(signed_nodes), 'Derivative removed an app node')
    require(set(signed_nodes) - set(original_nodes) <= {'_CodeSignature', SIGNATURE_RESOURCE},
            'Derivative added non-signature resources')
    for name, node in signed_nodes.items():
        if name == '_CodeSignature':
            require(node['kind'] == 'directory', 'Signature directory must be regular')
        elif name == SIGNATURE_RESOURCE:
            require(node['kind'] == 'file', 'Signature resource must be regular')
        else:
            require(node == original_nodes.get(name), 'App mode/type/symlink changed')
            if name in signed_files and name != executable:
                require(signed_files[name] == original_files[name], 'Non-signature app file changed')
    original_data = (original_app / executable).read_bytes()
    signed_data = (signed_app / executable).read_bytes()
    original_identity, signed_identity = macho_identity(original_data), macho_identity(signed_data)
    for key in ('uuid', 'sections', 'signatureOffset', 'unsignedPayloadSha256'):
        require(original_identity[key] == signed_identity[key], 'Compiled executable payload changed')
    entitlements = signed_entitlements(signed_data, signed_identity)
    require(signed_files['main.jsbundle'] == manifest['bundleSha256']
            and signed_files[manifest['appConfigPath']] == manifest['appConfigSha256'], 'JS/config changed')
    return {'verified': True, 'sourceSha': EXPECTED_SHA, 'originalFilesVerified': len(original_files),
            'files': signed_files, 'originalExecutableSha256': digest_bytes(original_data),
            'signedExecutableSha256': digest_bytes(signed_data), 'bundleSha256': manifest['bundleSha256'],
            'appConfigSha256': manifest['appConfigSha256'], 'unchangedCodeSections': True,
            'unchangedUUID': True, 'unchangedUnsignedPayload': True, 'unchangedBundle': True,
            'unchangedAppConfig': True, 'uuid': signed_identity['uuid'],
            'unsignedPayloadSha256': signed_identity['unsignedPayloadSha256'],
            'codeSections': signed_identity['sections'], 'entitlements': entitlements,
            'changedFiles': sorted(name for name in original_files if signed_files.get(name) != original_files[name]),
            'addedFiles': sorted(set(signed_files) - set(original_files))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact-dir', type=Path, required=True)
    parser.add_argument('--original-app', type=Path, required=True)
    parser.add_argument('--signed-app', type=Path, required=True)
    parser.add_argument('--receipt', type=Path, required=True)
    parser.add_argument('--private-dir', type=Path)
    args = parser.parse_args()
    receipt = {'verified': False, 'startedAt': time.time(), 'sourceSha': EXPECTED_SHA,
               'scope': 'Simulator signature-only derivative; no native interaction pass', 'commands': []}
    stage = 'preflight'
    try:
        require(not args.receipt.exists() and args.receipt.parent.is_dir(), 'Use a new public receipt path')
        require(not args.signed_app.exists() and not args.signed_app.is_symlink(), 'Use a new derivative app path')
        original, signed = args.original_app.resolve(), args.signed_app.resolve()
        require(not signed.is_relative_to(original) and not original.is_relative_to(signed), 'App paths overlap')
        private = args.private_dir or Path(os.environ['HH345_ARTIFACT_DIR']) / 'signing-private'
        require(not private.resolve().is_relative_to(signed) and not private.resolve().is_relative_to(original),
                'Signing logs must be outside app bundles')
        private.mkdir(parents=True, mode=0o700)
        module_path = Path(__file__).with_name('verify-hosted-app.py')
        spec = importlib.util.spec_from_file_location('hosted_app_verifier', module_path)
        verifier = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(verifier)
        stage = 'verify-original'
        archive, manifest = verifier.verify_archive(args.artifact_dir.resolve())
        require(archive['archiveSha256'] == EXPECTED_ARCHIVE_SHA, 'Unexpected original ZIP')
        verifier.verify_extracted(original, archive, manifest)
        require(len(manifest['files']) == 729, 'Unexpected hosted app file count')
        receipt.update(originalArchiveSha256=archive['archiveSha256'],
                       buildManifestSha256=archive['buildManifestSha256'],
                       originalAppPath=str(original), signedAppPath=str(signed))
        stage = 'copy-original'
        signed.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(original, signed, symlinks=True)
        require(inventory(original) == inventory(signed), 'Copied app differs before signing')
        entitlements_path = private / 'simulator.entitlements.plist'
        entitlements_path.write_bytes(plistlib.dumps(ENTITLEMENTS, fmt=plistlib.FMT_XML))

        def command(arguments, label):
            with (private / (label + '.log')).open('xb') as output:
                result = subprocess.run(arguments, stdout=output, stderr=subprocess.STDOUT, timeout=90)
            receipt['commands'].append({'operation': label, 'exitCode': result.returncode})
            require(result.returncode == 0, 'Owned signing command failed')

        stage = 'sign-outer-app'
        command(['/usr/bin/codesign', '--force', '--sign', '-', '--timestamp=none',
                 '--generate-entitlement-der', '--entitlements', str(entitlements_path), str(signed)], 'adhoc-sign')
        stage = 'verify-signature'
        command(['/usr/bin/codesign', '--verify', '--strict', str(signed)], 'verify-signature')
        stage = 'verify-derivative'
        receipt.update(verify_variant(original, signed, manifest))
        receipt['codesignVerified'] = True
        require(verifier.digest_file(args.artifact_dir / 'HappyHerd.app.zip') == EXPECTED_ARCHIVE_SHA,
                'Original ZIP changed during preparation')
        receipt['originalArtifactPreserved'] = True
    except Exception as error:
        receipt.update(verified=False, failureStage=stage, errorType=type(error).__name__)
    receipt['finishedAt'] = time.time()
    # No raw codesign output, exception messages, signatures or credentials.
    try:
        with args.receipt.open('x') as output:
            json.dump(receipt, output, indent=2); output.write('\n')
    except Exception:
        print('HH345_SIMULATOR_SIGNING_RECEIPT_FAILED')
        return 1
    print('HH345_SIMULATOR_SIGNING_VERIFIED' if receipt['verified'] else 'HH345_SIMULATOR_SIGNING_FAILED')
    return 0 if receipt['verified'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
