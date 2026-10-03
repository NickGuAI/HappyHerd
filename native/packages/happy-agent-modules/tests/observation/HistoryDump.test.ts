import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { HistoryMessage } from "../../sources/history/HistoryMessage.js";
import { HistoryDump } from "../../sources/observation/impl/HistoryDump.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
});

async function temporaryHome(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "happy-observation-history-"));
    temporaryDirectories.push(root);
    return root;
}

function message(recordId: string, text: string): HistoryMessage {
    return {
        blocks: [{ type: "text", text }],
        recordId,
        role: "assistant",
    };
}

describe("HistoryDump", () => {
    it("writes one JSON object per record, in the order they committed", async () => {
        const home = await temporaryHome();
        const dump = new HistoryDump(home);

        await dump.record("agent1", [message("r1", "hello"), message("r2", "again")]);
        await dump.record("agent1", [message("r3", "and once more")]);
        await dump.close();

        const lines = (await readFile(join(home, "agent1.jsonl"), "utf8")).trimEnd().split("\n");
        expect(lines.map((line) => JSON.parse(line))).toEqual([
            {
                agentId: "agent1",
                blocks: [{ type: "text", text: "hello" }],
                recordId: "r1",
                role: "assistant",
            },
            {
                agentId: "agent1",
                blocks: [{ type: "text", text: "again" }],
                recordId: "r2",
                role: "assistant",
            },
            {
                agentId: "agent1",
                blocks: [{ type: "text", text: "and once more" }],
                recordId: "r3",
                role: "assistant",
            },
        ]);
    });

    it("gives each agent its own file", async () => {
        const home = await temporaryHome();
        const dump = new HistoryDump(home);

        await dump.record("alpha", [message("r1", "from alpha")]);
        await dump.record("beta", [message("r1", "from beta")]);
        await dump.close();

        expect((await readdir(home)).sort()).toEqual(["alpha.jsonl", "beta.jsonl"]);
    });

    it("refuses an agent ID it cannot safely name a file after", async () => {
        const home = await temporaryHome();
        const dump = new HistoryDump(home);

        await expect(dump.record("../escape", [message("r1", "nope")])).rejects.toThrow(
            "cannot name a file after",
        );
        await expect(dump.record("with/slash", [message("r1", "nope")])).rejects.toThrow(
            "cannot name a file after",
        );

        await dump.close();
        expect(await readdir(home)).toEqual([]);
    });

    it("writes nothing for an empty append", async () => {
        const home = await temporaryHome();
        const dump = new HistoryDump(home);

        await dump.record("agent1", []);
        await dump.close();

        expect(await readdir(home)).toEqual([]);
    });

    it("stops recording once it has closed", async () => {
        const home = await temporaryHome();
        const dump = new HistoryDump(home);

        await dump.record("agent1", [message("r1", "before")]);
        await dump.close();
        await dump.record("agent1", [message("r2", "after")]);

        expect(await readFile(join(home, "agent1.jsonl"), "utf8")).toBe(
            `${JSON.stringify({
                agentId: "agent1",
                blocks: [{ type: "text", text: "before" }],
                recordId: "r1",
                role: "assistant",
            })}\n`,
        );
    });
});
