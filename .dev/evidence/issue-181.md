# Evidence: Issue 181 desktop workspace interaction repair

This document provides real-Chromium, isolated production-component fixture evidence. It is not an integrated production UI screenshot, an Expo production export, or deployed-domain proof.

The harness bundles and renders the real `SidebarNavigator`, `DesktopFileWorkspaceSplit`, and `DesktopFileWorkspace` components in headless Google Chrome through Playwright. Only network, storage, router, icon/image, and similar dependencies are deterministic fixture stubs.

## Test environment

- Test viewport: 1440 × 1200
- Compact workspace host: exactly 390 × 844

## Verification and outcomes

Run from `server/`:

```bash
corepack pnpm --filter happy-app exec vitest run sources/components/desktopWorkspace.browser.test.ts --reporter=verbose
```

Result: 2 tests passed, with no page errors or `console.error` messages.

Verified interaction behavior:

- The boundary toggle is centered on the drawer edge and located exactly 15 px below the fixture top. Collapse and reopen both work, and the collapsed toggle does not overlap the Zen control.
- A real `page.mouse` pointer drag grows the workspace by more than 100 px. The Main Agent chat remains visible, and the component mount identity and typed draft survive the resize.
- The wide header has Source, Edit, and Delete actions with no separate Preview action. Source toggles between preview and source in both directions, Edit is writable, and confirmed Delete invokes the deletion transport seam and removal callback.
- Separate focused tests prove the owning transport and filesystem boundaries: `sources/sync/ops.rig.test.ts` routes ordinary deletion through the exact machine RPC, `src/api/apiMachine.test.ts` publishes the machine capability after daemon connection, and `src/modules/common/registerCommonHandlers.readFile.test.ts` unlinks a file while rejecting directories.
- The compact fullscreen branch has Source, Preview, and Edit actions, with no Delete action, tab role, or divider.

## Baseline RED

At untouched commit `0d19fced`, with only the test harness copied, both tests failed:

- The boundary center was 234 px from the drawer edge, where less than 2 px was required.
- The wide Preview count was 1, where 0 was required.

## Regenerated visual evidence

The screenshots were regenerated with `HAPPYHERD_ISSUE_181_EVIDENCE_DIR=.dev/evidence`:

- [Targeted 600 × 96 SidebarNavigator crop](issue-181-standard.png)
  - SHA256: `8a78907fb0acaf360c457b462d492722f6a5c7a3e822bc2dc91fc81add55c93e`
- [Targeted 1100 × 480 split-workspace crop](issue-181-wide.png)
  - SHA256: `9b01854077d2b6b1c3db22da4e40d07949dd236c5e29e8a1dd90dd6052708b50`
- [Real 390 × 844 compact/fullscreen crop](issue-181-mobile.png)
  - SHA256: `585b441f4fc2902963c24818bbfb6d8dde246fcbfec78820c7d90c60d10be3ef`

## Release gate

Exact-main deployment and health evidence will be added after merge. Authenticated deployed-domain gesture confirmation remains a separate Human release check if no safe authentication harness is available.
