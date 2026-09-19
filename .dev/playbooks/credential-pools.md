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
  → accepted notice marks/selects account and resumes the same Happy session
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
| Claude | named OAuth token in the pool | `claudeSessionId` | provider-native session plus Happy reconnect state | session metadata must carry display name, stable account ID, and credential version |
| Codex | per-account stored `auth.json`, activated into the retained `CODEX_HOME` | `codexThreadId` | exact saved `CODEX_HOME` | shared runtime auth is claimed by account ID/version; stale processes cannot write back or reconnect through another account's auth |
| Grok | per-account stored `auth.json`, activated into the retained `GROK_HOME` | `acpSessionId` | exact saved `GROK_HOME` | shared runtime auth is claimed by account ID/version; stale processes cannot write back another account's auth |

Display names are labels, not ownership keys. Stable account ID plus credential
version owns quota attribution and auth-file writeback. Relogin increments the
version, so an older process cannot overwrite the replacement credential.

Codex and Grok intentionally retain a shared provider state home so native
thread/session state remains available. Their runtime `auth.json` is therefore
a shared mutable slot. Activation and writeback reuse the pool’s existing process-local queue and
cross-process file-lock mechanism for that slot. Activation reads its source,
invalidates the old marker, atomically replaces auth, and only then publishes a
secret-free account-ID/version marker. A failed replacement cannot falsely claim
old auth for the new account. Writeback snapshots the matching source under the
slot lock and retains the store’s destination registration/version check. Codex
connection and in-process reconnect refuse a mismatched managed owner while
retaining the native thread ID for a later independently initiated resume. Do not copy one account's runtime auth
into another account record as a fallback.

## Source owners

- selection, persistence, and account environment: `server/packages/happy-cli/src/credentialPool/store.ts`
- Codex/Grok activation and writeback: `credentialPool/{codexAuth,grokAuth,runtimeAuthOwnership}.ts`
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

The slot lock coordinates HappyHerd-managed file operations, not arbitrary
provider-native or external processes that read or rewrite `auth.json` on their
own. The ownership check before Codex spawn is not atomic with the native
process’s later auth read. Real multi-account refresh/reconnect behavior therefore
remains a required isolated native acceptance check; filesystem and mocked-RPC
tests alone do not prove that boundary. Do not claim complete concurrent native
auth isolation from the sidecar, and do not introduce a new credential framework
or relocate session history to conceal this limitation.
