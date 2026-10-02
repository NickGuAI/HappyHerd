import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RotatingFileWriter } from "../../sources/observation/impl/RotatingFileWriter.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
});

async function temporaryFile(name = "agent.log"): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "happy-observation-writer-edge-"));
    temporaryDirectories.push(root);
    return join(root, name);
}

describe("RotatingFileWriter edge cases", () => {
    it("counts UTF-8 bytes rather than JavaScript string length", async () => {
        const path = await temporaryFile();
        const writer = await RotatingFileWriter.open({
            maxBytes: 1_000,
            maxPendingBytes: Buffer.byteLength("éé\n", "utf8"),
            path,
        });

        writer.write("éé");
        writer.write("another line");
        expect(writer.droppedLines).toBe(1);

        await writer.close();
        expect(await readFile(path, "utf8")).toBe("éé\n");
    });

    it("rotates an existing file before appending when the next line would cross the limit", async () => {
        const path = await temporaryFile();
        await writeFile(path, "old\n");
        const writer = await RotatingFileWriter.open({
            maxBytes: Buffer.byteLength("old\n", "utf8"),
            maxPendingBytes: 1_000,
            path,
        });

        writer.write("new");
        await writer.close();

        expect(await readFile(`${path}.1`, "utf8")).toBe("old\n");
        expect(await readFile(path, "utf8")).toBe("new\n");
    });

    it("replaces an older generation on every subsequent rotation", async () => {
        const path = await temporaryFile();
        const writer = await RotatingFileWriter.open({
            maxBytes: 4,
            maxPendingBytes: 1_000,
            path,
        });

        writer.write("one");
        writer.write("two");
        writer.write("three");
        await writer.close();

        expect(await readFile(path, "utf8")).toBe("three\n");
        expect(await readFile(`${path}.1`, "utf8")).toBe("two\n");
    });

    it("accepts an exact pending-byte budget and rejects one byte over it", async () => {
        const path = await temporaryFile();
        const writer = await RotatingFileWriter.open({
            maxBytes: 1_000,
            maxPendingBytes: Buffer.byteLength("ok\n", "utf8"),
            path,
        });

        writer.write("ok");
        writer.write("é");
        expect(writer.droppedLines).toBe(1);

        await writer.close();
        expect(await readFile(path, "utf8")).toBe("ok\n");
    });

    it.each([
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        1.5,
        Number.MAX_SAFE_INTEGER + 1,
    ])("rejects a non-safe maxBytes budget: %s", async (maxBytes) => {
        const path = await temporaryFile();
        await expect(
            RotatingFileWriter.open({ maxBytes, maxPendingBytes: 1, path }),
        ).rejects.toThrow("at least one byte");
    });

    it.each([
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        1.5,
        Number.MAX_SAFE_INTEGER + 1,
    ])("rejects a non-safe maxPendingBytes budget: %s", async (maxPendingBytes) => {
        const path = await temporaryFile();
        await expect(
            RotatingFileWriter.open({ maxBytes: 1, maxPendingBytes, path }),
        ).rejects.toThrow("at least one pending byte");
    });

    it("keeps a line whole when the line is larger than the pending budget", async () => {
        const path = await temporaryFile();
        const writer = await RotatingFileWriter.open({
            maxBytes: 1_000,
            maxPendingBytes: Buffer.byteLength("large\n", "utf8") - 1,
            path,
        });

        writer.write("large");
        await writer.close();

        expect(writer.droppedLines).toBe(1);
        expect(await readFile(path, "utf8")).toBe("");
    });

    it("does not reject a flush after close", async () => {
        const path = await temporaryFile();
        const writer = await RotatingFileWriter.open({
            maxBytes: 100,
            maxPendingBytes: 100,
            path,
        });

        writer.write("line");
        await writer.close();
        await expect(writer.flush()).resolves.toBeUndefined();
    });

    it("does not allow a single line to make the file exceed maxBytes", async () => {
        const path = await temporaryFile();
        const writer = await RotatingFileWriter.open({
            maxBytes: 3,
            maxPendingBytes: 100,
            path,
        });

        writer.write("four");
        await writer.close();

        expect(Buffer.byteLength(await readFile(path, "utf8"), "utf8")).toBeLessThanOrEqual(3);
    });
});
