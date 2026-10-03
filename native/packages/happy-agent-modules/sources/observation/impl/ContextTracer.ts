import {
    ROOT_CONTEXT,
    SpanStatusCode,
    trace,
    type Attributes,
    type Span,
    type Tracer as OpenTelemetryTracer,
} from "@opentelemetry/api";
import type { TraceSpan, Tracer as StdlibTracer } from "@steve.kite/stdlib";

/**
 * The stdlib tracer that `ctx.span` uses, backed by OpenTelemetry.
 *
 * Installing this on the application root is what turns every `ctx.span(name, work)` in the
 * product into an exported span, without any of those call sites knowing OpenTelemetry exists.
 */
export class ContextTracer implements StdlibTracer {
    constructor(private readonly tracer: OpenTelemetryTracer) {}

    startSpan(name: string, parent: TraceSpan | undefined): TraceSpan {
        const parentContext =
            parent instanceof OpenTelemetryTraceSpan
                ? trace.setSpan(ROOT_CONTEXT, parent.span)
                : ROOT_CONTEXT;
        return new OpenTelemetryTraceSpan(this.tracer.startSpan(name, undefined, parentContext));
    }
}

/** One OpenTelemetry span presented as a stdlib `TraceSpan`, ended exactly once. */
export class OpenTelemetryTraceSpan implements TraceSpan {
    #ended = false;
    #failed = false;

    constructor(readonly span: Span) {}

    setAttributes(attributes: Attributes): void {
        if (this.#ended) return;
        this.span.setAttributes(attributes);
    }

    recordException(error: unknown): void {
        if (this.#ended) return;
        this.#failed = true;
        this.span.recordException(error instanceof Error ? error : describeException(error));
        this.span.setStatus({ code: SpanStatusCode.ERROR });
    }

    end(): void {
        if (this.#ended) return;
        this.#ended = true;
        if (!this.#failed) this.span.setStatus({ code: SpanStatusCode.OK });
        this.span.end();
    }
}

/**
 * What a thrown value that is not an `Error` is called on the span.
 *
 * Whatever failed is already the problem being recorded; a value whose own `toString` throws must
 * not become a second, louder failure in the middle of reporting the first.
 */
function describeException(error: unknown): string {
    try {
        return String(error);
    } catch {
        return "An exception that cannot describe itself.";
    }
}
