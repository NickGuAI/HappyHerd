#!/usr/bin/env python3
"""Classify private launch evidence without returning any input text.

The caller owns app/simulator scoping, collection bounds and source provenance.
This module performs no I/O. Results describe observed failure evidence, not a
proven root cause: e.g. a launch rejection can wrap a process crash.
"""
from datetime import datetime
import hashlib
import json
from pathlib import PurePosixPath
import re


MAX_MESSAGES = 512
MAX_MESSAGE_CHARS = 1024 * 1024
MAX_TOTAL_CHARS = 4 * 1024 * 1024
MAX_ERROR_CODES = 32
MAX_ABS_ERROR_CODE = 65535
MAX_CRASH_REPORT_BYTES = 2 * 1024 * 1024


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError()
        result[key] = value
    return result


def _invalid_constant(_):
    raise ValueError()


def _identity_rejection(data, header, body, app_id, installed_executable, simulator_udid, gate):
    """Describe unchanged identity checks without returning any candidate value."""
    bundle = body.get('bundleInfo')
    bundle_object = isinstance(bundle, dict)
    expected = PurePosixPath(installed_executable).parts
    expected_owned = expected.count(simulator_udid) == 1
    suffix = expected[expected.index(simulator_udid):] if expected_owned else ()
    process_path = body.get('procPath')
    parts = PurePosixPath(process_path).parts if isinstance(process_path, str) else ()
    coalition = body.get('coalitionName')
    coalition_matches = coalition == 'com.apple.CoreSimulator.SimDevice.' + simulator_udid
    if process_path is None:
        placeholder = 'absent'
    elif not isinstance(process_path, str):
        placeholder = 'non-string'
    elif process_path == '':
        placeholder = 'empty'
    elif process_path in ('<redacted>', '<private>'):
        placeholder = 'whole-redacted'
    elif any(part.startswith('<') and part.endswith('>') for part in parts):
        placeholder = 'angle-component'
    elif '*' in parts:
        placeholder = 'wildcard-component'
    elif '...' in parts:
        placeholder = 'ellipsis-component'
    elif 'USER' in parts:
        placeholder = 'user-component'
    else:
        placeholder = 'none'
    return {
        'status': 'identity-mismatch', 'rejectionGate': gate,
        'sourceSha256': hashlib.sha256(data).hexdigest(),
        'identityChecks': {
            'headerBundlePresent': 'bundleID' in header,
            'headerBundleString': isinstance(header.get('bundleID'), str),
            'headerBundleMatches': header.get('bundleID') == app_id,
            'bodyBundlePresent': 'bundleInfo' in body, 'bodyBundleObject': bundle_object,
            'bodyBundleIdentifierPresent': bundle_object and 'CFBundleIdentifier' in bundle,
            'bodyBundleIdentifierString': bundle_object and isinstance(bundle.get('CFBundleIdentifier'), str),
            'bodyBundleIdentifierMatches': bundle_object and bundle.get('CFBundleIdentifier') == app_id,
            'processNamePresent': 'procName' in body,
            'processNameString': isinstance(body.get('procName'), str),
            'processNameMatches': body.get('procName') == PurePosixPath(installed_executable).name,
            'expectedPathHasSingleOwnedUuid': expected_owned,
            'processPathPresent': 'procPath' in body, 'processPathString': isinstance(process_path, str),
            'installedPathSuffixMatches': bool(suffix) and '..' not in parts and parts[-len(suffix):] == suffix,
            'installedPathSuffixCaseInsensitiveMatches': bool(suffix) and '..' not in parts
                and tuple(part.casefold() for part in parts[-len(suffix):]) == tuple(part.casefold() for part in suffix),
            'ownedSimulatorComponentMatches': simulator_udid in parts,
            'ownedSimulatorComponentCaseInsensitiveMatches': any(part.casefold() == simulator_udid.casefold() for part in parts),
            'appLeafMatches': len(parts) >= 2 and len(expected) >= 2 and parts[-2] == expected[-2],
            'executableLeafMatches': bool(parts) and bool(expected) and parts[-1] == expected[-1],
            'pathContainsParentTraversal': '..' in parts, 'pathPlaceholderShape': placeholder,
            'coalitionPresent': 'coalitionName' in body, 'coalitionString': isinstance(coalition, str),
            'coalitionMatches': coalition_matches,
            'coalitionCaseInsensitiveMatches': isinstance(coalition, str)
                and coalition.casefold() == ('com.apple.CoreSimulator.SimDevice.' + simulator_udid).casefold(),
            'coalitionConflicts': isinstance(coalition, str)
                and coalition.startswith('com.apple.CoreSimulator.SimDevice.') and not coalition_matches,
        },
    }


