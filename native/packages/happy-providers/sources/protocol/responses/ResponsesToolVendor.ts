export type ResponsesToolCallType = "function_call" | "custom_tool_call" | "tool_search_call";

export type ResponsesToolVendor = {
    readonly provider: "codex" | "grok" | "responses";
    readonly type: ResponsesToolCallType;
    readonly execution?: "client";
};
