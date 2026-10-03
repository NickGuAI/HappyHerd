import type { BedrockAwsCredential } from "@/vendors/bedrock/BedrockAwsCredential.js";
import type { BedrockBearerTokenCredential } from "@/vendors/bedrock/BedrockBearerTokenCredential.js";
import type { ClaudeApiKeyCredential } from "@/vendors/claude/ClaudeApiKeyCredential.js";
import type { ClaudeAuthTokenCredential } from "@/vendors/claude/ClaudeAuthTokenCredential.js";
import type { ClaudeCodeCredential } from "@/vendors/claude/ClaudeCodeCredential.js";
import type { ClaudeOAuthCredential } from "@/vendors/claude/ClaudeOAuthCredential.js";
import type { CodexApiKeyCredential } from "@/vendors/codex/CodexApiKeyCredential.js";
import type { CodexSessionCredential } from "@/vendors/codex/CodexSessionCredential.js";
import type { GeminiApiKeyCredential } from "@/vendors/gemini/GeminiApiKeyCredential.js";
import type { GrokApiKeyCredential } from "@/vendors/grok/GrokApiKeyCredential.js";
import type { GrokSessionCredential } from "@/vendors/grok/GrokSessionCredential.js";

export type BedrockCredential = BedrockAwsCredential | BedrockBearerTokenCredential;

export type ClaudeCredential =
    | ClaudeApiKeyCredential
    | ClaudeAuthTokenCredential
    | ClaudeCodeCredential
    | ClaudeOAuthCredential;

export type AnthropicCredential = BedrockCredential | ClaudeCredential;

export type CodexCredential = CodexApiKeyCredential | CodexSessionCredential;

export type CodexProviderCredential = BedrockCredential | CodexCredential;

export type GeminiCredential = GeminiApiKeyCredential;

export type GrokCredential = GrokApiKeyCredential | GrokSessionCredential;

export type VendorCredential =
    | AnthropicCredential
    | CodexCredential
    | GeminiCredential
    | GrokCredential;

export function isBedrockCredential(value: unknown): value is BedrockCredential {
    if (typeof value !== "object" || value === null || !("name" in value)) return false;
    const name = (value as { name: unknown }).name;
    return name === "bedrock-aws" || name === "bedrock-bearer-token";
}
