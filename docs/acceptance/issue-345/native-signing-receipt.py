#!/usr/bin/env python3
"""Emit a fixed-field signing receipt; never print private signing inputs."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import struct
import subprocess
import sys


APP_ID = 'app.happyherd.issue345.acceptance'
TARGET = 'HappyHerd'
MAX_PLIST_BYTES = 1024 * 1024
MAX_SETTINGS_BYTES = 16 * 1024 * 1024
MAX_EXECUTABLE_BYTES = 512 * 1024 * 1024
MAX_SIGNATURE_BYTES = 16 * 1024 * 1024
ENTITLEMENT_KEYS = (
    'application-identifier', 'com.apple.application-identifier',
    'keychain-access-groups', 'get-task-allow',
    'com.apple.developer.team-identifier',
)
CATEGORIES = {
    'missing', 'malformed', 'bounds', 'wrong-architecture', 'missing-signature',
    'missing-target', 'identity-mismatch', 'verification-failed', 'timeout',
    'unavailable', 'io', 'invalid-arguments', 'unexpected', 'self-test-failed',
}


class SafeFailure(Exception):
    def __init__(self, category, fields=None):
        assert category in CATEGORIES
        super().__init__(category)
        self.category = category
        self.fields = fields or {}


def require(condition, category='malformed'):
    if not condition:
        raise SafeFailure(category)


def read_bounded(path, limit):
    require(path.is_file(), 'missing')
    require(not path.is_symlink(), 'malformed')
    with path.open('rb') as stream:
        data = stream.read(limit + 1)
    require(len(data) <= limit, 'bounds')
    return data


def parse_plist(data):
    require(len(data) <= MAX_PLIST_BYTES, 'bounds')
    try:
        value = plistlib.loads(data)
    except Exception:
        raise SafeFailure('malformed') from None
    require(isinstance(value, dict))
    return value


def matches_app(value):
    return isinstance(value, str) and (value == APP_ID or value.endswith('.' + APP_ID))


def summarize_entitlements(data):
    value = parse_plist(data)
    groups = value.get('keychain-access-groups')
    task_allow = value.get('get-task-allow')
    return {
        'present': {key: key in value for key in ENTITLEMENT_KEYS},
        'getTaskAllow': task_allow if type(task_allow) is bool else None,
        'applicationIdentifierMatchesApp': matches_app(value.get('application-identifier')),
        'appleApplicationIdentifierMatchesApp': matches_app(value.get('com.apple.application-identifier')),
        'keychainGroupMatchesApp': isinstance(groups, list) and any(matches_app(group) for group in groups),
    }


def setting_enum(value):
    if value is None or value == '':
        return 'unset'
    return {'YES': 'yes', 'NO': 'no'}.get(value, 'other') if isinstance(value, str) else 'other'


def identity_enum(value):
    if value is None or value == '':
        return 'unset'
    return 'local-ad-hoc' if value in ('-', 'Sign to Run Locally') else 'other'


def summarize_build_settings(data):
    require(len(data) <= MAX_SETTINGS_BYTES, 'bounds')
    try:
        entries = json.loads(data)
    except Exception:
        raise SafeFailure('malformed') from None
    require(isinstance(entries, list))
    selected = [entry for entry in entries if isinstance(entry, dict) and entry.get('target') == TARGET]
    require(len(selected) == 1, 'missing-target' if not selected else 'malformed')
    settings = selected[0].get('buildSettings')
    require(isinstance(settings, dict))
    return {
        'codeSigningAllowed': setting_enum(settings.get('CODE_SIGNING_ALLOWED')),
        'codeSigningRequired': setting_enum(settings.get('CODE_SIGNING_REQUIRED')),
        'codeSigningIdentity': identity_enum(settings.get('CODE_SIGN_IDENTITY')),
        'expandedCodeSigningIdentity': identity_enum(settings.get('EXPANDED_CODE_SIGN_IDENTITY')),
        'developmentTeamSet': settings.get('DEVELOPMENT_TEAM') not in (None, ''),
    }


def generated_entitlements(derived_data):
    # Select only the app target, never Pods or another target's generated files.
    target = derived_data / 'Build/Intermediates.noindex/HappyHerd.build/Release-iphonesimulator/HappyHerd.build'
    result = {
        'xcentCount': 0, 'normalCount': 0, 'simulatedCount': 0,
        'derCount': 0, 'normalDerCount': 0, 'simulatedDerCount': 0,
        'entries': [],
    }
    if not target.exists():
        return result
    require(target.is_dir() and not target.is_symlink())
    root = target.resolve()
    xcent_files = sorted(target.rglob('*.xcent'))
    der_files = sorted(target.rglob('*.xcent.der'))
    require(len(xcent_files) + len(der_files) <= 64, 'bounds')
    for path in xcent_files + der_files:
        require(path.is_file() and not path.is_symlink() and path.resolve().is_relative_to(root))
    result['xcentCount'] = len(xcent_files)
    result['derCount'] = len(der_files)
    for path in xcent_files:
        simulated = path.name.endswith('.app-Simulated.xcent')
        result['simulatedCount' if simulated else 'normalCount'] += 1
        result['entries'].append({
            'kind': 'simulated' if simulated else 'normal',
            'entitlements': summarize_entitlements(read_bounded(path, MAX_PLIST_BYTES)),
        })
    for path in der_files:
        simulated = path.name.endswith('.app-Simulated.xcent.der')
        result['simulatedDerCount' if simulated else 'normalDerCount'] += 1
    return result


def code_directory_flags(blob):
    require(len(blob) >= 44, 'bounds')
    magic, length, version, flags, hash_offset, identifier_offset, special_count, code_count = struct.unpack_from('>8I', blob)
    require(magic == 0xfade0c02 and length == len(blob))
    minimum = 44
    for threshold, size in ((0x20100, 48), (0x20200, 52), (0x20300, 64),
                            (0x20400, 88), (0x20500, 96), (0x20600, 108)):
        if version >= threshold:
            minimum = size
    require(len(blob) >= minimum, 'bounds')
    require(minimum <= identifier_offset < len(blob), 'bounds')
    require(blob.find(b'\0', identifier_offset) != -1)
    hash_size = blob[36]
    require(0 < hash_size <= 64)
    require(minimum <= hash_offset - special_count * hash_size
            and hash_offset + code_count * hash_size <= len(blob), 'bounds')
    return flags


def summarize_macho(data):
    require(32 <= len(data) <= MAX_EXECUTABLE_BYTES, 'bounds')
    header = struct.unpack_from('<8I', data)
    require(header[0] == 0xfeedfacf and header[1] == 0x100000c
            and header[3] == 2, 'wrong-architecture')
    command_count, command_bytes = header[4], header[5]
    require(command_count <= 16384 and command_bytes <= MAX_SIGNATURE_BYTES, 'bounds')
    command_end = 32 + command_bytes
    require(command_end <= len(data), 'bounds')
    offset, signatures = 32, []
    for _ in range(command_count):
        require(offset + 8 <= command_end, 'bounds')
        command, length = struct.unpack_from('<II', data, offset)
        require(length >= 8 and length % 8 == 0 and offset + length <= command_end, 'bounds')
        if command == 0x1d:  # LC_CODE_SIGNATURE
            require(length == 16)
            signatures.append(struct.unpack_from('<II', data, offset + 8))
        offset += length
    require(offset == command_end)
    require(len(signatures) == 1, 'missing-signature' if not signatures else 'malformed')
    signature_offset, signature_size = signatures[0]
    require(command_end <= signature_offset and 12 <= signature_size <= MAX_SIGNATURE_BYTES
            and signature_offset + signature_size <= len(data), 'bounds')
    signature = memoryview(data)[signature_offset:signature_offset + signature_size]
    magic, length, count = struct.unpack_from('>III', signature)
    require(magic == 0xfade0cc0)
    require(12 <= length <= signature_size and count <= 64 and 12 + count * 8 <= length, 'bounds')
    blobs, ranges = {}, []
    for index in range(count):
        slot, relative = struct.unpack_from('>II', signature, 12 + index * 8)
        require(slot not in blobs)
        require(relative >= 12 + count * 8 and relative + 8 <= length, 'bounds')
        blob_magic, blob_length = struct.unpack_from('>II', signature, relative)
        require(blob_length >= 8 and relative + blob_length <= length, 'bounds')
        end = relative + blob_length
        require(all(end <= start or relative >= previous_end for start, previous_end in ranges))
        ranges.append((relative, end))
        blobs[slot] = (blob_magic, bytes(signature[relative:end]))
    require(0 in blobs, 'missing-signature')
    flags = code_directory_flags(blobs[0][1])
    # Validate alternate CodeDirectory slots too, without retaining identifiers.
    alternate_flags = [code_directory_flags(blobs[slot][1]) for slot in sorted(blobs) if 0x1000 <= slot < 0x1005]
    xml_present, der_present = 5 in blobs, 7 in blobs
    if xml_present:
        require(blobs[5][0] == 0xfade7171)
    if der_present:
        require(blobs[7][0] == 0xfade7172)
    return {
        'architecture': 'arm64', 'thin': True, 'codeSignaturePresent': True,
        'executableSha256': hashlib.sha256(data).hexdigest(),
        'slotCount': count, 'codeDirectoryFlags': flags,
        'alternateCodeDirectoryFlags': alternate_flags,
        'xmlEntitlementsPresent': xml_present, 'derEntitlementsPresent': der_present,
        'xmlEntitlements': summarize_entitlements(blobs[5][1][8:]) if xml_present else None,
    }


def inspect_app(app):
    require(app.is_dir() and not app.is_symlink(), 'missing')
    info = parse_plist(read_bounded(app / 'Info.plist', MAX_PLIST_BYTES))
    require(info.get('CFBundleIdentifier') == APP_ID
            and info.get('CFBundleExecutable') == TARGET
            and info.get('DTPlatformName') == 'iphonesimulator', 'identity-mismatch')
    return {'bundleIdentifierMatches': True, 'executableMatches': True, 'simulatorPlatform': True}


def verify_codesign(app):
    require(app.is_dir() and not app.is_symlink(), 'missing')
    try:
        result = subprocess.run(['codesign', '--verify', '--strict', str(app)],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=30, check=False)
    except subprocess.TimeoutExpired:
        raise SafeFailure('timeout', {'returnCode': None}) from None
    except FileNotFoundError:
        raise SafeFailure('unavailable', {'returnCode': None}) from None
    # Tool output can include private paths and identifiers; never retain it.
    if result.returncode != 0:
        raise SafeFailure('verification-failed', {'returnCode': result.returncode})
    return {'returnCode': result.returncode}


def classify_posix162(stdout, stderr):
    return 'codesigning-issue' if (stdout + stderr).strip() == b'162: Codesigning issue' else 'unknown'


def provenance_value(value, pattern):
    try:
        text = value.decode('ascii').strip()
    except (UnicodeError, AttributeError):
        return 'unknown'
    return text if len(text) <= 32 and re.fullmatch(pattern, text) else 'unknown'


def host_diagnostics():
    def capture(command):
        try:
            return subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  timeout=10, check=False)
        except Exception:
            return None
    provenance = {}
    for argument, field, pattern in (
        ('-productVersion', 'productVersion', r'[0-9]+(?:\.[0-9]+)*'),
        ('-buildVersion', 'buildVersion', r'[A-Za-z0-9]+'),
    ):
        result = capture(['/usr/bin/sw_vers', argument])
        provenance[field] = (provenance_value(result.stdout, pattern)
                             if result is not None and result.returncode == 0 and not result.stderr.strip()
                             else 'unknown')
    decoded = capture(['/bin/launchctl', 'error', 'posix', '162'])
    return {
        'hostProvenance': provenance,
        'code162Description': classify_posix162(decoded.stdout, decoded.stderr) if decoded is not None else 'unknown',
        'code162ReturnCode': decoded.returncode if decoded is not None else None,
    }


def record_stage(receipt, name, operation):
    try:
        result = operation()
        receipt[name] = {'status': 'parsed', **result}
        return True
    except SafeFailure as error:
        category, fields = error.category, error.fields
    except FileNotFoundError:
        category, fields = 'missing', {}
    except OSError:
        category, fields = 'io', {}
    except Exception:
        category, fields = 'unexpected', {}
    receipt[name] = {'status': 'failed', 'category': category, **fields}
    receipt.setdefault('failureStage', name)
    receipt.setdefault('failureCategory', category)
    return False


def create_receipt(args):
    # Hosted OS diagnostics remain useful even when the build produced no app.
    # An unavailable decoder is reported as unknown and does not fail signing.
    receipt = {'schemaVersion': 1, 'verified': False, **host_diagnostics()}
    if args.source_sha is not None:
        if not re.fullmatch(r'[a-fA-F0-9]{40}', args.source_sha):
            receipt.update(failureStage='arguments', failureCategory='invalid-arguments')
            return receipt
        receipt['sourceSha'] = args.source_sha.lower()
    stages = [
        record_stage(receipt, 'app', lambda: inspect_app(args.app)),
        record_stage(receipt, 'buildSettings', lambda: summarize_build_settings(read_bounded(args.build_settings, MAX_SETTINGS_BYTES))),
        record_stage(receipt, 'generatedEntitlements', lambda: generated_entitlements(args.derived_data)),
        record_stage(receipt, 'machO', lambda: summarize_macho(read_bounded(args.app / TARGET, MAX_EXECUTABLE_BYTES))),
        record_stage(receipt, 'codesign', lambda: verify_codesign(args.app)),
    ]
    receipt['verified'] = all(stages)
    return receipt


def self_test():
    secret = 'PRIVATE_VALUE_MUST_NEVER_ESCAPE'
    private_key = 'PRIVATE_KEY_MUST_NEVER_ESCAPE'
    entitlement_data = plistlib.dumps({
        'application-identifier': secret + '.' + APP_ID,
        'com.apple.application-identifier': APP_ID,
        'keychain-access-groups': [secret, APP_ID], 'get-task-allow': False,
        'com.apple.developer.team-identifier': secret, private_key: secret,
    })
    summary = summarize_entitlements(entitlement_data)
    assert all(summary['present'].values()) and summary['getTaskAllow'] is False
    assert summary['applicationIdentifierMatchesApp'] and summary['appleApplicationIdentifierMatchesApp']
    assert summary['keychainGroupMatchesApp']
    assert secret not in json.dumps(summary) and private_key not in json.dumps(summary)
    empty = summarize_entitlements(plistlib.dumps({private_key: secret, 'get-task-allow': secret}))
    assert empty['getTaskAllow'] is None and not empty['keychainGroupMatchesApp']
    assert not empty['applicationIdentifierMatchesApp']
    settings = summarize_build_settings(json.dumps([{'target': TARGET, 'buildSettings': {
        'CODE_SIGNING_ALLOWED': 'YES', 'CODE_SIGNING_REQUIRED': 'NO',
        'CODE_SIGN_IDENTITY': '-', 'EXPANDED_CODE_SIGN_IDENTITY': secret,
        'DEVELOPMENT_TEAM': '', private_key: secret,
    }}]).encode())
    assert settings == {'codeSigningAllowed': 'yes', 'codeSigningRequired': 'no',
                        'codeSigningIdentity': 'local-ad-hoc', 'expandedCodeSigningIdentity': 'other',
                        'developmentTeamSet': False}
    for value in (secret, {'value': secret}, [secret], 1, True):
        assert setting_enum(value) == 'other' and identity_enum(value) == 'other'
    assert setting_enum(None) == 'unset' and identity_enum('') == 'unset'
    assert identity_enum('Sign to Run Locally') == 'local-ad-hoc'
    invalid_settings = [secret.encode(), b'{}', b'[]', b'[{"target":"Pods"}]',
                        b'[{"target":"HappyHerd","buildSettings":[]}]',
                        b'[{"target":"HappyHerd","buildSettings":{}},{"target":"HappyHerd","buildSettings":{}}]']
    for payload in invalid_settings:
        try:
            summarize_build_settings(payload)
        except SafeFailure:
            pass
        else:
            raise AssertionError('Malformed or ambiguous build settings accepted')
    assert classify_posix162(b'162: Codesigning issue\n', b'') == 'codesigning-issue'
    assert classify_posix162(b'', b'162: Codesigning issue\n') == 'codesigning-issue'
    assert classify_posix162(b'162: Codesigning issue\n', secret.encode()) == 'unknown'
    assert classify_posix162(secret.encode(), b'') == 'unknown'
    assert provenance_value(b'27.0\n', r'[0-9]+(?:\.[0-9]+)*') == '27.0'
    assert provenance_value(b'26A999\n', r'[A-Za-z0-9]+') == '26A999'
    assert provenance_value(secret.encode(), r'[A-Za-z0-9]+') == 'unknown'
    assert provenance_value(b'27.0\n' + secret.encode(), r'[0-9]+(?:\.[0-9]+)*') == 'unknown'

    def blob(magic, payload):
        return struct.pack('>II', magic, 8 + len(payload)) + payload

    identifier = secret.encode() + b'\0'
    hash_offset = 44 + len(identifier)
    directory = struct.pack('>9I4BI', 0xfade0c02, hash_offset + 32, 0x20001, 2,
                            hash_offset, 44, 0, 1, 48, 32, 2, 0, 12, 0) + identifier + bytes(32)

    def executable(slots):
        indexes, children, offset = [], [], 12 + 8 * len(slots)
        for slot, content in slots:
            indexes.append(struct.pack('>II', slot, offset))
            children.append(content)
            offset += len(content)
        signature = struct.pack('>III', 0xfade0cc0, offset, len(slots)) + b''.join(indexes + children)
        return (struct.pack('<8I', 0xfeedfacf, 0x100000c, 0, 2, 1, 16, 0, 0)
                + struct.pack('<4I', 0x1d, 16, 48, len(signature)) + signature)

    valid = executable([(0, directory), (5, blob(0xfade7171, entitlement_data)),
                        (7, blob(0xfade7172, b'\x30\x01\x00'))])
    parsed = summarize_macho(valid)
    assert parsed['executableSha256'] == hashlib.sha256(valid).hexdigest()
    assert parsed['codeDirectoryFlags'] == 2 and parsed['xmlEntitlementsPresent'] and parsed['derEntitlementsPresent']
    assert parsed['xmlEntitlements'] == summary and secret not in json.dumps(parsed)
    bare = summarize_macho(executable([(0, directory)]))
    assert not bare['xmlEntitlementsPresent'] and not bare['derEntitlementsPresent'] and bare['xmlEntitlements'] is None
    invalid = [b'', valid[:31], valid[:-1], executable([(0, directory), (0, directory)]),
               executable([(0, directory), (5, blob(0xfade7172, entitlement_data))]),
               executable([(0, directory), (5, blob(0xfade7171, secret.encode()))]),
               executable([(0, blob(0xfade0c02, bytes(4)))]),
               executable([(0, directory), (7, blob(0xfade7171, b''))])]
    for offset, packing, value in ((16, '<I', 16385), (20, '<I', 0xffffffff),
                                    (40, '<I', 0xffffffff), (56, '>I', 65),
                                    (64, '>I', 0), (64, '>I', len(valid)),
                                    (72, '>I', 36), (88, '>I', 0xffffffff)):
        changed = bytearray(valid)
        struct.pack_into(packing, changed, offset, value)
        invalid.append(bytes(changed))
    for data in invalid:
        try:
            summarize_macho(data)
        except SafeFailure:
            pass
        else:
            raise AssertionError('Malformed Mach-O accepted')
    failed = {}
    def private_failure():
        raise ValueError(secret)
    assert not record_stage(failed, 'machO', private_failure)
    assert failed['failureCategory'] == 'unexpected' and secret not in json.dumps(failed)


class SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        raise SafeFailure('invalid-arguments')


def main():
    parser = SafeArgumentParser(description=__doc__)
    for name in ('app', 'derived-data', 'build-settings', 'receipt'):
        parser.add_argument('--' + name, type=Path)
    parser.add_argument('--source-sha')
    parser.add_argument('--self-test', action='store_true')
    try:
        args = parser.parse_args()
        if args.self_test:
            self_test()
            print('native-signing-receipt self-test: passed')
            return 0
        require(all(getattr(args, name) is not None for name in
                    ('app', 'derived_data', 'build_settings', 'receipt')), 'invalid-arguments')
        receipt = create_receipt(args)
        args.receipt.parent.mkdir(parents=True, exist_ok=True)
        # Every hosted attempt gets a fresh receipt; never replace prior proof.
        descriptor = os.open(args.receipt, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            json.dump(receipt, stream, indent=2)
            stream.write('\n')
        return 0 if receipt['verified'] else 1
    except Exception:
        # Argument, I/O and self-test errors must not print tracebacks or values.
        sys.stderr.write('Native signing receipt failed.\n')
        return 1


if __name__ == '__main__':
    sys.exit(main())
