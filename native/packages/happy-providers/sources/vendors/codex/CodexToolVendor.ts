export type CodexToolVendor =
    | { readonly provider: "codex"; readonly type: "function_call" }
    | { readonly provider: "codex"; readonly type: "custom_tool_call" }
    | {
          readonly provider: "codex";
          readonly type: "tool_search_call";
          readonly execution: "client";
      };

/** Internal metadata attached only to captured Codex reference descriptors. */
export type CodexToolDefinitionVendor =
    | {
          readonly provider: "codex";
          readonly type: "function";
          readonly defer?: boolean;
      }
    | {
          readonly provider: "codex";
          readonly type: "tool_search";
          readonly execution: "client";
      };
