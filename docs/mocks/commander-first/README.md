# #300 — Commander-first interactive review

**Stage: local prototype ready for human review. Production implementation waits
for an explicit review decision on this PR / #300.** Refs #300; this preview does
not complete or close the feature issue.

## Run and review

From the repository root, serve the local repository (no build or app install):

```sh
python3 -m http.server 8300 --bind 127.0.0.1
```

Open <http://127.0.0.1:8300/docs/mocks/commander-first/index.html>.
Use a 1440×900 desktop viewport and a 390×844 mobile viewport in browser device
emulation. The same page adapts from a two-pane desktop to a full-screen mobile
library/chat, with a visible **Bots & chats** return button. Keep the server port
the same to retain the same browser-local state. Stop the server with Ctrl-C.

The preview begins in **Standard view**. Open **Settings → Features → Experimental
Features → Simplified Mode** to opt in. All mock data uses only the localStorage
key `happyherd-issue-300-mock-v1`; it never touches real app settings or accounts.
**Prototype lab → Reset mock data** clears only this fixture after confirmation.

### Walkthrough / journey contract

Human: a HappyHerd user trying a Commander-first entry. All rows target both
desktop and mobile web preview hosts.

| Entry and gesture | Visible outcome | Retention / failure contract |
|---|---|---|
| Settings → Simplified Mode; close Settings; reload | Bots-first library; connection fields hidden | Toggle, selected chat, drafts, attachments, Commanders and recents survive switching off/on and reload |
| Search bots and chats; try `Sage` and a no-match query | Filtered results and explicit empty state | Search is a temporary view filter |
| Create Commander → name and purpose → Create (or Cancel) | New bot selected, ready for first message; Cancel adds nothing | New bot persists; creation creates no session |
| Select a bot; type; attach an image or file | Unsent draft and removable attachment chips | Selection and typing create zero sessions; each bot/chat retains its own draft |
| Send (or Ctrl/Cmd+Enter) | Pending state, then a chat with the first message and simulated reply | Exactly one simulated session uses the selected Commander and saved fixture defaults; repeated pending submits are ignored |
| Bots & chats → recent chat; send again | Same session ID and messages reopen | Existing draft and history remain; sending adds a turn, not a session |
| Prototype lab → launch scenario; select a bot and Send | Recoverable error; draft/attachments remain | Missing defaults and offline machine require Settings recovery; no alternate machine/account is chosen |
| Temporary failure → Retry send | Same request succeeds on retry | Draft survives; no empty failed-launch session |
| Session created, response lost → Send → reload → Send | Retry finds the already-created session and delivers the draft | Stable simulated request ID; session count grows only once |

The **Prototype lab** is a review tool, not proposed production UI. Its counter
and launch receipt expose Commander ID, session ID, request ID, and exact saved
defaults so reviewers can inspect the first-send/retry behavior. Scenario changes
affect new launches; recents resume their existing session.

## Review decision needed

Please review both sizes and record **approve for production implementation** or
**revise mocks**, with changes, on this PR / #300. In particular:

1. Is the bots + recents layout, mobile back navigation, and retained Standard
   view escape appropriate?
2. Is first-send creation discoverable, with sufficient pending/error/retry
   feedback and clear draft/attachment retention?
3. Is the streamlined name/purpose creation interaction appropriate, or should
   the preview use the current guided Commander onboarding conversation?
4. Are the Settings recovery affordance and mobile composer/attachment layout
   acceptable?

Approval of the mock does not itself ship the feature. Production remains a
subsequent implementation and verification stage under #300.

## Production reuse map (read-only investigation)

These existing owners were inspected to ground the preview; they are not imported
or modified by it:

- `server/packages/happyherd-app/sources/app/(app)/settings/features.tsx`: experimental
  settings entry and existing setting hooks.
