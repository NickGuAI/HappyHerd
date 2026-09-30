# Full authenticated Inbox acceptance — PASS

[Run 36779331859](https://github.com/NickGuAI/HappyHerd/actions/runs/36779331859/job/110105150356)
completed the real Desktop, Mobile Web and installed iOS simulator journey at
`d197a1be1d423a5ea644818cf63ba7818c37231e`, from
`2026-09-30T21:30:03.259Z` to `2026-09-30T21:58:52.573Z`.
XCTest passed **1 test, 0 failures, 0 skips**. All 15 controller stages,
13 Web stages and 16 ordered native checkpoints passed. All 35 original PNGs
(18 native, 13 Web and 4 Web/native companion captures) were independently
reviewed directly for expected UI and publication privacy.

This is an actual successful execution, not a claim that the earlier Logout
crash was fixed. [All 19 earlier failures](../failed-attempts.json) remain intact.
Attempt 19 established an owned `EXC_BAD_ACCESS` / `SIGSEGV` after Logout; its
underlying faulty code is still unknown. Attempt 20 used the same product bytes
and collected no crash report. The additive diagnostics run after the journey;
they are not a product correction or an explanation for this pass.

## Evidence and original criteria

| Required behavior | Passing evidence |
| --- | --- |
| Done, bell indicator and per-card dots | Normal native gestures; exact account snapshot persisted; captures 01, 03, 05–08 and 15 show unread/read transitions. |
| Single-item read and navigation | Checkpoint 02 changes only the selected item; normal navigation reaches the Automations screen. |
| Reload and persistent read state | Checkpoints 04 and 16 retain the acknowledged read timestamps through actual app relaunch. |
| Account isolation | Three normal public-QR links A → B → A; ordinary Logout twice; checkpoints 09–11 show separate feeds and read states. |
| Arrival while native Done is pending | Exactly one real native read request held/released; native observes Done disabled and the new update before release; checkpoint 12 preserves the newer unread cursor. |
| Durable server restart and reconnect | Two isolated server restarts total, retaining PGlite data and master secret; browsers offline during the native restart, sole native socket closes and a new socket connects; checkpoints 13–14 prove restart and new native delivery before Web resumes; 15–16 prove read persistence afterward. |
| Real transport and authentication | Actual HTTP/Socket.IO and normal Web Restore/native QR linking; no injected auth/read state or fabricated server response. |
| Resources and cleanup | Original 10 GiB disk/15% memory floors retained; minimum disk 90,081,320,960 bytes and memory 20%; owned simulator shutdown/delete both exit 0 and isolated server exits cleanly. |

Direct records: [controller](proof/controller.json),
[native XCTest receipt](proof/native/1790803826340113000/receipt.json),
[native transport/checkpoints](proof/native/native-transport.json),
[Web receipt](proof/web/web-acceptance.json), [server](proof/server.json),
[original proof manifest](proof/proof-manifest.json),
[native captures](proof/native/1790803826340113000/png), [Web captures](proof/web),
[companion captures](proof/web-native), and [independent audits](reviews).
The proof manifest SHA-256 is `825c9e28c58eed4470f3494cc00cd890e53494da7cbd375f1c275d98b471f569`.

The simulator is a new private iPhone 17 on iOS 26.2, selected against Xcode 26.2.
This is not physical-device evidence. The live feed fixture is the supported
`automation_blocked` kind; provider/daemon execution is outside this journey.
Other notification kinds retain their separate focused regression coverage.

## Artifact provenance

The normally signed native app was built at
`4933c0c727b08f2dbe7f90ae5e261d89a917e0de`
([build run](https://github.com/NickGuAI/HappyHerd/actions/runs/36733047107)).
Its complete `server/` product tree equals the journey source:
`e8a2fb1ad9756a56306354861f3d62b73f5f6eb8`.
All 736 selected files, exact installed contents, required framework modes,
critical hashes and strict signature checks passed. Simulator installation had
changed six framework executable modes; preparation restored only those selected
archive modes after verifying all bytes/types/links, then repeated all-file and
strict signature verification. No content was changed or re-signed. Archive SHA-256:
`0a692dee476bc6fb12a79879a75fb7865c7ace0c2c3ab4960b90b26cc1d762b5`.
The retained [build manifest](../../native-signed-build-manifest.json),
[signing receipt](../../native-signed-signing-receipt.json) and three app receipts
inside `proof/` preserve that provenance. Later evidence-only commits do not
relabel the actual tested source SHA.

## Durable storage and reproduction

All 46 proof files are retained here, independently of the expiring
[hosted artifact 11127794140](https://github.com/NickGuAI/HappyHerd/actions/runs/36779331859/artifacts/11127794140).
All PNGs and the original execution manifest are byte-identical to the download.
Only `native-app-archive.json` and `native-app-extracted.json` encode the public
asset-name at-sign as a JSON Unicode escape to avoid the repository's email
scanner. [Storage metadata](storage-encoding.json) records original/stored hashes,
byte counts and the exact reversible transformation. JSON values are unchanged;
reconstruction matches the original execution manifest byte-for-byte. Downloaded
originals remain untouched. No public-boundary exception was added.

From the repository root, validate the durable copy without ignored artifacts:

```sh
python3 docs/acceptance/issue-345/hosted-native/audit-proof.py \
  --artifact docs/acceptance/issue-345/hosted-native/pass-d197a1be/proof \
  --source-sha d197a1be1d423a5ea644818cf63ba7818c37231e
```

This read-only auditor checks the exact file set, reconstructed original hashes,
source/build identity and every required receipt assertion. It does not replace
actual execution or the separate direct visual/privacy review.
The retained [journey workflow](../../native-journey-workflow.yml),
[normal build workflow](../../native-signed-build-workflow.yml),
[driver/controller and diagnostic recipe](../README.md) reproduce the original
journey. Temporary active workflow copies were removed only after this complete
proof was preserved; no assertion, deadline, screenshot, threshold or skip was
changed. The build archive itself remains identified by its immutable hash and
hosted build receipt; a future rebuilt app must get new provenance rather than
claiming identical executable bytes.

At the tested head, [six required gates, four installers, image and 28
zero-difference goldens](tested-head-ci.json) passed on their first attempts.
The final evidence/workflow-removal head requires its own independent review and
fresh CI, installers, image and goldens. The existing issue handoff records those
final results and current-main/MERGEABLE/CLEAN verification; no merge, issue
closure, deployment or shared production restart is part of this delivery.
