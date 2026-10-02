import { mkdtemp, readFile, rm } from "node:fs/promises";
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

async function temporaryFile(name: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "happy-observation-writer-"));
    temporaryDirectories.push(root);
    return join(root, name);
}

describe("RotatingFileWriter", () => {
    it("appends whole lines in the order they were written", async () => {
        const path = await temporaryFile("agent.log");
        const writer = await RotatingFileWriter.open({
            maxBytes: 1_048_576,
            maxPendingBytes: 1_048_576,
            path,
        });

        writer.write("first");
        writer.write("second\n");
        writer.write("third");
        await writer.close();

        expect(await readFile(path, "utf8")).toBe("first\nsecond\nthird\n");
    });

    it("creates the directory it was pointed at", async () => {
        const root = await mkdtemp(join(tmpdir(), "happy-observation-writer-nested-"));
        temporaryDirectories.push(root);
        const path = join(root, "observation", "history", "agent.log");

        const writer = await RotatingFileWriter.open({
            maxBytes: 1_048_576,
            maxPendingBytes: 1_048_576,
            path,
        });
        writer.write("present");
        await writer.close();

        expect(await readFile(path, "utf8")).toBe("present\n");
    });

    it("keeps one previous generation rather than growing without bound", async () => {
        const path = await temporaryFile("agent.log");
        const writer = await RotatingFileWriter.open({
            maxBytes: 12,
            maxPendingBytes: 1_048_576,
            path,
        });

        writer.write("aaaaaaaaa"); // 10 bytes with its newline.
        writer.write("bbbbbbbbb");
        writer.write("ccccccccc");
        await writer.close();

        expect(await readFile(path, "utf8")).toBe("ccccccccc\n");
        expect(await readFile(`${path}.1`, "utf8")).toBe("bbbbbbbbb\n");
    });

    it("drops lines it cannot hold and says how many", async () => {
        const path = await temporaryFile("agent.log");
        const writer = await RotatingFileWriter.open({
            maxBytes: 1_048_576,
            maxPendingBytes: 8,
            path,
        });

        writer.write("this line is far larger than the pending budget");
        expect(writer.droppedLines).toBe(1);

        await writer.close();
        expect(await readFile(path, "utf8")).toBe("");
    });

    it("drops writes made after it closed instead of failing them", async () => {
        const path = await temporaryFile("agent.log");
        const writer = await RotatingFileWriter.open({
            maxBytes: 1_048_576,
            maxPendingBytes: 1_048_576,
            path,
        });

        writer.write("before");
        await writer.close();
        writer.write("after");
        await writer.close();

        expect(writer.droppedLines).toBe(1);
        expect(writer.failedLines).toBe(0);
        expect(await readFile(path, "utf8")).toBe("before\n");
    });

    it("refuses a budget that could not hold anything", async () => {
        const path = await temporaryFile("agent.log");

        await expect(
            RotatingFileWriter.open({ maxBytes: 0, maxPendingBytes: 1_048_576, path }),
        ).rejects.toThrow("at least one byte");
        await expect(
            RotatingFileWriter.open({ maxBytes: 1_048_576, maxPendingBytes: 0, path }),
        ).rejects.toThrow("at least one pending byte");
    });
});
