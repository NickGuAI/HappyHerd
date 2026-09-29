# Issue 348 acceptance

Scope: restore the redesign's styling on Usage, the Workspace feedback
composer, and live-page element outlines without changing copy, capabilities,
usage data, or feedback delivery.

## Journeys and proof boundaries

| Journey | Visible entry and gesture | Outcome and retention |
| --- | --- | --- |
| Usage | Settings → Usage; choose Today/7 days/30 days, then Tokens/Cost | Shared page title and cards, accent charts; the same queries, totals, coverage disclosures and provider rows. Period and metric remain local view state as before. |
| File feedback | Open a file in Workspace or its existing link viewer; type in the footer and press Send | One rounded composer card with 44 px photo/send controls; same exact-session strict delivery and linked machine/path/line/column. Failed sending keeps the draft and attachments. |
| Live element feedback | Workspace → Open localhost URL → Start commenting; hover/click the element, pin and send | Theme-accent outline and fill; same HTML/CSS/bounds and element crop in the existing feedback batch. Theme switches retain the iframe document and page state. Picking clears the overlay as before. |

| Surface | Rendered evidence | Live/device evidence |
| --- | --- | --- |
| Web Desktop, 1440 × 900, light/dark | Production Usage route/SettingsFrame, link viewer/composer, and integrated Workspace/live iframe in browser fixtures | Unproved: exact revision is not deployed; machine/API boundaries in the fixtures are synthetic. |
| Web Mobile, 390 × 844, light/dark | Same production owners and gestures, input font ≥16 px, controls remain within viewport | Unproved: authenticated deployment and physical iPhone Safari focus/zoom require a device and selected deployed revision. |
| iOS/Android apps | Native structural tests of Usage title/cards and composer safe-area/controls; existing send/voice regression tests | Unproved: no physical-device journey performed. |
| macOS/Windows apps | Shared source coverage; browser proof covers the web component implementation | Unproved: no packaged native application journey performed. |
| Live localhost on native apps | Excluded by the existing `LocalhostLiveView.tsx` platform contract (web-only) | Not newly introduced by this change. |

## Reproduction

Before implementation, the composer regression failed because the shared input
card was absent (the eight existing send/voice tests passed). Usage native title
regressions failed on the old route. The live picker regression failed because
the host did not send a theme accent; its injected overlay hardcoded `#5b8cff`.

## Verification owners

- `components/usage/UsagePanel.browser.test.ts`: Usage route and responsive host.
- `components/usage/UsagePanel.native.test.ts`: native structural evidence only.
- `components/WorkspaceFeedbackComposer.test.ts`: native structure, voice,
  images, pending receipt, failure retention, and strict sending.
- `components/WorkspaceLinkViewer.browser.test.ts`: real fallback host,
  Unistyles composer styling, desktop/mobile light/dark, and sent reference.
- `components/desktopWorkspace.browser.test.ts`: integrated live page,
  theme changes without iframe reload, element capture and feedback batch.
- `components/LocalhostLiveView.web.test.ts`: picker message color and unchanged
  registration across a theme switch.
- `sync/workspaceLive.test.ts` and `sync/workspaceFeedback.test.ts`: unchanged
  transport/serialization contracts.

The PR and final issue handoff pin the exact reviewed SHA, command outcomes,
CI runs and any remaining gaps. Browser fixtures and build/export results are
supporting evidence, not deployment or physical-device acceptance. No merge,
deployment, runtime installation, daemon restart or issue closure is included.


## Rendered fixtures

The screenshots below use synthetic usage/machine data. Composer captures show
only the production input card; live captures show the existing Workspace host
and fixture target (its blue page content is deliberately unchanged).

| Surface | Usage | Feedback composer | Live outline |
| --- | --- | --- | --- |
| Desktop light | [image](usage-light-1440.png) | [image](feedback-light-1440.png) | [image](live-outline-desktop-light.png) |
| Desktop dark | [image](usage-dark-1440.png) | [image](feedback-dark-1440.png) | [image](live-outline-desktop-dark.png) |
| Mobile light | [image](usage-light-390.png) | [image](feedback-light-390.png) | [image](live-outline-mobile-light.png) |
| Mobile dark | [image](usage-dark-390.png) | [image](feedback-dark-390.png) | [image](live-outline-mobile-dark.png) |

Production Web export and its mounted React smoke pass. iOS and Android Expo
production exports pass; these are bundles, not signed packages or device
journeys. Localization validates 1,640 keys across English, Chinese and German;
the generated inventory covers 44 routes, 336 surfaces and 84 smoke cases.
The changelog parser reports 169 entries, latest “September 29 — Usage and
Workspace styling”. Full suite and exact-head CI results remain pinned in the
PR/handoff so documentation does not imply an unobserved deployment.
