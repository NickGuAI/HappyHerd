# Group 1 production component browser evidence

The approved checklist and Get Help additions preserve the existing first-run,
QR restoration, manual restoration, and offline entry points. These captures are
rendered interaction evidence, not deployed-app or native-device acceptance.

| Journey | Surfaces and locales | Visible gesture and outcome | Retention |
| --- | --- | --- | --- |
| Signed-in first-run with no machines | 1440×900 and 390×844; light/dark; en/cn/de | Production SessionsListWrapper → EmptyMainScreen → Get Help → real ModalProvider/WebAlertModal; Cancel closes; Report issue reaches external navigation boundary exactly once | Reopen works; failed external navigation exposes production error, OK, and successful retry |
| Restore QR | Same matrix | Production restore route → Get Help → recovery guidance; Cancel and Report issue remain functional | QR entry remains mounted after modal dismissal; no authentication or account mutation |
| Restore manual | Same matrix | Production manual restore route → Get Help → recovery guidance; Cancel and Report issue remain functional | No key submitted or account mutation |
| Native checklist branch (emulated iOS in Chromium) | Same matrix | Actual production checkbox presses toggle install/open independently; exact checked states asserted | First-only survives component remount; second-only survives page reload and serialized state is exact |
| Offline machine | Same matrix | Production Troubleshoot → production troubleshooting dialog → Copy AI prompt | Copy receives machine-specific diagnostic prompt; no first-run checklist or Help replaces offline action |

`OnboardingHelp.browser.test.ts`: **24 passing tests** (12 matrix combinations,
two journeys each). Each first journey exercises all three Help entry points.
Selected captures are the 16 German checkpoints: four journey states × two
viewports × two themes. en/cn exercise the same exact localized controls and
messages but are not captured. The existing seven EmptyMainScreen browser tests
passed separately in 5.03 seconds after fixture compatibility repair. Node 20
typecheck passed. A final fixture interpolation correction added a visible
machine-name assertion to offline guidance; all 12 checklist/offline cases
passed again in 26.41 seconds (`group1-offline-final.txt`). Captured Help and
checklist rendering was unaffected.

The fixture renders real routes, SessionsListWrapper, EmptyMainScreen,
OnboardingHelpAction, RoundButton, QRCode, ModalProvider, ModalManager,
WebAlertModal, BaseModal, and offline troubleshooting. It uses catalog text,
production theme values and fonts. Unistyles is an inline theme adapter; disabled
Web material effects use the equivalent plain View. Device linking, auth/network,
clipboard, external navigation and the local storage adapter are synthetic;
there is no real account, machine, key, credential or session. The test supplies
a deterministic non-secret QR keypair and never completes authentication.

Only EmptyMainScreen selects the native platform branch. Its native
accessibilityState.checked is adapted to aria-checked for React Native Web's
DOM; the actual Web modal host remains Web. Native OS alerts, MMKV/device
persistence, camera, safe areas and physical iOS/Android gestures remain device
proof gaps. Local schema/persistence tests are separate evidence.

First failures remain under `.artifacts/issue-370`: initial workspace invocation,
relative-import/module fixture boundaries, missing browser process.env values,
and native-to-Web accessibility adaptation. The fourth attempt was interrupted
when the production source changed; only its owned test processes were stopped.
All assertions and existing timeouts remain unchanged. The combined final run
passed the new 24 but exposed seven existing-fixture missing-env failures;
`group1-existing-final.txt` records their separate repaired rerun. No production
fix was introduced to accommodate these harness failures.

Reproduce from `server/` with Node 20 and pinned pnpm:

```sh
pnpm --filter happyherd-app exec vitest run sources/components/OnboardingHelp.browser.test.ts sources/components/EmptyMainScreen.browser.test.ts
```

Set `HAPPYHERD_GROUP1_SCREENSHOTS` to an evidence directory to emit the selected
captures. `manifest.json` pins source and PNG SHA-256 values; the parent receipt
supplies the final committed revision. No merge, deploy, install or service
restart is part of this evidence.
