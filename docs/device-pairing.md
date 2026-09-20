# Connect an existing account device

Device codes identify a running HappyHerd daemon that already belongs to the
account and server open in the controller. They do not log a machine into a new
account, transfer ownership, or replace its credentials. Authenticate a new
machine through the existing terminal authentication flow first.

## Connect from Web or Mac

1. Leave the installed daemons running on the controller and target machines.
2. On the target, run `happyherd machine pair`. This prints an eight-digit code,
   its expiration time, the existing target identity, and its server.
3. In the Web or Mac app, open **Settings → Connections → Add device**. Use the
   same account and server as the target.
4. Type or paste the code, check the target identity, and connect.
5. Use the selected machine through the ordinary New Session and Workspace
   surfaces. The target's existing machine ID and files remain unchanged.

The headless form is `happyherd machine pair --json`. To cancel the current
code, run `happyherd machine pair cancel`; `--json` is also supported. These
commands require an already running, updated daemon. They do not start a
daemon, install software, request SSH credentials, or reauthenticate.

Codes last two minutes, expire when their daemon exits, and are replaced by a
new `pair` command. Confirmation consumes the code. Generate another code
when the previous one has expired, been cancelled, or been used. A failed
network acknowledgement can be retried from the same confirmation screen.

Connections rechecks daemon identity before reporting a connected target.
Refreshing or reopening the app retains the account's existing machine records
and the normal new-session selection. It does not need to retain the PIN or
create another machine record. An offline device remains an account device;
its presence in the list does not prove that the daemon can currently respond.

If no target can be verified, check its daemon, server, account, and code, then
retry. An unreachable target cannot be distinguished from a target on another
server or account by disclosing another account's machine information.

## Existing transport and identity boundaries

The controller reads the existing account machine catalog and sends encrypted
machine RPCs to daemons advertising device-code support. A read-only code check
identifies candidates. Only an unambiguous candidate can be confirmed, and the
confirmation response must identify the exact selected machine. The daemon
owns code generation, expiration, cancellation, and consumption.

The browser remains a controller. Its RPCs travel through the existing server
relay to the target daemon; it does not discover an arbitrary local daemon or
silently establish a new browser-to-loopback bridge. The Mac app uses its
existing Tauri Web host and the same account transport.

The code is not an authentication credential: every remote call already
requires the account's existing authentication and machine encryption keys.
Possessing the numeric code alone cannot grant access. Consequently this flow
does not introduce a separate public code lookup, credential exchange,
cross-account sharing mechanism, or PIN attempt-based account lockout.

Confirmation retries retain one request ID. A daemon that already committed
that exact confirmation can return its receipt again after an acknowledgement
was lost; a different request cannot reuse the consumed code. Code changes and
cancelled UI attempts invalidate late asynchronous UI results.

## Verification contract

Web desktop, Web mobile, and the native Mac app are separate acceptance
surfaces. Each must show the visible Connections entry, code input, target
identity, successful confirmation, and retained selection after refresh or
reopen. Exercise an ordinary session with a harmless identity command and
browse a known target file through the selected machine.

Also cover malformed, unknown, expired, used and cancelled codes, ambiguous
matches, offline targets, transport failure, and mismatched server/account
configuration. Check that machine IDs, credentials, encryption material and
active session IDs are unchanged. Browser fixtures, builds and same-host
daemon tests support this evidence but do not replace the separate native Mac
and two-machine journeys.
