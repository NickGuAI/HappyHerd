# HappyHerd issuer protocol v1

HappyHerd connects to an organization only through public, organization-neutral
issuer metadata. Core code has no built-in issuer, provider route, scope, or
Skill name.

```text
happyherd connect https://issuer.example
       │
       ├─ GET /.well-known/happyherd.json
       ├─ generate Ed25519 key + PKCE S256 verifier
       ├─ POST device authorization (ten-minute maximum)
       ├─ open verificationUri?request=<non-secret-request-id>
       └─ POST one-time token redemption
                │
                ├─ credential → OS secret store only
                └─ bundle descriptor → verified install-skills download
```

For onboarding automation, use
`happyherd connect https://issuer.example --no-open --json`. The NDJSON stream
emits this approval record before it begins waiting:

```json
{"schemaVersion":1,"type":"approval","message":"Approve this device","verificationUri":"https://issuer.example/agent-toolkit?request=...","userCode":"ABCD-EFGH"}
```

It ends with a secret-free receipt containing `issuer`, `expiresAt`, `scopes`,
and `skillBundleAvailable`. Neither record contains the device secret or bearer
credential.

## Discovery

`GET https://issuer.example/.well-known/happyherd.json` returns exactly:

```json
{
  "schemaVersion": 1,
  "issuer": "https://issuer.example",
  "displayName": "Example Organization",
  "deviceAuthorizationEndpoint": "https://issuer.example/api/agent-toolkit/device-authorizations",
  "tokenEndpoint": "https://issuer.example/api/agent-toolkit/device-authorizations/token",
  "verificationUri": "https://issuer.example/agent-toolkit"
}
```

Protocol v1 requires the requested issuer to be a clean HTTPS origin. HTTP is
allowed only for loopback development. Every discovered endpoint must be an
absolute same-origin URL without user information, query, or fragment. The
discovered `issuer` must equal the requested origin.

## Device authorization

The launcher generates a fresh Ed25519 key pair and an RFC 7636 verifier. It
posts:

```json
{
  "protocolVersion": 1,
  "client": { "name": "HappyHerd", "version": "1.2.1-beta.1" },
  "device": {
    "platform": "darwin",
    "architecture": "arm64",
    "publicKey": "BASE64URL_ED25519_SPKI"
  },
  "pkce": { "codeChallenge": "BASE64URL_SHA256", "method": "S256" }
}
```

The issuer answers `201`:

```json
{
  "requestId": "123e4567-e89b-42d3-a456-426614174000",
  "deviceSecret": "high-entropy-secret",
  "userCode": "ABCD-EFGH",
  "verificationUri": "https://issuer.example/agent-toolkit",
  "expiresIn": 600,
  "interval": 5
}
```

`expiresIn` cannot exceed 600 seconds. Protocol v1 requires `userCode` to match
`^[A-Z0-9]{4}-[A-Z0-9]{4}$`; this exact shape is validated before the launcher
shows an approval event. Only the UUID `requestId` enters the browser URL.
The device secret, PKCE verifier, and private key stay in launcher memory.
Windows uses a direct platform URL handler; the discovered URL is not routed
through a command shell.

## One-time redemption

The launcher posts:

```json
{
  "protocolVersion": 1,
  "requestId": "123e4567-e89b-42d3-a456-426614174000",
  "deviceSecret": "high-entropy-secret",
  "codeVerifier": "PKCE_VERIFIER",
  "deviceProof": "BASE64URL_ED25519_SIGNATURE"
}
```

The signed UTF-8 bytes are:

```text
happyherd-device-token-v1\n
<requestId>\n
<base64url(sha256(deviceSecret))>\n
<base64url(sha256(codeVerifier))>
```

While approval is pending, the issuer returns HTTP `400` with one of
`authorization_pending`, `slow_down`, `access_denied`, `expired_token`, or
`invalid_grant`, using the standard snake-case description field:

```json
{
  "error": "authorization_pending",
  "error_description": "Approval is still pending"
}
```

A successful request returns once and invalidates the grant:

```json
{
  "tokenType": "Bearer",
  "accessToken": "LONG_LIVED_SECRET",
  "expiresAt": "2027-02-13T00:00:00Z",
  "scopes": ["records.read"],
  "skillBundle": {
    "url": "https://issuer.example/api/skill-bundles/current",
    "sha256": "64_HEX_ZIP_DIGEST",
    "manifestSha256": "64_HEX_RAW_MANIFEST_DIGEST"
  }
}
```

The issuer omits `skillBundle` when distribution is paused; the redeemed token
is still stored and is not polled a second time. When distribution is active,
the bundle URL must be same-origin and contain no query, fragment, or
credential. `install-skills` sends the access token only as
`Authorization: Bearer ...`, disables redirects, and requests
`Accept: application/zip`.

## Secret and bundle boundaries

The credential is written through the operating-system credential API:
Keychain on macOS, Credential Manager on Windows, or Secret Service on Linux.
The device private key is never persisted. If the credential API is
unavailable, connection fails. There is no plaintext file fallback.

Before publishing a Skill bundle directory, the launcher verifies, in order:

1. the external ZIP SHA-256;
2. the SHA-256 of the raw embedded root `manifest.json`;
3. the generic v1 manifest schema and minimum HappyHerd version;
4. every declared file path, size, mode, and SHA-256;
5. the canonical `artifact.contentSha256` over path-sorted `files[]` records;
6. absence of traversal, symlinks, duplicates, normalization/case collisions,
   undeclared entries, and oversized expansion.

The verified version directory is renamed into place only after all checks
pass. The Skill allowlist comes from `artifact.skills`; core code never assumes
an organization-specific bundle. Each declared Skill is then copied atomically
to both `~/.claude/skills/<name>` and `~/.codex/skills/<name>`. A provider target
is replaceable only when it carries a matching HappyHerd ownership receipt.

The managed registry contains bundle provenance and provider paths, never a
credential. Before `launch` or `run-tool`, HappyHerd re-verifies the current
bundle receipt, manifest, file hashes and modes, plus both provider copies.
`run-tool` accepts only a manifest-declared relative script. Python and Node
scripts use their bounded runtimes; another file must be declared executable.
The trusted child receives `HAPPYHERD_ACCESS_TOKEN`, the public issuer, and the
manifest's same-origin API base. The agent session and command arguments do not.
