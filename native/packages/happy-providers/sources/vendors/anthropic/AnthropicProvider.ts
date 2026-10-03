import { BaseProvider } from "@/core/BaseProvider.js";
import type { InferenceRetryOptions } from "@/core/inferenceRetrySettings.js";
import type { ProviderModality } from "@/core/ProviderModality.js";
import type { SessionOptions } from "@/core/SessionOptions.js";
import { isBedrockCredential, type AnthropicCredential } from "@/vendors/VendorCredential.js";
import {
    AnthropicBedrockProvider,
    type AnthropicBedrockProviderOptions as NativeAnthropicBedrockProviderOptions,
} from "@/vendors/bedrock/AnthropicBedrockProvider.js";
import type { AnthropicBedrockSession } from "@/vendors/bedrock/AnthropicBedrockSession.js";
import { ClaudeProvider, type ClaudeProviderOptions } from "@/vendors/claude/ClaudeProvider.js";
import type { ClaudeSession } from "@/vendors/claude/ClaudeSession.js";

/**
 * Anthropic Agent SDK options selected by a Claude credential.
 */
type AnthropicClaudeOptions = ClaudeProviderOptions;

/**
 * Amazon Bedrock Messages options selected by a Bedrock credential.
 */
type AnthropicBedrockOptions = NativeAnthropicBedrockProviderOptions;

/**
 * The credential is the transport discriminator: Claude credentials use the
 * Anthropic Agent SDK, while a Bedrock credential uses Amazon Bedrock.
 */
export type AnthropicProviderOptions = AnthropicClaudeOptions | AnthropicBedrockOptions;

/**
 * Common options accepted when a credential was selected dynamically and is
 * therefore still typed as the full Anthropic credential union.
 */
export interface AnthropicCredentialProviderOptions extends InferenceRetryOptions {
    credential: AnthropicCredential;
    model?: string;
    userAgent?: string;
}

export type AnthropicSession = ClaudeSession | AnthropicBedrockSession;

/**
 * One Anthropic provider surface for Claude Code, Anthropic API, OAuth, and
 * Amazon Bedrock credentials.
 */
export class AnthropicProvider extends BaseProvider {
    static override readonly name = "claude";
    static override readonly inputTypes: readonly ProviderModality[] = ["text", "image"];
    static override readonly outputTypes: readonly ProviderModality[] = ["text"];

    readonly credential: AnthropicCredential;
    readonly #provider: ClaudeProvider | AnthropicBedrockProvider;

    constructor(options: AnthropicProviderOptions);
    constructor(options: AnthropicCredentialProviderOptions);
    constructor(options: AnthropicProviderOptions | AnthropicCredentialProviderOptions) {
        super();
        this.credential = options.credential;
        if (isBedrockCredential(options.credential)) {
            // TypeScript does not narrow a containing union from a nested
            // discriminant. The credential name is the public discriminator.
            this.#provider = new AnthropicBedrockProvider(options as AnthropicBedrockOptions);
        } else {
            this.#provider = new ClaudeProvider(options as AnthropicClaudeOptions);
        }
    }

    override async session(id: string, options: SessionOptions): Promise<AnthropicSession> {
        return this.#provider.session(id, options);
    }
}
