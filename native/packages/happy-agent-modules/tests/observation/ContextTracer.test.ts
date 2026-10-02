import { describe, expect, it, vi } from "vitest";
import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";

import {
    ContextTracer,
    OpenTelemetryTraceSpan,
} from "../../sources/observation/impl/ContextTracer.js";

function fakeSpan() {
    return {
        setAttributes: vi.fn(),
        recordException: vi.fn(),
        setStatus: vi.fn(),
        end: vi.fn(),
        spanContext: vi.fn(() => ({
            traceId: "0123456789abcdef0123456789abcdef",
            spanId: "0123456789abcdef",
            traceFlags: 1,
            isRemote: false,
        })),
    } as unknown as Span & {
        setAttributes: ReturnType<typeof vi.fn>;
        recordException: ReturnType<typeof vi.fn>;
        setStatus: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
        spanContext: ReturnType<typeof vi.fn>;
    };
}

describe("OpenTelemetryTraceSpan", () => {
    it("sets successful status and ends exactly once", () => {
        const span = fakeSpan();
        const wrapped = new OpenTelemetryTraceSpan(span);

        wrapped.end();
        wrapped.end();
        wrapped.setAttributes({ afterEnd: true });
        wrapped.recordException(new Error("late"));

        expect(span.setStatus).toHaveBeenCalledTimes(1);
        expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
        expect(span.end).toHaveBeenCalledTimes(1);
        expect(span.setAttributes).not.toHaveBeenCalled();
        expect(span.recordException).not.toHaveBeenCalled();
    });

    it("records an Error and emits an error status before ending", () => {
        const span = fakeSpan();
        const wrapped = new OpenTelemetryTraceSpan(span);
        const error = new Error("failed");

        wrapped.recordException(error);
        wrapped.end();

        expect(span.recordException).toHaveBeenCalledWith(error);
        expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR });
        expect(span.end).toHaveBeenCalledTimes(1);
    });

    it("stringifies non-Error exceptions for the exporter", () => {
        const span = fakeSpan();
        const wrapped = new OpenTelemetryTraceSpan(span);

        wrapped.recordException({ reason: "failed" });

        expect(span.recordException).toHaveBeenCalledWith("[object Object]");
    });

    it("does not let a hostile exception value escape recording", () => {
        const span = fakeSpan();
        const wrapped = new OpenTelemetryTraceSpan(span);
        const hostile = {
            toString() {
                throw new Error("toString failed");
            },
        };

        expect(() => wrapped.recordException(hostile)).not.toThrow();
        expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR });
    });
});

describe("ContextTracer", () => {
    it("starts a span with no parent when none is provided", () => {
        const span = fakeSpan();
        const startSpan = vi.fn((_name: string, _options: unknown, _context: unknown) => span);
        const tracer = new ContextTracer({ startSpan } as never);

        const result = tracer.startSpan("agent.turn", undefined);

        expect(result).toBeInstanceOf(OpenTelemetryTraceSpan);
        expect(startSpan).toHaveBeenCalledWith("agent.turn", undefined, expect.anything());
        const context = startSpan.mock.calls[0]?.[2];
        expect(context).toBeDefined();
        expect(trace.getSpan(context as Parameters<typeof trace.getSpan>[0])).toBeUndefined();
    });

    it("preserves the parent context for spans created by this tracer", () => {
        const parentSpan = fakeSpan();
        const childSpan = fakeSpan();
        const startSpan = vi
            .fn((_name: string, _options: unknown, _context: unknown) => childSpan)
            .mockReturnValueOnce(parentSpan)
            .mockReturnValueOnce(childSpan);
        const tracer = new ContextTracer({ startSpan } as never);

        const parent = tracer.startSpan("parent", undefined);
        tracer.startSpan("child", parent);

        const parentContext = startSpan.mock.calls[1]?.[2];
        expect(parentContext).toBeDefined();
        expect(
            trace.getSpan(parentContext as Parameters<typeof trace.getSpan>[0])?.spanContext(),
        ).toEqual(parentSpan.spanContext());
    });
});
