# `/automations` production profiling

This procedure attributes `/automations` latency before any performance fix is
proposed. It records method names, outcomes, and durations only. It never
records machine or session IDs, RPC parameters, paths, credentials, user
content, or encrypted payloads.

## Evidence surfaces

| Segment | Evidence |
|---|---|
| Public static HTTP | `curl` timing for `/health` and `/automations` |
| Browser RPC and route total | `happyherd.automations.*` Performance measures |
| Server lookup and daemon round trip | Private Prometheus RPC histograms |
| Server p50/p95/max and timeout count | `rpcSlowest*` fields in the retained 30-second server summary |
| Daemon handler time | `[AUTOMATIONS_PROFILE]` lines in the daemon log |
| React commit after data is ready | `happyherd.automations.render.commit.success` |

The server metrics listener is available only inside the self-host container at
`127.0.0.1:9090`; the deployment publishes only the application port.

## Capture one profile

Record public static timing separately from authenticated page work:

```bash
for path in health automations; do
  curl --fail --silent --show-error --output /dev/null --max-time 10 \
    --write-out "$path code=%{http_code} total=%{time_total} starttransfer=%{time_starttransfer}\n" \
    "https://happyherd.gehirn.ai/$path"
done
```

Before loading the page, clear prior browser measures in Web DevTools:

```js
performance.clearMeasures()
```

Open `/automations` once and wait for loading to finish. Then paste this into
the same console to summarize the bounded measures:

```js
const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0
}
const groups = performance.getEntriesByType('measure')
  .filter(({ name }) => name.startsWith('happyherd.automations.'))
  .reduce((result, entry) => {
    const [, , stage, operation, outcome] = entry.name.split('.')
    const key = `${stage}.${operation}`
    const group = result[key] ??= { durations: [], errors: 0 }
    group.durations.push(entry.duration)
    if (outcome === 'error') group.errors += 1
    return result
  }, {})
console.table(Object.entries(groups).map(([name, group]) => ({
  name,
  calls: group.durations.length,
  errors: group.errors,
  p50_ms: percentile(group.durations, 0.50).toFixed(1),
  p95_ms: percentile(group.durations, 0.95).toFixed(1),
  max_ms: Math.max(...group.durations).toFixed(1),
})))
```

On the server host, scrape only the private listener and read the retained
summary:

```bash
sudo docker exec happyherd curl --fail --silent --show-error \
  http://127.0.0.1:9090/metrics \
  | rg '^rpc_(calls_total|call_duration_seconds|lookup_retries|fetchsockets_timeouts)'

sudo rg 'rpcSlowest=' /var/log/happyherd/server.log | tail -n 10
sudo docker port happyherd
```

The last command must show the application port only; port 9090 must not be
published. On each machine represented on the page, use the supported daemon
command to find its current log and inspect the handler boundary:

```bash
daemon_log="$(happyherd daemon logs)"
rg '\[AUTOMATIONS_PROFILE\]' "$daemon_log" | tail -n 20
```

For an isolated page load, compare the matching method samples:

- browser RPC minus server RPC is browser encryption and browser-to-server transit;
- server RPC minus daemon handler time is lookup, server-to-daemon transit, and response transit;
- `render.commit` is React work after automation data becomes ready;
- `route.total` is the user-visible route total.

Do not subtract concurrent method aggregates as if they were a single trace.
Use the p50/p95/max distributions to name the slowest method.

## Restart verification

After deploying an instrumented image, restart the existing service and verify
that the listener returns and the append-only server log remains readable:

```bash
sudo systemctl restart happyherd.service
sudo docker exec happyherd curl --fail --silent --show-error \
  http://127.0.0.1:9090/metrics \
  | rg '^rpc_call_duration_seconds'
sudo tail -n 40 /var/log/happyherd/server.log
```

Metrics counters restart with the process. Historical 30-second summaries stay
in `/var/log/happyherd/server.log`; daemon timing stays in the daemon logs
reported by `happyherd daemon logs`.

## Pre-instrumentation baseline — 2026-08-25 UTC

Three public samples against `https://happyherd.gehirn.ai` produced:

| Path | p50 | p95 | max |
|---|---:|---:|---:|
| `/health` | 14.271 ms | 15.176 ms | 15.176 ms |
| `/automations` HTML | 13.147 ms | 13.548 ms | 13.548 ms |

The running image exposed no listener at container loopback port 9090, and the
browser/server/daemon segments were therefore unavailable. No dynamic
bottleneck or performance improvement is claimed from this baseline. Capture
the first complete baseline only after the instrumented server image and daemon
are deployed.
