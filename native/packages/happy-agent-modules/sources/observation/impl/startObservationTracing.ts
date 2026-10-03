import { randomUUID } from "node:crypto";

import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
    ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
    ATTR_SERVICE_INSTANCE_ID,
    ATTR_SERVICE_NAME,
    ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import type { Tracer as StdlibTracer } from "@steve.kite/stdlib";

import { ContextTracer } from "./ContextTracer.js";

/** The instrumentation scope every span the agent produces belongs to. */
export const OBSERVATION_TRACER_NAME = "happy.agent";

const TRACE_EXPORT_DELAY_MS = 100;
const TRACE_EXPORT_BATCH_SIZE = 4_096;
const TRACE_EXPORT_QUEUE_SIZE = 65_536;
/** How long a collector has to accept the final batch before shutdown stops waiting for it. */
const TRACE_SHUTDOWN_GRACE_MS = 500;

export interface ObservationTracingOptions {
    /** Where finished spans are posted, as OTLP over HTTP. */
    readonly endpoint: string;
    /** The deployment this agent is running as, such as `production` or `local-development`. */
    readonly deployment: string;
    /** The agent's own version, as the person running it would recognize it. */
    readonly version: string;
}

export interface ObservationTracing {
    /** The tracer as stdlib sees it, for installing on the application root. */
    readonly contextTracer: StdlibTracer;
    shutdown(): Promise<void>;
}

/**
 * Start collecting spans and exporting them to a local OpenTelemetry collector.
 *
 * This owns a provider of its own rather than registering a process-global one. Nothing else in
 * the agent competes for that global, and a library that quietly took it would decide tracing for
 * every host that ever embeds the agent.
 */
export function startObservationTracing(options: ObservationTracingOptions): ObservationTracing {
    const resource = resourceFromAttributes({
        [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: options.deployment,
        [ATTR_SERVICE_INSTANCE_ID]: randomUUID(),
        [ATTR_SERVICE_NAME]: "happy-agent",
        [ATTR_SERVICE_VERSION]: options.version,
    });
    const provider = new NodeTracerProvider({
        resource,
        spanProcessors: [
            new BatchSpanProcessor(new OTLPTraceExporter({ url: options.endpoint }), {
                // A busy agent produces bursts of short spans, and a parent always ends after its
                // children. Export often enough that a complete trace survives the burst, while
                // keeping the queue itself firmly bounded.
                maxExportBatchSize: TRACE_EXPORT_BATCH_SIZE,
                maxQueueSize: TRACE_EXPORT_QUEUE_SIZE,
                scheduledDelayMillis: TRACE_EXPORT_DELAY_MS,
            }),
        ],
    });
    return {
        contextTracer: new ContextTracer(provider.getTracer(OBSERVATION_TRACER_NAME)),
        shutdown: async () => {
            // Telemetry is optional. A collector that is not listening must not turn an otherwise
            // clean shutdown into a failure, and must not hold one up either: the provider is given
            // a moment to post what it still holds and then left to settle on its own.
            const settled = provider.shutdown().catch(() => undefined);
            await Promise.race([settled, grace(TRACE_SHUTDOWN_GRACE_MS)]);
        },
    };
}

/** A delay that never keeps the process alive on its own account. */
async function grace(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds).unref();
    });
}
