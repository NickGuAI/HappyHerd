import { spawn } from "node:child_process";
import { once } from "node:events";

import { createRootContext, type Context } from "@steve.kite/stdlib";
import { describe, expect, it } from "vitest";

import { waitForProcessExit } from "../../../sources/processes/index.js";

const ctx: Context = createRootContext().named("wait-for-process-exit-test");

describe("waitForProcessExit", () => {
    it("resolves after the selected process exits", async () => {
        const child = spawn(process.execPath, ["-e", "setInterval(() => undefined, 1_000)"], {
            stdio: "ignore",
        });
        await once(child, "spawn");
        expect(child.pid).toBeTypeOf("number");

        const stopped = waitForProcessExit(ctx, child.pid!, 2_000);
        const closed = once(child, "close");
        child.kill("SIGTERM");

        await expect(stopped).resolves.toBe(true);
        await closed;
    });

    it("returns false when the selected process remains alive", async () => {
        await expect(waitForProcessExit(ctx, process.pid, 10)).resolves.toBe(false);
    });
});
