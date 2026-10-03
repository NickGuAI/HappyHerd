import { describe, expect, it } from "vitest";

import { readSseFrames } from "../sources/readSseFrames.js";

/** Delivers the text in the given pieces, so chunk boundaries can be placed anywhere. */
function streamOf(...chunks: string[]): ReadableStream<Uint8Array<ArrayBuffer>> {
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array<ArrayBuffer>>({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
        },
    });
}

async function collect(stream: ReadableStream<Uint8Array<ArrayBuffer>>) {
    const frames = [];
    for await (const frame of readSseFrames(stream)) frames.push(frame);
    return frames;
}

describe("readSseFrames", () => {
    it("reads a frame's event, id, and data", async () => {
        const frames = await collect(streamOf("id: c1\nevent: run.started\ndata: {}\n\n"));

        expect(frames).toEqual([{ id: "c1", name: "run.started", data: "{}" }]);
    });

    it("joins the data lines of one frame", async () => {
        const frames = await collect(streamOf('data: {"a":1,\ndata: "b":2}\n\n'));

        expect(frames[0]?.data).toBe('{"a":1,\n"b":2}');
    });

    it("reads frames split across chunk boundaries, carriage returns included", async () => {
        const frames = await collect(
            streamOf("event: one\r\ndata: 1\r", "\n\r\nevent: two\r\ndata: 2\r\n\r\n"),
        );

        expect(frames.map((frame) => frame.name)).toEqual(["one", "two"]);
        expect(frames.map((frame) => frame.data)).toEqual(["1", "2"]);
    });

    it("drops the comment heartbeats that keep the connection alive", async () => {
        const frames = await collect(streamOf(": heartbeat\n\ndata: 1\n\n"));

        expect(frames).toHaveLength(1);
    });

    it("delivers a final frame that arrived without its trailing blank line", async () => {
        const frames = await collect(streamOf("event: last\ndata: 1"));

        expect(frames).toEqual([{ id: undefined, name: "last", data: "1" }]);
    });
});
