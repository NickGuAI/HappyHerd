#!/usr/bin/env python3
"""Classify private launch evidence without returning any input text.

The caller owns app/simulator scoping, collection bounds and source provenance.
This module performs no I/O. Results describe observed failure evidence, not a
proven root cause: e.g. a launch rejection can wrap a process crash.
"""
import re


MAX_MESSAGES = 512
MAX_MESSAGE_CHARS = 1024 * 1024
MAX_TOTAL_CHARS = 4 * 1024 * 1024
MAX_ERROR_CODES = 32
MAX_ABS_ERROR_CODE = 65535

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
        r'\b(?:code )?signature (?:is |was )?(?:invalid|not valid|missing)\b',
        r'\bcode sign(?:ature|ing) (?:validation |verification )?failed\b',
        r'\blibrary validation (?:failed|failure)\b',
        r'\bnot valid for use in process(?: using Library Validation)?\b',
        r'\bcode signature in [^\n]{1,180}\bnot valid for use in process\b',
    ),
    'entitlement-invalid': (
        r'\b(?:invalid|missing|unsatisfied) entitlements?\b',
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
_ERROR_CODE_PATTERNS = tuple(re.compile(pattern) for pattern in (
    r'(?<![\w./:@-])(?:Error\s+)?Domain\s*[=:]\s*["\']?' + _DOMAIN
    + r'["\']?\s*[,;]?\s*Code\s*[=:]\s*' + _CODE,
    r'(?<![\w./:@-])' + _DOMAIN + r'\s+error\s+' + _CODE,
    r'(?<![\w./:@-])' + _DOMAIN + r'\s*[,;:]?\s+[Cc]ode\s*[=:]?\s*' + _CODE,
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
    signals, exceptions, terminations = set(), set(), set()
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
        for pattern in _ERROR_CODE_PATTERNS:
            for match in pattern.finditer(message):
                code = int(match['code'])
                if abs(code) <= MAX_ABS_ERROR_CODE and len(codes) < MAX_ERROR_CODES:
                    domain = next(name for name in ERROR_DOMAINS if name == match['domain'])
                    codes.add((domain, code))
    return {
        'categories': [name for name in CATEGORY_ORDER if name in categories] or ['unknown'],
        'subtypes': [name for name in SUBTYPE_ORDER if name in subtypes],
        'errorCodes': [{'domain': domain, 'code': code} for domain, code in sorted(codes)],
        'signals': [name for name in SIGNALS if name in signals],
        'exceptionTypes': [name for name in EXCEPTIONS if name in exceptions],
        'terminationReasons': [name for name in TERMINATION_PATTERNS if name in terminations],
    }
