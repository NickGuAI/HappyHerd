import { testContext } from "./testContext.js";

import { createServer, type IncomingMessage } from "node:http";

import { describe, expect, it } from "vitest";

import { AnthropicBedrockProvider } from "@/vendors/bedrock/AnthropicBedrockProvider.js";
import { BedrockBearerTokenCredential } from "@/vendors/bedrock/BedrockBearerTokenCredential.js";

describe("Anthropic Bedrock user agent", () => {
    it("sends the SDK's own user agent when the caller does not identify itself", async () => {
        const headers = await runOnce({});

        expect(headers?.["user-agent"]).not.toBe("rig/1.2.3");
    });

    it("identifies the caller when it supplies a user agent", async () => {
        const headers = await runOnce({ userAgent: "rig/1.2.3" });

        expect(headers?.["user-agent"]).toBe("rig/1.2.3");
    });
});

async function runOnce(options: {
    userAgent?: string;
}): Promise<IncomingMessage["headers"] | undefined> {
    let headers: IncomingMessage["headers"] | undefined;
    const server = createServer((request, response) => {
        headers = request.headers;
        request.resume();
        request.once("end", () => {
            response.writeHead(200, { "content-type": "text/event-stream" });
            response.end('event: message_stop\ndata: {"type":"message_stop"}\n\n');
        });
    });
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
        throw new Error("Missing Anthropic Bedrock test server port.");
    }
    const credential = await BedrockBearerTokenCredential.tryLoad({
        bearerToken: "bedrock-user-agent-token",
    });
    if (credential === null) throw new Error("Expected a Bedrock test credential.");
    const provider = new AnthropicBedrockProvider({
        credential,
        endpoint: `http://127.0.0.1:${address.port}`,
        model: "anthropic/opus-4-8",
        region: "us-east-1",
        transport: "runtime",
        ...(options.userAgent === undefined ? {} : { userAgent: options.userAgent }),
    });
    const session = await provider.session("user-agent-session", {
        instructions: "",
        tools: [],
    });
    try {
        for await (const _event of session.run(testContext, {
            context: {
                instructions: "",
                messages: [
                    {
                        role: "user",
                        content: [{ type: "text" as const, text: "Hello." }],
                    },
                ],
            },
        })) {
            // Draining the stream is what performs the request under test.
        }
    } finally {
        session.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    return headers;
}
