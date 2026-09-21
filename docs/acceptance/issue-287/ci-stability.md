# Browser CI fixture stability

The two failing checks on `54232ca1` were [Quality / Unit tests](https://github.com/NickGuAI/HappyHerd/actions/runs/35483267024) and [Contract suite](https://github.com/NickGuAI/HappyHerd/actions/runs/35483266900). Both stopped in the app suite, so their downstream package tests were not evidence of success. The repairs below change browser-test setup only; they do not change production UI or replace the existing panel screenshots.

## Credentials: loaded-list precondition and transport overhead

The mobile long-list save-error test used Vitest's default five-second test budget for browser creation, navigation, font loading, rendering 200 credentials, editing the form, submitting it, checking the error and draft, and closing the page. One CI job timed out; the same case took 4,763ms in the other job. This is a functional journey, not an explicit end-to-end performance threshold.

The fixture now serves JavaScript, linked source maps and the four real font files separately, precomputes both theme documents and returns an empty favicon response. It still waits for the actual font files before rendering and keeps all 200 synthetic credentials. The map remains available for debugging but is not part of normal navigation.

| Transport | Before | After |
|---|---:|---:|
| HTML response | 5,145,240 bytes | 901 bytes |
| Favicon response | 5,145,240 bytes | 0 bytes |
| Navigation body transfers | approximately 10.29MB | approximately 1.79MB |
| Executable JavaScript | included in HTML and inline map | 1,591,681 bytes |

In three runs with 4× CPU throttling, transport-only changes reduced median navigation time from 569ms to 331ms. The whole case improved only from 3,394ms to 3,313ms. Those numbers do **not** establish that transport changes alone remove the CI deadline risk: rendering and operating the long list still dominate.

The long-list save-error scenario therefore has an explicit loaded-page fixture: a bounded five-second setup opens the page and waits for the Add Credential control and the 200th credential. The original Add/edit/Save/error-in-viewport/draft-preservation/editability assertions then run under the original five-second functional test budget. Teardown closes the page even on failure. This is **separate bounded setup plus functional verification**, not a claim that navigation and the entire journey still fit one five-second deadline. Other journey assertions and the global test configuration are unchanged.

The final uninstrumented Credentials suite passed all 55 cases. Six diagnostic runs (three normal, three with 4× CPU throttling) also passed: at 4×, setup took 1,443–1,829ms and the functional phase took 2,202–2,273ms. All four fonts loaded and no page errors were recorded. These local Chromium measurements are not a reproduction of the original GitHub timeout or a substitute for a final CI run.

## ChatList: row mounting before coordinate assertions

The failed desktop wheel test entered its default one-second coordinate poll immediately after document load, before FlashList necessarily mounted the requested row. Local traces of the real list showed the final animation steps `y=-10, -5, -2, 1, 3, 4`: passing through `-2` before ending at `4` is consistent with the CI observation, though CI did not record the final position. All six normal and six 4× CPU trace runs finished at `y=4`. The scroll promise resolved before the browser finished its smooth animation, so promise completion is not used as a substitute for visible geometry.

Both wheel preparation paths now wait for the target row to mount before entering the unchanged coordinate poll. The `y >= 0` assertion, both 100px wheel directions, Jump to latest, separate receipt-focus cases and their existing timeout budgets remain intact. There is no production scrolling change or new tolerance.

A temporary diagnostic delayed React mounting by 650ms to reproduce a busy browser. The original preparation failed at both widths under normal and 4× CPU conditions. The repaired preparation passed both normal-width cases and eleven repeated 4× cases. The final test source contains no mount delay, CPU throttling, retry, or sleep. Its original twelve cases pass without instrumentation.

## Verification commands

Run from `server/` with the repository's supported Node and pnpm versions:

```sh
pnpm --filter happyherd-app exec vitest run sources/components/CredentialsSettingsView.browser.test.ts sources/components/ChatList.browser.test.ts
pnpm --filter happyherd-app typecheck
```

The final branch must also pass the complete local `scripts/contract-suite.sh` and all required GitHub checks after integrating current main. CI links and the exact final head are recorded in the PR description. Native and authenticated journey gaps in the existing acceptance matrix remain separate.