def classify_owned_crash_report(data, *, app_id, installed_executable, simulator_udid, since, until):
    """Read Apple's two-object IPS format; return no input strings or paths.

    Identity and capture time are mandatory before any crash classification.
    procPath may redact the user's home, so compare the complete installed path
    suffix starting with this owned simulator's UUID, including its app-container
    UUID. An exact simulator coalition can establish scope if that path is absent
    or wholly redacted. Neither filename nor bundle identity alone establishes scope.
    https://developer.apple.com/documentation/xcode/interpreting-the-json-format-of-a-crash-report
    """
    if not isinstance(data, bytes) or len(data) > MAX_CRASH_REPORT_BYTES:
        return {'status': 'oversized'}
    try:
        decoder = json.JSONDecoder(object_pairs_hook=_unique_object, parse_constant=_invalid_constant)
        text = data.decode('utf-8').lstrip()
        header, offset = decoder.raw_decode(text)
        body_text = text[offset:].lstrip()
        body, offset = decoder.raw_decode(body_text)
        if body_text[offset:].strip() or not isinstance(header, dict) or not isinstance(body, dict):
            raise ValueError()
    except (ValueError, UnicodeError, RecursionError):
        return {'status': 'malformed'}
    if header.get('bug_type') != '309':
        return {'status': 'unsupported-report'}
    bundle = body.get('bundleInfo')
    if (not isinstance(bundle, dict) or bundle.get('CFBundleIdentifier') != app_id
            or ('bundleID' in header and header['bundleID'] != app_id)
            or body.get('procName') != PurePosixPath(installed_executable).name):
        gate = ('body-bundle-object' if not isinstance(bundle, dict)
                else 'body-bundle-identifier' if bundle.get('CFBundleIdentifier') != app_id
                else 'header-bundle-identifier' if 'bundleID' in header and header['bundleID'] != app_id
                else 'process-name')
        return _identity_rejection(data, header, body, app_id, installed_executable, simulator_udid, gate)
    expected = PurePosixPath(installed_executable).parts
    if expected.count(simulator_udid) != 1:
        return _identity_rejection(data, header, body, app_id, installed_executable,
                                   simulator_udid, 'expected-owned-path')
    suffix = expected[expected.index(simulator_udid):]
    process_path = body.get('procPath')
    process_parts = PurePosixPath(process_path).parts if isinstance(process_path, str) else ()
    path_matches = '..' not in process_parts and process_parts[-len(suffix):] == suffix
    coalition = body.get('coalitionName')
    coalition_matches = coalition == 'com.apple.CoreSimulator.SimDevice.' + simulator_udid
    # A conflicting simulator UUID must not be rescued by another matching field.
    other_coalition = (isinstance(coalition, str)
                       and coalition.startswith('com.apple.CoreSimulator.SimDevice.') and not coalition_matches)
    path_unavailable = process_path is None or process_path in ('', '<redacted>', '<private>')
    if not (path_matches or (coalition_matches and path_unavailable)) or other_coalition:
        return _identity_rejection(data, header, body, app_id, installed_executable, simulator_udid,
                                   'simulator-coalition-conflict' if other_coalition else 'installed-path-scope')
    try:
        captured = body.get('captureTime')
        if not isinstance(captured, str) or len(captured) > 64:
            raise ValueError()
        for pattern in ('%Y-%m-%d %H:%M:%S.%f %z', '%Y-%m-%d %H:%M:%S %z',
                        '%Y-%m-%dT%H:%M:%S.%f%z', '%Y-%m-%dT%H:%M:%S%z'):
            try:
                timestamp = datetime.strptime(captured, pattern)
                break
            except ValueError:
                continue
        else:
            raise ValueError()
        if timestamp.tzinfo is None or not since <= timestamp.timestamp() <= until:
            raise ValueError()
    except (ValueError, OverflowError, OSError):
        return {'status': 'time-mismatch'}

    exception = body.get('exception') if isinstance(body.get('exception'), dict) else {}
    termination = body.get('termination') if isinstance(body.get('termination'), dict) else {}
    safe_exception = {key: exception[key] for key, values in (('type', EXCEPTIONS), ('signal', SIGNALS))
                      if exception.get(key) in values}
    namespaces = ('SIGNAL', 'CODESIGNING', 'DYLD', 'WATCHDOG', 'RUNNINGBOARD', 'FRONTBOARD', 'JETSAM', 'LIBSYSTEM')
    namespace = termination.get('namespace')
    safe_termination = {'namespace': namespace} if namespace in namespaces else {}
    code = termination.get('code')
    if type(code) is int and 0 <= code <= 0xffffffff:
        safe_termination['code'] = code
    classification = classify_launch_messages([json.dumps({
        'exception': safe_exception, 'termination': safe_termination,
    })])

    frames = []
    frame_limit_reached = False
    backtrace = body.get('lastExceptionBacktrace')
    if isinstance(backtrace, list):
        frames.extend(backtrace[:64])
        frame_limit_reached = len(backtrace) > 64
    threads = body.get('threads')
    faulting = body.get('faultingThread')
    if isinstance(threads, list):
        frame_limit_reached = frame_limit_reached or len(threads) > 128
        for index, thread in enumerate(threads[:128]):
            if isinstance(thread, dict) and (thread.get('triggered') is True or
                                            (type(faulting) is int and index == faulting)):
                if isinstance(thread.get('frames'), list):
                    frames.extend(thread['frames'][:64])
                    frame_limit_reached = frame_limit_reached or len(thread['frames']) > 64
                break
    tags = set()
    symbolized_frames = 0
    for frame in frames:
        symbol = frame.get('symbol') if isinstance(frame, dict) else None
        if not isinstance(symbol, str) or len(symbol) > 1024:
            continue
        symbolized_frames += 1
        # Source-owned React Native / Expo symbol names, never arbitrary symbols.
        if symbol in ('RCTFatal', 'RCTFatalException'):
            tags.add('react-fatal')
        if symbol.startswith('-[RCTExceptionsManager reportFatalException:'):
            tags.add('react-js-fatal')
        if symbol in ('RCTTriggerReloadCommandListeners', '-[RCTHost didReceiveReloadCommand]',
                      '-[RCTHost _reloadWithShouldRestartSurfaces:]'):
            tags.add('react-reload')
        if re.search(r'\bRecreateReactContextProcedure\.run\(procedureContext:\)', symbol):
            tags.add('expo-updates-reload')
    return {
        'status': 'matched', 'sourceSha256': hashlib.sha256(data).hexdigest(),
        'bundleIdentifierMatched': True, 'installedProcessPathMatched': path_matches,
        'simulatorCoalitionMatched': coalition_matches, 'capturedDuringJourney': True,
        'classification': classification, 'termination': safe_termination,
        'faultingOrExceptionBacktraceTags': sorted(tags),
        'framesInspected': len(frames), 'symbolizedFramesInspected': symbolized_frames,
        'frameInspectionTruncated': frame_limit_reached,
    }

