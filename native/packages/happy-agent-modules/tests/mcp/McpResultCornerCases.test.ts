import { describe, expect, it } from "vitest";

import {
    MAX_MCP_IMAGE_BASE64_BYTES,
    MAX_MCP_TEXT_BYTES,
    boundedMcpJsonStringify,
    mcpResultToContentBlocks,
} from "../../sources/mcp/index.js";

describe("MCP result translation", () => {
    it("maps text, images, embedded resources, links, and audio to provider-neutral blocks", () => {
        expect(
            mcpResultToContentBlocks({
                content: [
                    { type: "text", text: "hello" },
                    { type: "image", data: "base64", mimeType: "image/png" },
                    { type: "audio", data: "base64", mimeType: "audio/wav" },
                    {
                        type: "resource",
                        resource: { uri: "docs://one", text: "embedded text" },
                    },
                    {
                        type: "resource",
                        resource: { uri: "docs://blob", blob: "base64", mimeType: "text/plain" },
                    },
                    { type: "resource_link", uri: "docs://linked" },
                    { type: "unknown", value: "ignored" },
                ],
            }),
        ).toEqual([
            { type: "text", text: "hello" },
            { type: "image", data: "base64", mimeType: "image/png" },
            { type: "text", text: "The MCP tool returned audio content." },
            { type: "text", text: "embedded text" },
            { type: "text", text: "MCP resource: docs://blob" },
            { type: "text", text: "MCP resource: docs://linked" },
        ]);
    });

    it("uses structured content when the content array is empty", () => {
        expect(
            mcpResultToContentBlocks({
                content: [],
                structuredContent: { ok: true, nested: ["value"] },
            }),
        ).toEqual([{ type: "text", text: '{"ok":true,"nested":["value"]}' }]);
        expect(mcpResultToContentBlocks({ content: [] })).toEqual([
            { type: "text", text: "(empty result)" },
        ]);
    });

    it("handles primitive and hostile values without throwing", () => {
        expect(mcpResultToContentBlocks(null)).toEqual([{ type: "text", text: "null" }]);
        expect(mcpResultToContentBlocks(undefined)).toEqual([{ type: "text", text: "undefined" }]);
        const hostile = {
            get content(): never {
                throw new Error("hostile getter");
            },
            get structuredContent(): never {
                throw new Error("hostile getter");
            },
        };
        expect(mcpResultToContentBlocks(hostile)).toEqual([
            { type: "text", text: "(empty result)" },
        ]);
    });

    it("truncates UTF-8 text without splitting a code point and stays within the byte budget", () => {
        const blocks = mcpResultToContentBlocks({
            content: [{ type: "text", text: "🙂".repeat(MAX_MCP_TEXT_BYTES) }],
        });
        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.type).toBe("text");
        if (blocks[0]?.type !== "text") throw new Error("expected text block");
        expect(Buffer.byteLength(blocks[0].text)).toBeLessThanOrEqual(MAX_MCP_TEXT_BYTES);
        expect(blocks[0].text).toContain("... [truncated]");
        expect([...blocks[0].text].at(-1)).toBe("]");
    });

    it("converts oversized and excess images to bounded text notices", () => {
        const oversized = mcpResultToContentBlocks({
            content: [
                {
                    type: "image",
                    data: "x".repeat(MAX_MCP_IMAGE_BASE64_BYTES + 1),
                    mimeType: "image/png",
                },
            ],
        });
        expect(oversized).toEqual([
            { type: "text", text: "The MCP tool returned an image that exceeded the size limit." },
        ]);

        const fiveImages = mcpResultToContentBlocks({
            content: Array.from({ length: 5 }, (_, index) => ({
                type: "image" as const,
                data: String(index),
                mimeType: "image/png",
            })),
        });
        expect(fiveImages.filter((block) => block.type === "image")).toHaveLength(4);
        expect(fiveImages.at(-1)).toEqual({
            type: "text",
            text: "Additional MCP images were truncated.",
        });
    });

    it("keeps the declared maximum block count while reporting content truncation", () => {
        const blocks = mcpResultToContentBlocks({
            content: Array.from({ length: 129 }, (_, index) => ({
                type: "text" as const,
                text: `item-${index}`,
            })),
        });
        expect(blocks.length).toBeLessThanOrEqual(128);
        expect(blocks.at(-1)).toEqual({ type: "text", text: "... [truncated]" });
    });
});

describe("bounded MCP JSON preview", () => {
    it("handles cycles, depth, nodes, and hostile property access", () => {
        const cyclic: Record<string, unknown> = { name: "root" };
        cyclic.self = cyclic;
        expect(boundedMcpJsonStringify(cyclic, 1_000)).toContain('"self":"[Circular]"');

        let deeplyNested: Record<string, unknown> = { value: "leaf" };
        for (let index = 0; index < 12; index += 1) deeplyNested = { child: deeplyNested };
        expect(boundedMcpJsonStringify(deeplyNested, 10_000)).toContain("... [truncated]");

        const manyKeys = Object.fromEntries(
            Array.from({ length: 200 }, (_, index) => [`key${index}`, index]),
        );
        expect(boundedMcpJsonStringify(manyKeys, 10_000)).toContain("... [truncated]");

        const hostile = Object.create(null) as Record<string, unknown>;
        Object.defineProperty(hostile, "boom", {
            enumerable: true,
            get(): never {
                throw new Error("nope");
            },
        });
        expect(boundedMcpJsonStringify(hostile, 1_000)).toContain("[unavailable]");
    });

    it("bounds exact bytes, including multibyte strings and tiny limits", () => {
        const value = { emoji: "🙂".repeat(1_000), tail: "done" };
        for (const limit of [0, 1, 2, 10, 100, 1_000]) {
            const output = boundedMcpJsonStringify(value, limit);
            expect(Buffer.byteLength(output)).toBeLessThanOrEqual(limit);
        }
        expect(boundedMcpJsonStringify(undefined, 100)).toBe("");
        expect(boundedMcpJsonStringify({ value: "x" }, -1)).toBe("");
    });

    it("serializes non-JSON primitives into a safe bounded preview", () => {
        expect(boundedMcpJsonStringify(BigInt(42), 100)).toBe('"42"');
        expect(boundedMcpJsonStringify(new Uint8Array([1, 2]), 100)).toContain("Uint8Array");
        expect(boundedMcpJsonStringify(new Date("2024-01-01T00:00:00.000Z"), 100)).toContain(
            "2024-01-01",
        );
        expect(boundedMcpJsonStringify(Symbol("secret"), 100)).toBe("");
    });
});
