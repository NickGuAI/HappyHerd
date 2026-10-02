import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { HistoryMessage } from "../../sources/history/HistoryMessage.js";
import { MAX_OBSERVATION_HISTORY_FILES } from "../../sources/observation/ObservationSettings.js";
import { HistoryDump } from "../../sources/observation/impl/HistoryDump.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
});

async function temporaryHome(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "happy-observation-history-edge-"));
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

describe("HistoryDump edge cases", () => {
    it.each(["", ".", "..", "agent/name", "agent\\name", "agent\nname", "é"])(
        "does not use an unsafe agent ID as a filename: %j",
        async (agentId) => {
            const home = await temporaryHome();
            const dump = new HistoryDump(home);

            await expect(dump.record(agentId, [message("r1", "no")])).rejects.toThrow(
                "cannot name a file after",
            );
            await dump.close();
            expect(await readdir(home)).toEqual([]);
        },
    );

    it("accepts the maximum safe agent ID length and rejects one byte beyond it", async () => {
        const home = await temporaryHome();
        const dump = new HistoryDump(home);
        const accepted = "a".repeat(128);

        await dump.record(accepted, [message("r1", "ok")]);
        await expect(dump.record(`${accepted}a`, [message("r2", "no")])).rejects.toThrow(
            "cannot name a file after",
        );
        await dump.close();

        expect(await readdir(home)).toEqual([`${accepted}.jsonl`]);
    });

    it("skips a cyclic message without writing a placeholder line", async () => {
        const home = await temporaryHome();
        const dump = new HistoryDump(home);
        const cyclic = message("cycle", "not serializable") as HistoryMessage & {
            cycle?: unknown;
        };
        cyclic.cycle = cyclic;

        await dump.record("agent1", [cyclic]);
        await dump.flush();
        await dump.close();

        expect(await readFile(join(home, "agent1.jsonl"), "utf8")).toBe("");
    });

    it("keeps escaped newlines inside one JSONL record", async () => {
        const home = await temporaryHome();
        const dump = new HistoryDump(home);

        await dump.record("agent1", [message("r1", "first\nsecond\rthird")]);
        await dump.close();

        const raw = await readFile(join(home, "agent1.jsonl"), "utf8");
        expect(raw.split("\n")).toHaveLength(2);
        expect(JSON.parse(raw)).toMatchObject({
            agentId: "agent1",
            blocks: [{ type: "text", text: "first\nsecond\rthird" }],
        });
    });

    it("closes least-recently-used writers while retaining their files", async () => {
        const home = await temporaryHome();
        const dump = new HistoryDump(home);

        for (let index = 0; index < MAX_OBSERVATION_HISTORY_FILES + 1; index += 1) {
            await dump.record(`agent-${index}`, [message(`r-${index}`, "first")]);
        }
        await dump.record("agent-0", [message("r-0-second", "reopened")]);
        await dump.close();

        const records = (await readFile(join(home, "agent-0.jsonl"), "utf8"))
            .trimEnd()
            .split("\n")
            .map((line) => JSON.parse(line) as Record<string, unknown>);
        expect(records.map((record) => record.recordId)).toEqual(["r-0", "r-0-second"]);
        expect((await readdir(home)).length).toBe(MAX_OBSERVATION_HISTORY_FILES + 1);
    });

    it("does not create a file for an empty append", async () => {
        const home = await temporaryHome();
        const dump = new HistoryDump(home);

        await dump.record("agent1", []);
        await dump.flush();

        expect(await readdir(home)).toEqual([]);
        await dump.close();
    });

    it("ignores records after close, including an unsafe ID", async () => {
        const home = await temporaryHome();
        const dump = new HistoryDump(home);

        await dump.close();
        await expect(dump.record("../unsafe", [message("r1", "ignored")])).resolves.toBeUndefined();
        expect(await readdir(home)).toEqual([]);
    });

    it("always stamps the filename owner rather than trusting a message field", async () => {
        const home = await temporaryHome();
        const dump = new HistoryDump(home);
        const forged = { ...message("r1", "hello"), agentId: "other-agent" } as HistoryMessage;

        await dump.record("real-agent", [forged]);
        await dump.close();

        expect(JSON.parse(await readFile(join(home, "real-agent.jsonl"), "utf8"))).toMatchObject({
            agentId: "real-agent",
        });
    });
});