# Emit the constants below, never a domain or enum copied from input.
ERROR_DOMAINS = (
    'FBSOpenApplicationServiceErrorDomain', 'FBSOpenApplicationErrorDomain',
    'FBProcessExit', 'RBSRequestErrorDomain', 'RBSServiceErrorDomain',
    'XCTestErrorDomain', 'com.apple.dt.xctest.error',
    'com.apple.CoreSimulator.SimError', 'com.apple.CoreSimulator.SimErrorDomain',
    'NSPOSIXErrorDomain', 'NSCocoaErrorDomain', 'NSOSStatusErrorDomain',
    'IXErrorDomain', 'MIInstallerErrorDomain',
    'DVTDeviceProcessControlServiceErrorDomain',
)
SERVICE_REASONS = ('Security', 'Busy', 'NotFound', 'RequestDenied', 'InvalidRequest',
                   'InvalidArguments', 'ProcessExited', 'Timeout', 'Unspecified')
CATEGORY_ORDER = ('launch-rejected', 'launch-timed-out', 'process-exited-or-crashed')
SUBTYPE_ORDER = (
    'signature-invalid', 'entitlement-invalid', 'launch-denied',
    'debugger-attach-failed', 'executable-missing', 'process-crash', 'timeout',
)
SIGNALS = ('SIGABRT', 'SIGBUS', 'SIGFPE', 'SIGILL', 'SIGKILL', 'SIGSEGV',
           'SIGSYS', 'SIGTERM', 'SIGTRAP')
