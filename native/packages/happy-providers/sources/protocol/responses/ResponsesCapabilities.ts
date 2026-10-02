export interface ResponsesCapabilities {
    readonly encryptedReasoning: boolean;
    readonly parallelToolCalls: boolean;
    readonly reasoning: boolean;
    readonly textVerbosity: boolean;
}

export const OPENAI_RESPONSES_CAPABILITIES: ResponsesCapabilities = {
    encryptedReasoning: true,
    parallelToolCalls: true,
    reasoning: true,
    textVerbosity: true,
};

export const MINIMAL_RESPONSES_CAPABILITIES: ResponsesCapabilities = {
    encryptedReasoning: false,
    parallelToolCalls: false,
    reasoning: false,
    textVerbosity: false,
};
