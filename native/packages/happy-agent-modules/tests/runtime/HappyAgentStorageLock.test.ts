import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createRootContext } from "@steve.kite/stdlib";
import { afterEach, describe, expect, it } from "vitest";

import { acquireHappyAgentStorageLock } from "../../sources/runtime/HappyAgentStorageLock.js";

const createdDirectories = new Set<string>();

afterEach(async () => {
    await Promise.all(
        [...createdDirectories].map(async (directory) => {
            await rm(directory, { force: true, recursive: true });
        }),
    );
    createdDirectories.clear();
});

describe("acquireHappyAgentStorageLock", () => {
    it("enforces one live owner and permits the next owner after release", async () => {
        const directory = await createTestDirectory();
        const path = join(directory, "agent.lock");
        const first = await acquireHappyAgentStorageLock(path);

        await expect(acquireHappyAgentStorageLock(path)).rejects.toThrow(
            /already owned by process/u,
        );

        await first.release(createRootContext());
        const second = await acquireHappyAgentStorageLock(path);
        await second.release(createRootContext());
    });
});

async function createTestDirectory(): Promise<string> {
    const scratch = resolve(import.meta.dirname, "../../../.context");
    await mkdir(scratch, { recursive: true });
    const directory = await mkdtemp(join(scratch, "happy-agent-lock-"));
    createdDirectories.add(directory);
    return directory;
}
