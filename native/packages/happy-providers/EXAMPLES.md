# Stateful session examples

These examples use the public `@slopus/happy-providers` API. Keep the division of labor from the
README in mind while reading them: the session owns the live provider state, and your application
owns and persists the transcript.

## Collect a turn for replay

To persist a conversation durably, rebuild the assistant message from the _committed_ events of a
run — retries can rewind tentative output, and `committedSessionEvents()` handles that for you.
Remember that tool execution happens outside this library; the collector only records the calls.

```ts
import {
    assistantMessageFromEvents,
    type BaseSession,
    type SessionAssistantMessage,
    type SessionEvent,
    type SessionMessage,
} from "@slopus/happy-providers";
import type { Context } from "@steve.kite/stdlib";

async function runTurn(
    ctx: Context,
    session: BaseSession,
    instructions: string,
    messages: readonly SessionMessage[],
): Promise<SessionAssistantMessage> {
    const streamed: SessionEvent[] = [];
    for await (const event of session.run(ctx, { context: { instructions, messages } })) {
        streamed.push(event);
    }

    for (const event of streamed) {
        if (event.type === "done" && event.state === "error") throw new Error(event.message);
    }

    const assistant = assistantMessageFromEvents(streamed);
    if (assistant === undefined) throw new Error("The provider returned no assistant message.");
    return assistant;
}
```

The collector ignores provider-owned calls (`server: true`) because those calls and results settle
inside the same provider response. Applications that present server-tool activity can collect the
corresponding result events separately, but must not send a client tool result for them.

## Continue after a client tool call

The library streams tool calls to you but never executes them. The rhythm is: declare tools when
creating the session, append the collected assistant message, execute each client-owned call
yourself, then append the tool-result messages before the next `run()`.

```ts
import { readFile } from "node:fs/promises";

import { Type } from "@sinclair/typebox";
import {
    CodexProvider,
    CodexSessionCredential,
    type SessionMessage,
    type SessionTool,
} from "@slopus/happy-providers";

const readTextFile = {
    name: "read_text_file",
    description: "Read a UTF-8 text file.",
    parameters: Type.Object({ path: Type.String() }),
} satisfies SessionTool;

const credential = await CodexSessionCredential.tryLoad();
if (credential === null) throw new Error("Sign in with Codex first.");

const provider = new CodexProvider({ credential, model: "gpt-5.6-sol" });
const instructions = "Use read_text_file when you need file contents.";
const session = await provider.session("tool-example", {
    instructions,
    tools: [readTextFile],
});

const messages: SessionMessage[] = [
    { role: "user", content: [{ type: "text", text: "Summarize package.json." }] },
];

try {
    const assistant = await runTurn(session, instructions, messages);
    messages.push(assistant);

    for (const call of assistant.content) {
        if (call.type !== "tool_call" || call.server === true) continue;
        if (call.name !== "read_text_file" || call.incomplete === true) continue;
        const { path } = JSON.parse(call.arguments) as { path: string };
        try {
            messages.push({
                role: "tool",
                callId: call.callId,
                content: [{ type: "text", text: await readFile(path, "utf8") }],
                ...(call.vendor === undefined ? {} : { vendor: call.vendor }),
            });
        } catch (error) {
            messages.push({
                role: "tool",
                callId: call.callId,
                content: [
                    {
                        type: "text",
                        text: error instanceof Error ? error.message : "The read failed.",
                    },
                ],
                isError: true,
                ...(call.vendor === undefined ? {} : { vendor: call.vendor }),
            });
        }
    }

    const finalAssistant = await runTurn(session, instructions, messages);
    messages.push(finalAssistant);
    console.log(
        finalAssistant.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join(""),
    );
} finally {
    await session.destroy();
}
```

Validate parsed tool arguments against the same TypeBox schema before executing them in a real
application. The cast above keeps the example focused on the session lifecycle.

## Compact and keep talking

Compaction updates the session's provider-native continuation state and hands you back the exact
replacement transcript to adopt.

```ts
const result = await session.compact(ctx, {
    context: { instructions, messages },
    instructions: "Preserve decisions, unfinished work, and exact identifiers.",
});

if (result.status === "completed") {
    messages.splice(0, messages.length, ...result.context.messages);
    messages.push({
        role: "user",
        content: [{ type: "text", text: "Continue from the compacted context." }],
    });
} else if (result.status === "failed") {
    console.warn(result.message);
}
```

Do not append a completed compaction to the old transcript. Replace the selected context with the
returned context so opaque checkpoints and preserved messages stay in the provider's required
order.

## Other providers

The session lifecycle is the same for every provider; only construction and vendor options differ.

```ts
import {
    AnthropicProvider,
    BedrockAwsCredential,
    BedrockBearerTokenCredential,
    ClaudeCodeCredential,
    GrokProvider,
    GrokSessionCredential,
    ResponsesProvider,
} from "@slopus/happy-providers";

const claudeCredential = await ClaudeCodeCredential.tryLoad();
if (claudeCredential !== null) {
    const claude = new AnthropicProvider({
        credential: claudeCredential,
        model: "claude-opus-4-6",
    });
    const session = await claude.session("claude-example", {
        instructions: "You are a concise coding assistant.",
    });
    await session.destroy();
}

const grokCredential = await GrokSessionCredential.tryLoad();
if (grokCredential !== null) {
    const grok = new GrokProvider({ credential: grokCredential, model: "grok-4.5" });
    const session = await grok.session("grok-example", {
        instructions: "You are a concise coding assistant.",
    });
    await session.destroy();
}

const bedrockCredential =
    (await BedrockBearerTokenCredential.tryLoad()) ??
    (await BedrockAwsCredential.tryLoad({ profile: process.env.AWS_PROFILE }));
if (bedrockCredential !== null) {
    const bedrock = new AnthropicProvider({
        credential: bedrockCredential,
        model: "anthropic/opus-4-8",
        region: "us-east-1",
        transport: "mantle",
    });
    const session = await bedrock.session("bedrock-example", {
        instructions: "You are a concise coding assistant.",
    });
    await session.destroy();
}

const responsesApiKey = process.env.RESPONSES_API_KEY;
if (responsesApiKey === undefined) throw new Error("Set RESPONSES_API_KEY first.");

const responses = new ResponsesProvider({
    apiKey: responsesApiKey,
    endpoint: "https://example.com/v1",
    model: "provider-model-id",
});
const responsesSession = await responses.session("responses-example", {
    instructions: "You are a concise coding assistant.",
});
await responsesSession.destroy();
```

Applications normally choose one configured provider at runtime rather than constructing all of
them together as this compact comparison does.
