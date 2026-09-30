# Issue #347: Commander context row

Owner: https://github.com/NickGuAI/HappyHerd/issues/347

## Contract

The Human opens a Commander-started session and sees one row at the beginning
of its stream. The Commander avatar and name open Commanders. Each chip names
a file that the launch context assembler successfully read. The row never
infers loaded files from registry paths, current disk contents, or filenames.
An empty but successfully read file counts; a missing or unread file does not.
The assembler captures the file list, and metadata publishes it only after the
provider process successfully consumes that assembled bundle. Existing ACP
launchers do not consume this bundle and therefore receive no loaded-file
chips; this change does not add context injection to those providers.
Sessions without a Commander have no row.

The same production component serves empty and populated streams. For a
paginated populated stream the row belongs before the oldest message, not at
the temporary edge of a history window. Metadata survives reopening and is
refreshed when resume actually assembles context. Rebinding a Commander must
not attribute the former Commander's file receipt to the new selection.

## Acceptance and proof boundaries

| Acceptance | Owner | Required evidence |
|---|---|---|
| Avatar/name, Commanders navigation, one row | Shared Commander context row in ChatList and EmptyMessages | Authenticated server-backed session in the production host; actual avatar/name gesture opens Commanders; focused host regressions support this proof |
| Only successfully loaded files | CLI assembly → native provider delivery → encrypted session metadata → app schema | Successful/empty/missing/unread inputs, actual native bundle and authoritative receipt comparison at launch/resume, then visible matching chips |
| No Commander, no row | Shared row conditional | Actual no-Commander session has no receipt and no visible row; focused stale-metadata negatives support this proof |
| Web Desktop | Production stream host | Authenticated 1440×900 row, exact filenames, retained state and actual navigation |
| Web Mobile | Production stream host | Authenticated 390×844 row, bounds/wrapping, retained state and actual navigation |
| Native apps | Shared React Native component and native hosts | Installed iOS simulator, macOS Tauri and Android emulator journeys with actual authentication/transport; physical hardware and store publication are not required by #347 |

Browser fixtures inject session state but render the production stream host.
They do not prove that an authenticated provider launched on a deployed
revision. Native renderer coverage is not an installed-app gesture. The first
review-ready handoff did not establish full acceptance. The subsequent owner
instruction authorizes reversible isolated acceptance runtimes, local builds,
and authenticated test journeys, while excluding shared production runtime
disruption, merge, release publication, and issue closure.

## Authenticated acceptance continuation

The initial live build is `ba75ce5a4f184d234bd23d444bc0596893f4f367`, based on
`0217e4c629415eda601856cd21e535489e5e1f06`. Node 20.19.0 and pnpm 10.11.0 built
the wire package, CLI, and production Web export. An isolated HappyHerd home
references the existing machine login without copying credentials, has its own
machine identity and daemon, and uses a controlled Commander/workspace. The
shared production daemon and server were not replaced or restarted. The real
native Codex app-server uses its existing authorized provider login.

| Live probe on initial build | Direct result |
|---|---|
| Commander launch | PASS: authoritative encrypted server metadata records global AGENTS, Commander, empty working memory, and long-term memory; actual assistant output matches the synthetic global and long-term markers and the turn completes |
| Receipt independent of current disk | PASS: after stopping the test provider, making global AGENTS unreadable, and removing long-term memory, the retained launch receipt still records its original four files |
| Actual resume | FAIL: same HappyHerd session and Codex thread resume, and metadata changes to the two readable files, but the actual assistant still returns the old Commander marker; the new marker is absent from the native rollout |
| No-Commander launch | PASS at transport boundary: a real session has no Commander identity or loaded-file receipt; visible absence still requires authenticated UI proof |
| Web Desktop / Mobile | Outstanding: exact-source Web export is available, but authenticated row/navigation journeys remain to be exercised |
| Native applications | Outstanding: installed exact-source iOS, macOS, and Android journeys remain to be exercised; simulator/emulator interaction is acceptable functional evidence, and physical hardware/store publication is not required by #347 |

The failed resume is a product finding, not an environment failure. A loaded
Codex thread ignores the `developerInstructions` configuration override sent by
`thread/resume`; reading the new bundle in the HappyHerd process alone did not
prove that the model received it. Its correction must use the existing native
developer-item mechanism and publish the new provenance only after successful
application, preserving concurrent Commander reassignment/detachment.

Local evidence is retained under the issue-owned temporary acceptance root:
`build-manifest.json`, `launch-authoritative-complete.json`,
`pre-resume-files-changed.json`, `resume-authoritative.json`,
`resume-marker-comparison.json`, and `resume-native-marker-audit.json`.
Receipts contain allowlisted metadata and marker/completion booleans, not
credentials or raw transcripts. The readback script validates the exact owned
session, machine, workspace, and home before decrypting server state.

## Corrected build: real launch and resume

