# HappyHerd interface localization

HappyHerd has one JSON-backed interface-copy contract and three supported languages:

- `locales/en.json` — canonical key, shape, select-case, and placeholder schema
- `locales/cn.json` — Chinese
- `locales/de.json` — German

The runtime maps `zh`, `zh-CN`, `zh-Hans`, and legacy Chinese preferences to `cn`; `de-DE` to `de`; and unsupported locales to English. A user preference change takes effect immediately and persists through synchronized settings. Missing translated keys fall back per key to English.

## Adding or changing interface copy

1. Add the same nested key to `en.json`, `cn.json`, and `de.json`.
2. Use `t('path.to.key')` in the interface. For placeholders, use JSON-safe `{name}` syntax and call `t('path.to.key', { name })`.
3. For plural or boolean branches, use this JSON shape in every catalog:

```json
{
  "select": {
    "param": "count",
    "cases": {
      "one": "{count} item",
      "other": "{count} items"
    }
  }
}
```

4. Generate the TypeScript key/parameter contract and validate everything:

```bash
pnpm --filter happy-app i18n:generate
pnpm --filter happy-app i18n:check
pnpm --filter happy-app typecheck
```

`generated.ts` is generated and must not be edited manually. CI rejects missing/extra keys, select-shape drift, placeholder drift, stale generated types, and newly hardcoded interface copy.

## UI surface inventory

The UI tree is source-generated rather than maintained as a second manual map:

- `ui-surface-inventory.json` is the versioned machine-readable route and UI-owner inventory.
- `ui-tree.html` is its human-readable route, state, and critical-smoke view.
- `scripts/ui-source-analysis.mjs` scans production `.ts` and `.tsx` with the TypeScript AST, including JSX text, visible props, UI descriptors, alerts/modals, accessibility copy, and dynamic fragments.
- The critical smoke contract covers en/cn/de × mobile/desktop × light/dark for new session, session, workspace, automations, account, and composer surfaces.

Regenerate after adding, removing, or renaming a route or UI-owning module:

```bash
pnpm --filter happy-app ui:inventory:generate
pnpm --filter happy-app i18n:check
```

CI compares both generated artifacts byte-for-byte with current source and fails drift. Do not hand-edit either artifact, create a parallel Storybook-only UI tree, or add a hardcoded-copy allowlist.

If a translated value intentionally equals English because it is a proper name, provider/model slug, command, path, filename, or standard technical token, record the exact locale/key and a specific reason in `semantic-exemptions.json`. The validator rejects silent equality, unknown exemptions, duplicates, and stale exemptions.

## What must remain untranslated

Do not pass raw user or machine data through `t()`: provider/model slugs, file paths, commands, logs, protocol values, user messages, and content returned by agents remain byte-faithful. Only the labels and explanatory copy around that data are localized.