EXCEPTIONS = (
    'EXC_BAD_ACCESS', 'EXC_BAD_INSTRUCTION', 'EXC_ARITHMETIC', 'EXC_EMULATION',
    'EXC_SOFTWARE', 'EXC_BREAKPOINT', 'EXC_CRASH', 'EXC_RESOURCE', 'EXC_GUARD',
    'EXC_CORPSE_NOTIFY',
)
TERMINATION_PATTERNS = {
    'code-signing': r'\b(?:Termination Reason\s*:\s*)?Namespace\s+CODESIGNING\b|'
                    r'"namespace"\s*:\s*"CODESIGNING"',
    'dynamic-linker': r'\b(?:Termination Reason\s*:\s*)?Namespace\s+DYLD\b|'
                      r'"namespace"\s*:\s*"DYLD"',
    'watchdog': r'\bwatchdog (?:transgression|termination)\b|'
                r'\bTermination Reason\s*:[^\n]{0,180}\b0x8badf00d\b',
    'memory-pressure': r'\bTermination Reason\s*:[^\n]{0,180}\b(?:JETSAM|memorystatus)\b|'
                       r'"namespace"\s*:\s*"JETSAM"',
}

REJECTION_PATTERNS = (
    r'\b(?:failed|unable) to (?:launch|activate)\b',
    r'\b(?:could not|cannot|can\'t) (?:launch|activate) (?:the )?(?:app|application|process)\b',
    r'\b(?:app|application|process) launch (?:failed|was rejected|was denied)\b',
    r'\brequest to open [^\n]{1,180}\bfailed\b',
    r'\bfailed to (?:get|obtain) (?:the )?application process\b',
)
TIMEOUT_PATTERNS = (
    r'\b(?:launch|launching|activation) (?:request )?(?:timed out|timeout)\b',
    r'\b(?:timed out|timeout) (?:while )?(?:waiting for |during )?'
    r'(?:the )?(?:app(?:lication)? |process )?(?:launch|activation|to launch)\b',
    r'\btimed out waiting for (?:the )?(?:app|application|process)\b[^\n]{0,100}'
    r'\b(?:to (?:start|become running|become foreground)|running state)\b',
)
CRASH_PATTERNS = (
    r'\b(?:process|application|app) (?:has |was )?(?:crashed|exited unexpectedly|terminated unexpectedly)\b',
    r'\b(?:process|application|app) [^\n]{1,100}\b(?:exited unexpectedly|crashed on launch)\b',
    r'\b(?:process|application|app) (?:exited|terminated) (?:with|due to|by)\b',
    r'\b(?:process|application|app) [^\n]{1,100}\bexited (?:with|due to)\b',
    r'\b(?:exited|terminated) before (?:the )?(?:launch|application launch)\b',
)
SUBTYPE_PATTERNS = {
    'signature-invalid': (
        r'\b(?:invalid|missing) (?:code )?signature\b',
        r'\b(?:invalid|untrusted) code ?sign(?:ing|ature)\b',
        r'\b(?:code )?signature (?:is |was )?(?:invalid|not valid|missing)\b',
        r'\bcode sign(?:ature|ing) (?:validation |verification )?failed\b',
        r'\blibrary validation (?:failed|failure)\b',
        r'\bnot valid for use in process(?: using Library Validation)?\b',
        r'\bcode signature in [^\n]{1,180}\bnot valid for use in process\b',
    ),
    'entitlement-invalid': (
        r'\b(?:invalid|missing|unsatisfied|inadequate) (?:code ?signing )?entitlements?\b',
        r'\bentitlements? (?:are |is |was |were )?(?:invalid|missing|not permitted)\b',
        r'\bdoes not have (?:the )?(?:required |necessary )?entitlement\b',
        r'\brequired entitlement (?:is missing|isn\'t present|not found)\b',
        r'\berrSecMissingEntitlement\b',
    ),
    'launch-denied': (
        r'\brequest (?:was )?denied by (?:the )?service delegate\b',
        r'\b(?:launch|launch request|application launch) (?:was |is )?(?:denied|rejected)\b',
        r'\bnot permitted to launch\b',
    ),
    'debugger-attach-failed': (
        r'\b(?:failed|unable) to attach (?:the )?debugger\b',
        r'\bdebugger (?:attach|attachment) (?:failed|was denied|denied)\b',
        r'\b(?:failed|unable) to get (?:the )?task for process\b',
        r'\btask_for_pid\b[^\n]{0,80}\b(?:failed|denied)\b',
    ),
    'executable-missing': (
        r'\b(?:executable|application bundle) (?:is |was )?(?:missing|not found)\b',
        r'\b(?:could not|cannot|failed to|unable to) find (?:the )?(?:application )?executable\b',
        r'\bno executable (?:was )?found\b',
    ),
}