CLI revision `89732b925cf903ce7d64ebbf3d88703ef8ccd3fb` fixes the observed
resume failure. The isolated daemon was stopped and rebuilt; the shared
production daemon was unchanged. A new session launched on this revision, then
resumed on the same revision. The original failing session also resumed after
the correction. Both retained their respective HappyHerd and Codex identities.

The [sanitized native audit](issue-347-live-provenance.json) records direct
native-provider and encrypted-server comparisons for both cases:

- Launch records four files, including an empty successfully read working
  memory file; the native developer bundle matches the launch receipt hash.
- Before resume, global AGENTS is unreadable to the normal account and
  long-term memory is absent. The resumed receipt records only Commander and
  working memory.
- The actual native developer item appears after the prior completed turn and
  before the resumed turn. Its entire text hash equals both the authoritative
  context hash and instruction hash. The new item contains the changed
  Commander marker and neither excluded file's marker.
- The resumed assistant returns the new marker, not the old one; both turns
  complete with zero native tool calls. The original failed resume's hash
  remains absent from its pre-fix native history, preserving failure evidence.

The controlled journey used the maintained command surface, with every command
selecting the issue-owned home and existing server login:

```sh
happyherd commander create --manifest "$ISSUE_347_MANIFEST"
happyherd commander list
happyherd daemon start
happyherd session create --local --path "$ISSUE_347_WORKSPACE" \
  --provider codex --permission read-only --commander issue347-probe --json
happyherd session send "$ISSUE_347_SESSION" \
  --text-file "$ISSUE_347_LAUNCH_PROMPT" --message-id "$ISSUE_347_LAUNCH_ID" --json
happyherd daemon stop-session "$ISSUE_347_SESSION"
happyherd session inspect "$ISSUE_347_SESSION" --limit 1 --json
# Change only the controlled Commander marker; make global AGENTS unreadable
# and move long-term memory out of its canonical fixture path.
happyherd session send "$ISSUE_347_SESSION" \
  --text-file "$ISSUE_347_RESUME_PROMPT" --message-id "$ISSUE_347_RESUME_ID" --json
```

The source readback calls `ApiClient.inspectSessionAuthoritative`, since the
public inspect command intentionally omits loaded-file metadata. It validates
the exact fixture owner before reading encrypted state and emits allowlisted
metadata and marker booleans only. The native audit reads only the two owned
test threads and emits no transcript text. The no-Commander launch also
completed a real provider turn with null Commander identity and null receipt.

Focused regression evidence is four failing tests before the correction and
89 passing tests afterward, plus CLI typecheck/build. Independent exact-head
review found no actionable issues and independently passed the 17 tests in
the two changed files. Failure injection verifies that failed native delivery
publishes no replacement receipt or user turn; callback tests preserve a
concurrently reassigned or detached Commander.

This closes the real provider/transport gap. Authenticated Web Desktop/Mobile
row visibility, the actual Commanders destination, and installed native
journeys remain separate outstanding rows. The available Web export was built
at `ba75ce5a`; app source, manifest and lockfile equality with `89732b9` was
verified, rather than claiming that export was built from the later SHA.
Native build work is serialized with the other issue owners because shared
disk capacity fell below 2.5 GiB. No unrelated cache, simulator, or runtime was
removed or restarted.

## Reproducible focused evidence

- CLI: `agentContext/commanderContext.test.ts`, `api/api.test.ts`,
  `api/apiSession.test.ts`, `commands/machine.test.ts`,
  `utils/createSessionMetadata.test.ts`, plus the existing resume/runner suites.
  These cover assembly and consumption, inaccessible/absent/empty files,
  encrypted metadata conflict retry, and invalidation on reassignment.
- App: `components/CommanderContextRow.test.ts`, `ChatList.test.ts`,
  `ChatList.native.test.ts`, `ChatList.browser.test.ts`, and
  `sideChatHeader.browser.test.ts`. The last suite renders production
  SessionView → AgentContentView → ChatList/EmptyMessages and clicks the
  actual name/avatar control; the router adapter records `/commanders`.
- The eight `issue-347-{session,empty}-{1440,390}-{light,dark}.png` images
  beside this document retain the synthetic production-host captures. The
  populated row precedes the first message; the empty row sits above the
  existing empty state. Four file chips wrap without clipping on mobile.
- Initial local frozen install completed without tracked changes. Changelog
  parsing reports 170 entries and “September 29 — Commander context in the
  session stream”. Web export, production Web smoke, and an iOS bundle export
  passed during implementation. Final committed-head results live in the PR.

For local CLI checks on macOS use Node 20, pnpm 10.11.0, Bun 1.3.11,
`TZ=UTC`, and `TMPDIR=/private/tmp`; `/var` and `/private/var` aliases otherwise
produce existing path-expectation failures. Preserve those failed runs when
classifying them. Browser suites use one worker on the shared machine.
