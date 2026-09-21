# Named credential pools and session-preserving rotation

Use this playbook when changing Claude, Codex, or Grok named-account selection,
quota attribution, credential activation/writeback, or same-session rotation.
Keep provider-native conversation state separate from account credentials: an
account swap changes authentication, not the HappyHerd session or its native
conversation identity.

## Contract

```text
account selection
  → activate selected credential
  → publish stable account ID + credential version in session metadata
  → provider reports a hard quota limit
  → daemon accepts or ignores the exact notice
  → accepted notice marks/selects account and resumes the same HappyHerd session
  → provider resumes its retained native conversation/state home
  → a later Human/heartbeat turn uses the replacement account
```

Rotation is reactive. It does not poll quota, inject a `continue` prompt, replay
work, retry an interrupted request, or own heartbeat scheduling. An accepted
limit notice means only that the daemon owns the incident; final switched,
exhausted, unchanged, or failed outcomes are separate evidence.

## Provider ownership matrix

| Provider | Credential source | Stable native identity | State home retained on resume | Rotation ownership |
|---|---|---|---|---|
| Claude | named OAuth token in the pool | `claudeSessionId` | provider-native session plus HappyHerd reconnect state | session metadata must carry display name, stable account ID, and credential version |
| Codex | registered auth read under the pool lock and supplied to the native ephemeral app-server store | `codexThreadId` | exact saved `CODEX_HOME` | native auth stays in memory; account ID/version guards reject stale processes |
| Grok | per-account stored `auth.json` copied to a credential ID/version-bound runtime file and passed as `GROK_AUTH_PATH` | `acpSessionId` | exact saved `GROK_HOME` | version-bound files prevent stale processes from writing back another account's auth |

Display names are labels, not ownership keys. Stable account ID plus credential
version owns quota attribution and auth-file writeback. Relogin increments the
version, so an older process cannot overwrite the replacement credential.

Managed Codex app-server authentication reads registered credentials from the native ephemeral store under the credential-pool lock without touching `CODEX_HOME/auth.json`, while managed Grok ACP authentication utilizes a credential ID and version-bound auth file in registered account storage with `GROK_AUTH_PATH` written to the child environment. Both preserve stable provider native state homes, whereas unmanaged providers retain ambient environment behavior, and stale processes are rejected by account ID and version guards. Codex and Grok activation and writeback are owned by `credentialPool/{codexAuth,grokAuth}.ts` following the removal of the obsolete runtime ownership module.

## Source owners

- selection, persistence, and account environment: `server/packages/happyherd-cli/src/credentialPool/store.ts`
- Codex/Grok activation and writeback: `credentialPool/{codexAuth,grokAuth}.ts`
- hard-limit reporting: `credentialPool/providerLimitNotice.ts`
- daemon acceptance and rotation: `daemon/{controlServer,run}.ts`
- Claude session metadata: `claude/runClaude.ts`
- common Codex/Grok metadata: `utils/createSessionMetadata.ts`
- terminal resume: `resume/handleResumeCommand.ts`
- Codex in-process reconnect: `codex/codexAppServerClient.ts`

## Diagnostics and verification

Prefer non-mutating evidence: inspect session metadata fields, credential-pool
summaries, provider state-home paths, daemon receipts, and test fixtures. Never
print `auth.json`, OAuth tokens, decrypted account secrets, or private session
content. Keep live provider smokes isolated and explicitly authorized.

Start with the focused matrix in `.dev/VERIFY.md`. Include stale/duplicate limit
notices, stable ID/version attribution, overlapping A/B auth activation and
writeback, Codex reconnect ownership, nondefault Grok home restoration, the
same provider-native conversation ID, and zero generated work prompts. Then run
the affected CLI/app checks and required exact-head CI. A separately initiated
turn may prove resumability; rotation itself must not manufacture that turn.

## Native verification boundary

The pool lock coordinates registered-credential reads and writes, while Codex
managed auth remains in the native app-server's ephemeral store and Grok native
refreshes use a version-bound file. Unmanaged provider processes retain their
ambient environment. Real multi-account refresh/reconnect behavior remains a
required isolated native acceptance check; filesystem and mocked-RPC tests alone
do not prove that boundary. Do not introduce a new credential framework or
relocate session history to conceal this limitation.
