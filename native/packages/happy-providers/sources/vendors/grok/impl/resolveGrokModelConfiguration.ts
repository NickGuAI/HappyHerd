import type { SessionContext } from "@/core/SessionContext.js";
import type { SessionModelConfiguration } from "@/core/SessionModelConfiguration.js";
import type { SessionTool } from "@/core/SessionTool.js";

export function resolveGrokModelConfiguration(options: {
    context: SessionContext;
    defaultTools: readonly SessionTool[];
    modelConfiguration?: SessionModelConfiguration;
}): { context: SessionContext; tools: readonly SessionTool[] } {
    const configuration = options.modelConfiguration;
    return {
        context: {
            instructions: configuration?.instructions ?? options.context.instructions,
            messages: options.context.messages,
        },
        tools: configuration?.tools ?? options.defaultTools,
    };
}
