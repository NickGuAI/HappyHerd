# Issue 370 rendered interaction evidence

These twelve captures illustrate automated Chromium interaction tests at 1440×900 and 390×844, light and dark. They use production components with synthetic fixture data and transport. They are not authenticated live journeys or the strict KILV pixel comparison. See [manifest.json](manifest.json) for each capture’s source boundary.

| Journey | Visible action and verified result | Test owner |
| --- | --- | --- |
| New Chat | Send, edit during deferred preparation, fail, retry: one session spawn; the same input retains newer text. | `streamline.browser.test.ts` |
| Archive | Header Archive hides a row before transport completes; failure restores it, and retry succeeds. Ordinary sessions retain cleanup/fallback, while bot cases forbid server fallback. Captures show rollback. | `sessionScreen.browser.test.ts` |
| Attachment preview | Press the image’s full-size action; the actual ModalProvider/CustomModal host shows a decoded image and Close button fully inside the viewport; Close returns to the retained inline frame/filename. | `sessionScreen.browser.test.ts` |

The complete interaction runs also include paste/drop ownership, transient attachment reset, history Load more/Retry, pending-message timing, exact-once prompt settlement, and installed Expo Router stack/back behavior. Counts and final acceptance status belong in [the integration report](../../upstream-sync-4cf54d18.md).

The first image fixture mounted a preview below the viewport. Visual review rejected those captures as preview proof. They remain in ignored local failure evidence; only the corrected production-modal captures appear here. Native devices, physical wake and a historical production-session continuation remain separate proof boundaries.

## 1440 px, light

[New Chat draft retained after failed send and retry](group16-preparation-retry-1440-light.png)

[Archive row restored after failed transport](archive-rollback-header-ordinary-light-1440.png)

[ToolView image preview through the actual ModalProvider and CustomModal host](attachment-preview-ToolView-light-1440.png)

## 1440 px, dark

[New Chat draft retained after failed send and retry](group16-preparation-retry-1440-dark.png)

[Archive row restored after failed transport](archive-rollback-header-ordinary-dark-1440.png)

[ToolView image preview through the actual ModalProvider and CustomModal host](attachment-preview-ToolView-dark-1440.png)

## 390 px, light

[New Chat draft retained after failed send and retry](group16-preparation-retry-390-light.png)

[Archive row restored after failed transport](archive-rollback-header-ordinary-light-390.png)

[ToolView image preview through the actual ModalProvider and CustomModal host](attachment-preview-ToolView-light-390.png)

## 390 px, dark

[New Chat draft retained after failed send and retry](group16-preparation-retry-390-dark.png)

[Archive row restored after failed transport](archive-rollback-header-ordinary-dark-390.png)

[ToolView image preview through the actual ModalProvider and CustomModal host](attachment-preview-ToolView-dark-390.png)
