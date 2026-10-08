# First-run journey verification

Owning issue: [#378](https://github.com/NickGuAI/HappyHerd/issues/378).
User entry: [first-run guide](../../first-run.md).

## Scope and revision

This record separates documentation/source checks, public artifact availability,
rendered fixtures, and an actual clean-account provider journey. A pass in one
plane does not imply a pass in another. No launch media is produced here.

Source baseline: `3a3773303a5539f6c9deddbd04197b92cbab9a76`.
Public release checked October 8, 2026:
[happyherd-v1.2.4](https://github.com/NickGuAI/HappyHerd/releases/tag/happyherd-v1.2.4),
published September 20. Its four assets are listed below; its notes identify
source `189c504b5ab16eea7fa16e3c2fb33e98d147390d` and bundled CLI 1.2.3.
The Git tag itself resolves to `81d3e60ea1ee781ffae1ebb57418f7cb3477b10e`;
that tag/source distinction is retained rather than treating current `main` as
the installed artifact. The live installer and archive are separate revisions.

## Public artifact and target matrix

| Target | Public artifact | Availability | Clean install → first Codex result → reopen |
| --- | --- | --- | --- |
| macOS arm64 terminal/server | `happyherd-darwin-arm64.tar.gz` | Pass: release API lists uploaded asset | Unproved: isolated installation and account journey pending |
| macOS x64 terminal/server | `happyherd-darwin-x64.tar.gz` | Pass: release API lists uploaded asset | Unproved: no x64 target journey |
| Linux arm64 terminal/server | `happyherd-linux-arm64.tar.gz` | Pass: release API lists uploaded asset | Unproved: no Linux arm64 target journey |
| Linux x64 terminal/server | `happyherd-linux-x64.tar.gz` | Pass: release API lists uploaded asset | Unproved: no Linux x64 target journey |
| Web Desktop | Web bundle in the selected server archive | Pass: release identifies bundled Web | Unproved: real 1440 × 900 clean-account journey pending |
| Web Mobile | Same Web host, mobile browser | Pass: bundled Web surface; reachability depends on server URL | Unproved: real 390 × 844 journey pending; desktop cannot establish mobile proof |
| Native macOS GUI / iOS / Android / Windows | None in this release | Not advertised as a downloadable native app by this guide | Excluded from this release's journey; source/build instructions are not an artifact |

Listing an uploaded asset is not download, installation, or provider execution
proof. No physical-device or remote-server deployment result is claimed.

## Source and command audit

<!-- rename:preserve -->
The maintained guide uses the public release's **Web Browser** terminal
authorization route. It does not require the newer Web first-machine checklist,
manual URI scheme, a device-selection code, or account-wide machine-control
linking. The production owners below were inspected at the baseline, with the
corresponding `happy-cli` / `happy-app` paths also inspected at the release tag.
<!-- /rename:preserve -->

| Contract | Production owner | Result |
| --- | --- | --- |
| Install and server choice | `install.sh`; CLI `src/configuration.ts`, `src/commands/server.ts` | Source verified: prepared archive, user install paths, local/remote choice; `--no-start` still stops the old managed runtime |
| Account create / backup / restore | App `sources/app/(app)/index.tsx`, `restore/manual.tsx`, `components/AccountKeyBackupGate.tsx` | Source verified: key-based account, copy before Continue, restore on selected server |
| Browser terminal grant | CLI `src/ui/auth.ts`, `src/api/webAuth.ts`; app `sources/app/(app)/terminal/connect.tsx`, `hooks/useConnectTerminal.ts` | Source verified: generated URL → Accept Connection; terminal account access; new URL needed after lost fragment |
| First-machine discovery | App `components/EmptyMainScreen.tsx`, `ConnectionsSettingsView.tsx` | Source verified with release differences labeled; authorization is distinct from online daemon |
| Machine / folder / provider | App `sources/app/(app)/new/index.tsx`, locale catalogs | Source verified: release Start New Session / Project versus current New Chat / Advanced / Choose folder |
| Existing conversation | App `hooks/useSessionQuickActions.ts` | Source verified: supported resume requires retained machine/provider metadata; no universal older-release guarantee |
| CLI commands | Installed `happyherd auth --help`, `daemon --help`, `server --help` | Pass: supported command/help surface; not a public-archive runtime check |
| Native provider prerequisite | `codex --version`, `codex login --help`, `codex login status` | Pass: native CLI 0.160.0 reports existing ChatGPT login. No credential files read or copied. This is preauthenticated-provider status, not a fresh vendor login or a provider reply. |

Official Codex setup/authentication links were fetched separately; provider
setup remains distinct from HappyHerd account authentication. Source inspection
and help do not constitute live onboarding.

## Documentation checks

- `node scripts/lint-source.mjs` and `git diff --check`: passed.
- Relative file links in README and the five linked guide/acceptance documents:
  45 checked, none broken.
- Signed-out HTTP reads of the repository, release, and installer: 200. The
  rendered branch README contains the quickstart label and both guide/matrix
  links. Official provider documentation links resolve directly to 200.
- Existing changelog parser executed with the pinned Bun runtime: 192 entries,
  newest title **October 8 — Follow one first-run guide**. Generated JSON was
  reviewed; no parser changes.
- Public-boundary self-test, committed public-boundary verification, and owned
  patch discipline: passed on the initial documentation commit.
- Independent Codex exact-head review of
  `ffe6bb8f2a39cc884195e6d767bafdffad2c3060` identified the interactive
  installer's authentication pause and outstanding changelog goldens. The
  guide now explains completing account/provider setup while that original
  prompt waits. Final-head review and CI remain required after all changes.

The first [Contract suite](https://github.com/NickGuAI/HappyHerd/actions/runs/37831356089/job/113497438369)
on `ffe6bb8f2a39cc884195e6d767bafdffad2c3060` failed the rename check because
the historical release package names in this source-audit passage lacked its
preservation annotation. The exact passage is now marked using the existing
rename-preservation mechanism; no verifier or exemption list was changed.

## Changelog regression baselines

The first [Production build](https://github.com/NickGuAI/HappyHerd/actions/runs/37831356078/job/113497333514)
on `ffe6bb8f2a39cc884195e6d767bafdffad2c3060` failed strict comparison for
4 of 28 variants. Artifact `kilv-golden-37831356078` (ID `11574187300`,
Playwright 1.62.1) contains expected, actual, diff, and the comparison summary.
All other 24 variants had zero differing pixels; no dimensions changed.

Each of the four expected/actual/diff sets was visually reviewed. The October 8
entry appears first and shifts older entries down. Desktop geometry, mobile
header/back navigation, theme, typography, and readable wrapping are preserved.
Only the four generated actual PNGs were copied to their existing baselines,
using the same copy operation as the supported regeneration workflow. The
expected PNGs matched the committed baselines byte for byte. Changelog Markdown
and JSON remain byte-identical to the capture source; intervening edits affect
only documentation and its navigation. No tolerance, assertion, or skip changed.

| Baseline | Initial differing pixels | Accepted PNG SHA-256 |
| --- | ---: | --- |
| `production-changelog-latest-entries-light-1440.png` | 91451 | `d871ff573544db3d1f5ca3bede5a4e8ce8e8b1d016a9ecf299f84e31ec05375b` |
| `production-changelog-latest-entries-light-390.png` | 48562 | `ff41a62b302442a88d9b0941b1bd39e2a99a2c398beaf3096004474f56f8a925` |
| `production-changelog-latest-entries-dark-1440.png` | 94376 | `79ea59f890ce1062d8a907998e3a6390ef0e25ee4bd1b3df6e7bb1ba00a796c2` |
| `production-changelog-latest-entries-dark-390.png` | 51550 | `8c5ae9afd0fec451d7f70ca67f376633cc19b6fc8c160897735822f6c26ea00c` |

These are automated regression-test artifacts only, not product media or a
clean-account journey. Final-head CI must compare the accepted baselines again.

## Human journey and failure matrix

The intended production journey is README → first-run guide → selected server
welcome → Create account or Restore → Backup → terminal Web Browser → Accept
Connection → daemon online → new session with actual machine/folder/Codex →
file summary → close/reopen → second reply in the same conversation.

| Case | Entry / gesture / expected visible outcome | Live status |
| --- | --- | --- |
| New account, no machine | Welcome → Create account → Backup → signed-in empty session list | Unproved: new-account grant pending |
| Restore and retain account | Restore with Secret Key → Restore Account → same account history | Unproved: no secret exposed or copied into evidence |
| Terminal authorization | CLI Web Browser → Accept Connection → authenticated terminal, then daemon online | Unproved: terminal grant pending |
| Provider unavailable | New-session provider choice with no configured provider → setup guidance or absence; install/login before retry | Unproved: preauthenticated native Codex status does not exercise empty-provider UI |
| First useful task | Select actual machine + task folder + Codex → summarize `notes.txt` → verify three tasks and deadline | Unproved: no real provider reply yet |
| Reopen and continuation | Reopen same profile/account/conversation → ask about deadline → second reply | Unproved |
| Failed account creation / retry | Unreachable auth request → visible failure or observed silent failure → connectivity restored → retry | Unproved on artifact; release source lacks newer Retry dialog |
| Wrong server / account | Compare Web/install server choice and approving browser account → restore correct account on its server | Unproved; no production account mutation authorized |
| Cancelled / stale terminal grant | Reject/cancel → fresh CLI request URL → approve → success | Unproved |
| Cancelled / expired device selection | On supporting version, cancel or expire existing-device code → fresh code → same device | Unproved; separate from first-terminal authentication |
| Offline daemon / retry | Stop only isolated daemon → machine offline → start it → same machine usable | Unproved; isolated runtime scope pending |

No fixture result is counted as an actual provider journey. Preserve the first
failure's exact artifact, command or gesture, visible outcome, and owner when
executing these rows; do not turn retries into a claim that the first run passed.

## Existing owners and readiness

- [Release alignment #383](https://github.com/NickGuAI/HappyHerd/issues/383)
  owns publishing downloads that match newer source. This guide cannot supply
  newer onboarding or reconnection features to 1.2.4 by documenting them.
- [Installer #371](https://github.com/NickGuAI/HappyHerd/issues/371) owns the
  public installer/old archive compatibility repair; its source repair is
  separate from this guide's clean-user acceptance.
- [Setup #379](https://github.com/NickGuAI/HappyHerd/issues/379),
  [first-machine entry #380](https://github.com/NickGuAI/HappyHerd/issues/380),
  and [account failure feedback #381](https://github.com/NickGuAI/HappyHerd/issues/381)
  own the established setup defects. They are closed in current source; that
  does not establish their availability in the public archive.
- [Native parity #369](https://github.com/NickGuAI/HappyHerd/issues/369) and
  [iOS login crash #375](https://github.com/NickGuAI/HappyHerd/issues/375) remain
  separate native concerns. No native publication or device change is included.

**Readiness: not signed off.** Documentation can be reviewed independently, but
issue #378 remains open while actual clean-user and targeted-surface acceptance
is unproved or lacks an explicit owner disposition. No merge, release,
deployment, shared-daemon change, or issue closure is part of this work.
