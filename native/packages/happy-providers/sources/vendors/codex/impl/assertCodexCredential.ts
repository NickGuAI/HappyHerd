import { isBedrockCredential, type CodexProviderCredential } from "@/vendors/VendorCredential.js";

export function assertCodexCredential(value: unknown): asserts value is CodexProviderCredential {
    if (
        typeof value === "object" &&
        value !== null &&
        "name" in value &&
        ((value as { name: unknown }).name === "codex-api-key" ||
            (value as { name: unknown }).name === "codex-session" ||
            isBedrockCredential(value))
    )
        return;
    throw new Error(
        "CodexProvider requires a Codex API key, Codex session, or Bedrock credential.",
    );
}
