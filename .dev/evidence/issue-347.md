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
| Avatar/name, Commanders navigation, one row | Shared Commander context row in ChatList and EmptyMessages | Production host browser click at 1440×900 and 390×844; shared native structural assertions |
| Only successfully loaded files | CLI Commander context assembly → child environment → encrypted session metadata → app schema | Successful/empty/missing/unread file fixtures, environment transit and authoritative resume replacement |
| No Commander, no row | Shared row conditional | Web and native negative cases, including stale path metadata |
| Web Desktop | Production stream host | Light/dark rendered row, exact filenames, wrapping and link gesture |
| Web Mobile | Production stream host | Light/dark rendered row at 390×844, bounds and link gesture |
| Native apps | Shared React Native component and hosts | Native branch structural/navigation assertions and app build/typecheck; authenticated physical-device journey remains separate |

Browser fixtures inject session state but render the production stream host.
They do not prove that an authenticated provider launched on a deployed
revision. Native renderer coverage is not a physical-device gesture. This
delivery does not authorize runtime installation, deployment, daemon restart,
merge, or issue closure. The final PR description and issue handoff retain
the exact head/base, commands, CI links, independent review and remaining live
prerequisites.

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
