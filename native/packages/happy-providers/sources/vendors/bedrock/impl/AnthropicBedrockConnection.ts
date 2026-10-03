import type { BetaRawMessageStreamEvent } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { BedrockCredential } from "@/vendors/VendorCredential.js";
import type { AnthropicBedrockTransport } from "@/vendors/bedrock/AnthropicBedrockTransport.js";
import {
    createAnthropicBedrockClient,
    type AnthropicBedrockClient,
} from "@/vendors/bedrock/impl/createAnthropicBedrockClient.js";

/**
 * The Bedrock client a session talks through, built once and kept.
 *
 * The client is created on first use so either its bearer token or refreshable AWS credential
 * provider is installed at the same lifetime boundary as the connection. Callers that need the
 * client itself, such as native compaction, borrow it through {@link client}; everything else goes
 * out over {@link stream}.
 */
export class AnthropicBedrockConnection {
    private cached: AnthropicBedrockClient | undefined;

    constructor(
        private readonly options: {
            client?: AnthropicBedrockClient;
            credential: BedrockCredential;
            endpoint?: string;
            region: string;
            transport: AnthropicBedrockTransport;
            userAgent?: string;
        },
    ) {
        this.cached = options.client;
    }

    client(): AnthropicBedrockClient {
        return (this.cached ??= createAnthropicBedrockClient({
            credential: this.options.credential,
            ...(this.options.endpoint === undefined ? {} : { endpoint: this.options.endpoint }),
            region: this.options.region,
            transport: this.options.transport,
            ...(this.options.userAgent === undefined ? {} : { userAgent: this.options.userAgent }),
        }));
    }

    stream(
        request: Parameters<AnthropicBedrockClient["beta"]["messages"]["create"]>[0],
        signal?: AbortSignal,
    ): Promise<AsyncIterable<BetaRawMessageStreamEvent>> {
        return this.client().beta.messages.create(
            request,
            signal === undefined ? undefined : { signal },
        ) as Promise<AsyncIterable<BetaRawMessageStreamEvent>>;
    }

    close(): void {
        this.cached = undefined;
    }
}
