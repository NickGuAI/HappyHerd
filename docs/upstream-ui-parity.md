# Upstream UI parity record

HappyHerd's interface now departs from the one it inherits from upstream Happy
(`slopus/happy`). This record lists every inherited screen, component and style
the overhaul replaces or modifies, the HappyHerd file that now owns the
behavior, what stayed compatible, and how to carry a future upstream change into
the new design. Follow it during every upstream merge (see the
`happyherd-sync-upstream` skill); update it in the same pull request as any UI
change that touches an inherited file.

- **Upstream base for this record:** `4b7d763ee3afda04985f3210b9cb9acf9359c7d9`
  (the most recent upstream commit merged into `main` when the overhaul began).
- **Path mapping:** upstream `packages/happy-app/sources/<path>` is HappyHerd
  `server/packages/happyherd-app/sources/<path>`.
- **Check provenance of a file** (prints `upstream` when the path exists
  upstream):

  ```bash
  U=4b7d763ee3afda04985f3210b9cb9acf9359c7d9
  f='components/SidebarView.tsx'
  git cat-file -e "$U:packages/happy-app/sources/$f" 2>/dev/null && echo upstream || echo happyherd
  ```

## Merge procedure for inherited UI files

1. For each upstream commit that touches a file listed below, read its row
   first. The row says whether the file is **Replaced** (HappyHerd renders its
   own component; the upstream file is no longer on the user's path),
   **Restyled** (same structure and behavior, HappyHerd styles), or
   **Extended** (upstream structure kept, HappyHerd adds elements or props).
2. **Behavior first, styling second.** Accept upstream logic, data flow, props,
   accessibility and bug fixes. Re-apply the HappyHerd visual treatment named in
   the row instead of taking upstream styling. Never reintroduce hard-coded
   radii, colors or durations that the overhaul replaced with tokens.
3. For **Replaced** files, port the upstream behavior change into the named
   HappyHerd owner, then keep the upstream file compiling (it may still be
   imported elsewhere) or delete its unused parts only in a dedicated commit.
4. Keep HappyHerd-only files (listed under *HappyHerd-owned modules*) out of
   upstream conflict resolution; upstream never edits them.
5. After resolving, run the checks in `.dev/VERIFY.md` for the touched surfaces
   and refresh the KILV goldens when rendering changes.

## Shared foundation

| Inherited file | Status | HappyHerd change | Kept compatible | Porting future upstream changes |
|---|---|---|---|---|
| `sources/theme.ts` | Restyled | `borderRadius` scale is now `sm 6, md 8, lg 10, xl 12, xxl 14` (was 4/4/4/6/6); `kilv.radius` 8 and `kilv.radiusCard` 12; new `kilv.radiusSheet`, `kilv.radiusPill`; motion scale `kilv.motionFast/Base/Slow` and `kilv.easeOut/InOut/In`; new `colors.selection { border, background, ring }`. | Every existing token name and color value; `kilv.motion` (150 ms) still exists for current callers. | Take new upstream tokens by name. If upstream changes a radius or motion value, keep HappyHerd's value; if upstream adds a new semantic color, add it to both KILV palettes. Regenerate `theme.light.json` and `theme.dark.json` with `pnpm exec tsx sources/theme.gen.ts`. |
| `sources/theme.css` | Extended | Adds the fluid-motion layer: `herd-*` keyframes and classes, stagger steps `herd-d1`…`herd-d10`, `herd-transition`, `herd-glide`, and a reduced-motion block that disables all of them. | All existing global rules (scrollbars, Pierre diff reset, session-title shimmer, focus rings, 16 px phone inputs). | Keep the `herd-*` block together and after upstream rules; merge upstream global rules above it. `components/herd/motion.test.ts` fails if a class used in code is missing here. |

## HappyHerd-owned modules

These files do not exist upstream; upstream merges never conflict with them.

| File | Purpose |
|---|---|
| `sources/components/herd/motion.ts` | Motion scale and helpers (`HERD_MOTION`, `herdWebClasses`, `herdStaggerClass`) for applying the CSS motion classes through Unistyles `_web._classNames`. |
| `sources/components/herd/motion.test.ts` | Guards the motion classes, reduced-motion coverage and the overhaul tokens in both themes. |
| `sources/components/herd/SegmentedControl.tsx` | Equal-width segmented control with a sliding selection thumb. |
