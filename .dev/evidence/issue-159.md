# Evidence: Issue #159 attachment picker verification

- **Wide viewport (1440×900):** [issue-159-wide.png](issue-159-wide.png)
  - Captured from an `APP_ENV=production` Expo web export of the exact attachment-picker implementation using a temporary component-only route that was removed before commit.
  - Shows the branded attachment popover anchored to the attachment control, opening above the low trigger while remaining fully within the viewport.
- **Narrow viewport (390×844):** [issue-159-narrow.png](issue-159-narrow.png)
  - Captured under identical production web export conditions to verify the narrow layout.
  - Shows the branded popover anchored properly, opening upward, and staying fully inside the viewport.
- **Native verification:**
  - Native visual capture was not locally practical because no simulator or emulator was used.
  - Native platform behavior and rendering are deterministically verified by `AttachmentInputButton.test.ts`, covering the safe-area-aware bottom sheet, 34 px bottom inset, native Back handler, backdrop dismissal, accessible labels, focus management, exact action handlers, and light/dark theme tokens.
