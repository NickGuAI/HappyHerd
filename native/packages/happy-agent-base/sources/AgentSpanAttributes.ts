import { traceSpan, type Context } from "@steve.kite/stdlib";

/** Values that OpenTelemetry accepts as one span attribute. */
export type AgentSpanAttributeValue =
    | string
    | number
    | boolean
    | readonly (string | number | boolean)[];

/** Attributes Agent Base adds to the span currently carried by a context. */
export type AgentSpanAttributes = Readonly<Record<string, AgentSpanAttributeValue>>;

/**
 * Add attributes when the installed tracer supports them. Stdlib tracing deliberately has a
 * minimal common span contract, so tracers that only record nesting remain fully supported.
 */
export function setAgentSpanAttributes(ctx: Context, attributes: AgentSpanAttributes): void {
    const span = traceSpan.get(ctx) as
        | { setAttributes?: (attributes: AgentSpanAttributes) => void }
        | undefined;
    if (typeof span?.setAttributes === "function") span.setAttributes(attributes);
}