# NSError's two usual renderings plus Apple's Domain/Code key-value form.
# No wildcard may span another error domain, so nested errors keep their codes.
_DOMAIN = '(?P<domain>' + '|'.join(re.escape(item) for item in ERROR_DOMAINS) + ')'
_CODE = r'(?P<code>[+-]?\d{1,5})(?!\w|\.\d)'
_ERROR_CODE_PATTERNS = tuple(re.compile(pattern, re.IGNORECASE) for pattern in (
    r'(?<![\w./:@-])(?:Error\s+)?Domain\s*[=:]\s*["\']?' + _DOMAIN
    + r'["\']?\s*[,;]?\s*Code\s*[=:]\s*' + _CODE,
    r'(?<![\w./:@-])' + _DOMAIN + r'\s+error\s+' + _CODE,
    r'(?<![\w./:@-])' + _DOMAIN + r'\s*[,;:]?\s+[Cc]ode\s*[=:]?\s*' + _CODE,
    r'(?<![\w./:@-])' + _DOMAIN + r'\s*:\s*' + _CODE,
))


def _matches(patterns, message):
    # Ignore explicit negation in nearby prose, such as "no application launch
    # timeout occurred". This is a classifier, not an arbitrary-log assertion.
    return any(
        not re.search(r'\b(?:no|not|without)\s+(?:\w+\s+){0,3}$',
                      message[max(0, match.start() - 64):match.start()], re.IGNORECASE)
        for pattern in patterns for match in re.finditer(pattern, message, re.IGNORECASE)
    )


