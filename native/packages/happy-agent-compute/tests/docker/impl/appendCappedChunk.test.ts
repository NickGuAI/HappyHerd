import { describe, expect, it } from "vitest";

import { appendCappedChunk } from "../../../sources/docker/impl/appendCappedChunk.js";

describe("appendCappedChunk", () => {
    it("retains only the most recent bytes across many small chunks", () => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        for (const piece of ["abc", "def", "ghi"]) {
            bytes = appendCappedChunk(chunks, bytes, Buffer.from(piece), 5);
        }
        expect(Buffer.concat(chunks, bytes).toString()).toBe("efghi");
    });

    it("trims a partial chunk when it alone exceeds the cap", () => {
        const chunks: Buffer[] = [];
        const bytes = appendCappedChunk(chunks, 0, Buffer.from("abcdefgh"), 3);
        expect(Buffer.concat(chunks, bytes).toString()).toBe("fgh");
    });

    it("keeps nothing when the cap is zero", () => {
        const chunks: Buffer[] = [];
        const bytes = appendCappedChunk(chunks, 0, Buffer.from("abc"), 0);
        expect(bytes).toBe(0);
        expect(chunks).toHaveLength(0);
    });
});