- `sources/components/CommandPalette/CommandPaletteProvider.tsx` and
  `sources/app/(app)/new/index.tsx` (relative to the app package): current Create
  Commander entry navigates to `/new` with `intent=create-commander`, seeding the
  Commander onboarding prompt. **The mock's compact form is a design proposal,
  not an existing production creation API.** Human review must settle this flow;
  production must reuse existing Commander creation rather than add a data model.
- `sources/hooks/useStartSessionFromDraft.ts`: existing defaults, exact machine
  validation, pending state, attachment handling and spawn request ID lifecycle.
  Reuse that supported creation path after review; the fixture's request map is
  not a replacement for its real idempotency/recovery behavior.
- Existing settings / Commander / session state stay authoritative in production.
  No provider, account/auth, scheduler, security, or storage redesign is proposed.

## Verification and evidence

`verify.mjs` runs the real local page through browser controls (mobile taps),
checks visible outcomes and the simulated state, and regenerates screenshots.
It starts and stops its own ephemeral loopback HTTP server. Install Playwright
outside the repository, or use an existing installation:

```sh
# If Playwright is resolvable from this script:
node docs/mocks/commander-first/verify.mjs
# Otherwise point to the installed module (absolute path to index.mjs):
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node docs/mocks/commander-first/verify.mjs
# Optional, requires the matching Playwright WebKit browser installed:
BROWSER=webkit PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node docs/mocks/commander-first/verify.mjs
```

| Surface | Browser / evidence | Result |
|---|---|---|
| Desktop 1440×900 | Chromium; click/type/upload/reload flows above | Pass; zero page errors, no horizontal overflow |
| Mobile 390×844 | Chromium touch emulation; same flows | Pass; zero page errors, no horizontal overflow; 16px composer text; Send reachable at reduced 390×560 viewport |
| Safari / WebKit | Attempted; matching WebKit executable unavailable locally | Unproved; not inferred from Chromium |
| Physical iPhone / native apps | Outside the local web mock stage | Unproved; browser emulation does not prove software-keyboard / native behavior |

Screenshots (all fixture-only):

| State | Desktop | Mobile |
|---|---|---|
| Opt-in Settings | [desktop](evidence/chromium-desktop-settings.png) | [mobile](evidence/chromium-mobile-settings.png) |
| Bots + recents | [desktop](evidence/chromium-desktop-bots.png) | [mobile](evidence/chromium-mobile-bots.png) |
| Creation dialog | [desktop](evidence/chromium-desktop-create.png) | [mobile](evidence/chromium-mobile-create.png) |
| Standard view draft | [desktop](evidence/chromium-desktop-standard-draft.png) | [mobile](evidence/chromium-mobile-standard-draft.png) |
| Missing defaults + retained draft | [desktop](evidence/chromium-desktop-failure.png) | [mobile](evidence/chromium-mobile-failure.png) |
| Successful chat + attachment | [desktop](evidence/chromium-desktop-chat.png) | [mobile](evidence/chromium-mobile-chat.png) |
| Lost-response recovery | [desktop](evidence/chromium-desktop-lost-response.png) | [mobile](evidence/chromium-mobile-lost-response.png) |

## Bounded gaps / stage sign-off

- All replies, defaults, Commanders, sessions, launch latency and errors are
  simulated. No real provider API, machine RPC, auth, encryption, sync, upload,
  or production session idempotency is exercised.
- Standard view is an explanatory stand-in, not a replica of the full app. The
  actual production Standard view and all existing settings remain untouched.
- Image previews persist locally; other files retain name/size only. Mock limits
  are 5 files / 1 MB each; real attachment capability/transport must reuse the
  standard production composer. Multiple tabs and storage quota exhaustion are
  not production persistence guarantees.
- This is English/dark-only review copy under `docs/mocks/`, following the existing
  standalone mock convention. Production localization, themes, UI inventory,
  changelog, package tests and export belong to the approved production stage.
  No production app files or release notes are changed by this preview.
- Changed lane: documentation + standalone local prototype. No runtime activation
  is required. **Signed off for review; activation not authorized.** Browser proof
  is prototype proof only; human approval and production acceptance remain open.