def classify_launch_messages(messages):
    """Return only allowlisted enums/domains and bounded integer error codes.

    Inputs may be private XCTest failure messages/log excerpts, owned simulator
    eventMessage strings, or owned crash report text. Non-strings are ignored.
    Empty/unrecognized evidence explicitly returns ``unknown``. The caller must
    retain source availability/truncation separately; absence of a match cannot
    establish that launch succeeded or that a suspected cause is absent.
    """
    categories, subtypes, codes = set(), set(), set()
    signals, exceptions, terminations, reasons = set(), set(), set(), set()
    if isinstance(messages, str):
        messages = (messages,)
    remaining = MAX_TOTAL_CHARS
    for index, message in enumerate(messages):
        if index >= MAX_MESSAGES or remaining <= 0:
            break
        if not isinstance(message, str):
            continue
        message = message[:min(MAX_MESSAGE_CHARS, remaining)]
        remaining -= len(message)
        if _matches(REJECTION_PATTERNS, message):
            categories.add('launch-rejected')
        if _matches(TIMEOUT_PATTERNS, message):
            categories.add('launch-timed-out')
            subtypes.add('timeout')
        if _matches(CRASH_PATTERNS, message):
            categories.add('process-exited-or-crashed')
            if _matches((r'\b(?:process|application|app) (?:has )?crashed\b',
                         r'\bcrashed on launch\b'), message):
                subtypes.add('process-crash')
        for subtype, patterns in SUBTYPE_PATTERNS.items():
            if _matches(patterns, message):
                subtypes.add(subtype)
                # Entitlement errors may occur after launch (e.g. Keychain);
                # the subtype alone must not manufacture a launch rejection.
                if subtype in ('launch-denied', 'debugger-attach-failed', 'executable-missing'):
                    categories.add('launch-rejected')
        for name, pattern in TERMINATION_PATTERNS.items():
            if re.search(pattern, message, re.IGNORECASE):
                terminations.add(name)
                categories.add('process-exited-or-crashed')
        for name in EXCEPTIONS:
            if re.search(r'(?:Exception Type\s*:\s*|"type"\s*:\s*")'
                         + name + r'\b', message):
                exceptions.add(name)
                categories.add('process-exited-or-crashed')
                subtypes.add('process-crash')
        for name in SIGNALS:
            if re.search(r'(?:Exception Type\s*:[^\n]{0,80}\(|'
                         r'Termination Signal\s*:\s*|"signal"\s*:\s*"|'
                         r'(?:terminated|killed|exited) (?:by|with|due to) (?:signal )?)'
                         + name + r'\b', message, re.IGNORECASE):
                signals.add(name)
                categories.add('process-exited-or-crashed')
        for name in SERVICE_REASONS:
            if re.search(r'(?:BSErrorCodeDescription\s*[=:]\s*|for reason:\s*)[\"\']?'
                         + re.escape(name) + r'(?![\w.-])', message, re.IGNORECASE):
                reasons.add(name)
        for pattern in _ERROR_CODE_PATTERNS:
            for match in pattern.finditer(message):
                code = int(match['code'])
                if abs(code) <= MAX_ABS_ERROR_CODE and len(codes) < MAX_ERROR_CODES:
                    domain = next(name for name in ERROR_DOMAINS if name.casefold() == match['domain'].casefold())
                    codes.add((domain, code))
    return {
        'categories': [name for name in CATEGORY_ORDER if name in categories] or ['unknown'],
        'subtypes': [name for name in SUBTYPE_ORDER if name in subtypes],
        'errorCodes': [{'domain': domain, 'code': code} for domain, code in sorted(codes)],
        'signals': [name for name in SIGNALS if name in signals],
        'serviceReasons': [name for name in SERVICE_REASONS if name in reasons],
        'exceptionTypes': [name for name in EXCEPTIONS if name in exceptions],
        'terminationReasons': [name for name in TERMINATION_PATTERNS if name in terminations],
    }
