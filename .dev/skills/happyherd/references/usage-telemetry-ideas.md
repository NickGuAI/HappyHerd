# Usage telemetry and e-ink design ideas

**Deliberately not imported:** the source repository's FastAPI dashboard,
cache files, refresh service, cross-machine ingest, hardware firmware, network
configuration, credential discovery, direct runtime-database/log scraping, and
private provider endpoints or wire decoders. The source relies on fragile
private interfaces; these notes must never become a parallel HappyHerd
dashboard, telemetry collector, quota poller, or control plane.

Use these ideas only to evolve HappyHerd's existing cost, usage, and quota
owners. Current authority stays with provider-emitted session data in
`server/packages/happy-cli/src/api/apiSession.ts`, persisted usage reports and
aggregation in `server/packages/happy-server/sources/app/api/routes/accountRoutes.ts`,
the app query/projection in `server/packages/happy-app/sources/sync/apiUsage.ts`,
and account-scoped quota ownership described in `.dev/COUPLINGS.md`.

## Canonical aggregation ideas

Normalize provider observations before aggregation. A useful internal record
keeps:

- provider, provider account, model, session, source kind, and stable event or
  report identity;
- observed-at time, aggregation timezone, and half-open time window;
- input, output, cache-read, cache-write, reasoning, and total tokens without
  fabricating unavailable dimensions;
- observed or estimated cost, currency, pricing revision, and estimation
  method;
- availability, completeness, and freshness instead of treating missing data
  as observed zero.

Add totals only after defining overlap and deduplication. Merge independently
owned sources; never sum two views of the same provider traffic. Preserve the
raw provider/model labels around normalized numeric fields, and expose an
`other` bucket rather than silently dropping a new provider.

Keep collection, normalization, aggregation, and presentation separable:

```text
provider-native event -> HappyHerd normalization -> existing usage owner
                                                -> app/e-ink projection
```

One typed, versioned projection can carry `generated_at`, range and timezone,
currency/pricing metadata, summary totals, ordered daily buckets, and quota
windows. Boundary readers may tolerate an older partial shape, but canonical
state must preserve unknown versus zero.

## Quota normalization ideas

Represent each window with provider account, stable window identity, raw and
display labels, used and remaining values or percentages, reset epoch, reset
ISO time, observation time, and source status. Clamp display percentages to
0–100 while retaining enough raw meaning to diagnose changed provider units.
Unknown window codes should remain visible with a generic label.

HappyHerd's existing reactive, account-scoped limit flow remains authoritative:
do not add background polling, merge snapshots across accounts, or fetch
credentials from provider stores. If the native provider does not emit a
supported value, show it as unavailable rather than reverse-engineering a
private interface.

## E-ink presentation ideas

Treat e-ink as a low-refresh projection of the same HappyHerd state, not a new
service:

- bound daily rows and quota bars to the surface capacity, and truncate
  deterministically;
- offer local 7-day/30-day view changes without a provider fetch;
- make any explicitly approved refresh call the existing HappyHerd owner and
  serialize concurrent refreshes there;
- show generated time, window, units, and stale/unavailable state; retain the
  last valid display only when its age is visible;
- use compact totals, stacked provider bars, quota fill, and reset countdowns;
- clamp scale and fill math so empty or malformed values cannot overflow the
  display.

Mirror display-only calculations in pure host-side functions and render a
simulator/snapshot before hardware validation. Contract tests should cover
schema versioning, partial payloads, ordering, bounds, percent clamping, reset
countdowns, local-only view toggles, refresh serialization, and stale fallback
labeling. Hardware secrets and device identifiers never enter fixtures.

## Fragile source warning

The source mixes supported exports with browser cookies, stored OAuth material,
private web endpoints, inferred protobuf fields, process-argument tokens, live
IDE services, and internal SQLite/session formats. Those mechanisms are useful
evidence that quota normalization needs source status and drift tests; they are
not implementation candidates for HappyHerd. Prefer native provider events or
documented APIs, and fail visibly when neither exists.

## Source evidence

- `/home/ec2-user/App/external-projects/grapeot-repos/ai_usage_dashboard/auto_usage.py`
- `/home/ec2-user/App/external-projects/grapeot-repos/ai_usage_dashboard/dashboard_models.py`
- `/home/ec2-user/App/external-projects/grapeot-repos/ai_usage_dashboard/local_display_service.py`
- `/home/ec2-user/App/external-projects/grapeot-repos/ai_usage_dashboard/firmware_logic.py`
- `/home/ec2-user/App/external-projects/grapeot-repos/ai_usage_dashboard/grok_usage.py`
- `/home/ec2-user/App/external-projects/grapeot-repos/ai_usage_dashboard/eink/e1002/dashboard_types.h`
- `/home/ec2-user/App/external-projects/grapeot-repos/ai_usage_dashboard/eink/e1002/dashboard_logic.h`
- `/home/ec2-user/App/external-projects/grapeot-repos/ai_usage_dashboard/eink/e1002/dashboard_network.h`
- `/home/ec2-user/App/external-projects/grapeot-repos/ai_usage_dashboard/tests/test_dashboard_models.py`
- `/home/ec2-user/App/external-projects/grapeot-repos/ai_usage_dashboard/tests/test_firmware_logic.py`
- `/home/ec2-user/App/external-projects/grapeot-repos/ai_usage_dashboard/tests/test_local_display_service.py`
