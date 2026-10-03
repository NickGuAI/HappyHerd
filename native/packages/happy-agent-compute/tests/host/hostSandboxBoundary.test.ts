import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { createRootContext, type Context } from "@steve.kite/stdlib";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Compute } from "../../sources/Compute.js";
import { computePermissions } from "../../sources/ComputePermissions.js";
import { createHostCompute } from "../../sources/host/index.js";

const ctx: Context = createRootContext().named("host-sandbox-boundary-test");
const computes: Compute[] = [];
const temporaryDirectories: string[] = [];

/**
 * The restricted-command boundary is enforced by the native supervisor — Seatbelt on macOS and
 * Linux namespaces on Linux. The test runner is itself sandboxed and cannot always spawn a nested
 * one, so
 * these cases are gated on a probe: when a restricted command cannot even run, the boundary is
 * unproven here rather than broken, and the assertions are skipped with that reason recorded.
 *
 * A skipped boundary reads as a pass, which is exactly how an unproven sandbox goes unnoticed. Set
 * HAPPY_AGENT_COMPUTE_REQUIRE_SANDBOX=1 where the sandbox is expected to work, such as release
 * validation, and a probe failure fails the suite instead of quietly excusing it.
 */
let restrictedCommandsRun = false;
const REQUIRE_SANDBOX = process.env.HAPPY_AGENT_COMPUTE_REQUIRE_SANDBOX === "1";

beforeAll(async () => {
    if (process.platform !== "darwin" && process.platform !== "linux") {
        if (REQUIRE_SANDBOX) {
            throw new Error(
                `HAPPY_AGENT_COMPUTE_REQUIRE_SANDBOX=1 needs macOS or Linux, but this is ${process.platform}.`,
            );
        }
        return;
    }
    const cwd = await makeWorkspace();
    const compute = createHostCompute({
        ctx,
        cwd,
    });
    let failure = "the probe command did not run";
    try {
        const probe = await compute.shell.run({
            command: "printf ok",
            permissions: computePermissions("workspace_write"),
        });
        restrictedCommandsRun = probe.exitCode === 0 && probe.stdout === "ok";
        failure = `exitCode=${String(probe.exitCode)} stdout=${JSON.stringify(probe.stdout)} stderr=${JSON.stringify(probe.stderr)}`;
    } catch (error) {
        restrictedCommandsRun = false;
        failure = error instanceof Error ? error.message : String(error);
    } finally {
        await compute.dispose(ctx);
    }
    if (!restrictedCommandsRun && REQUIRE_SANDBOX) {
        throw new Error(
            `HAPPY_AGENT_COMPUTE_REQUIRE_SANDBOX=1 was set, but no restricted command could run, so the sandbox boundary is unproven: ${failure}`,
        );
    }
});

afterEach(async () => {
    await Promise.all(computes.splice(0).map((compute) => compute.dispose(ctx)));
    await Promise.all(
        temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
});

describe("host restricted-command sandbox", () => {
    it("blocks a workspace-write command from writing outside the workspace", async () => {
        if (!restrictedCommandsRun) {
            // Skipped: the nested sandbox could not spawn under the test runner.
            return;
        }
        const root = await makeTemporaryDirectory();
        const cwd = join(root, "workspace");
        await mkdir(cwd, { recursive: true });
        const outside = join(root, "outside.txt");
        const compute = createHostCompute({
            ctx,
            cwd,
        });
        computes.push(compute);

        const result = await compute.shell.run({
            command: `printf hostile > ${shellQuote(outside)}`,
            permissions: computePermissions("workspace_write"),
        });

        expect(result.exitCode).not.toBe(0);
        expect(existsSync(outside)).toBe(false);
    });

    it("lets a workspace-write command write inside the workspace", async () => {
        if (!restrictedCommandsRun) {
            return;
        }
        const cwd = await makeWorkspace();
        const compute = createHostCompute({
            ctx,
            cwd,
        });
        computes.push(compute);

        const result = await compute.shell.run({
            command: "printf inside > inside.txt",
            permissions: computePermissions("workspace_write"),
        });

        expect(result.exitCode).toBe(0);
        expect(existsSync(join(cwd, "inside.txt"))).toBe(true);
    });

    it("lets a workspace-write command use an explicit writable root outside the workspace", async () => {
        if (!restrictedCommandsRun) return;
        const root = await makeTemporaryDirectory();
        const cwd = join(root, "workspace");
        const output = join(root, "output");
        await Promise.all([mkdir(cwd, { recursive: true }), mkdir(output, { recursive: true })]);
        const compute = createHostCompute({ ctx, cwd });
        computes.push(compute);

        const result = await compute.shell.run({
            command: `printf built > ${shellQuote(join(output, "artifact.txt"))}`,
            permissions: computePermissions("workspace_write", {
                allowedWritePaths: [output],
            }),
        });

        expect(result.exitCode).toBe(0);
        expect(existsSync(join(output, "artifact.txt"))).toBe(true);
    });

    it("lets a denied write root beat the same command's outside-workspace grant", async () => {
        if (!restrictedCommandsRun) return;
        const root = await makeTemporaryDirectory();
        const cwd = join(root, "workspace");
        const output = join(root, "output");
        await Promise.all([mkdir(cwd, { recursive: true }), mkdir(output, { recursive: true })]);
        const compute = createHostCompute({ ctx, cwd });
        computes.push(compute);

        const result = await compute.shell.run({
            command: `printf blocked > ${shellQuote(join(output, "artifact.txt"))}`,
            permissions: computePermissions("workspace_write", {
                allowedWritePaths: [output],
                deniedWritePaths: [output],
            }),
        });

        expect(result.exitCode).not.toBe(0);
        expect(existsSync(join(output, "artifact.txt"))).toBe(false);
    });
});

async function makeWorkspace(): Promise<string> {
    const root = await makeTemporaryDirectory();
    const cwd = join(root, "workspace");
    await mkdir(cwd, { recursive: true });
    return cwd;
}

async function makeTemporaryDirectory(): Promise<string> {
    // Keep the fixture beside the test so its outside-workspace target is explicit and independent
    // from operating-system temporary-directory conventions.
    const path = await mkdtemp(join(import.meta.dirname, ".host-boundary-"));
    temporaryDirectories.push(path);
    return path;
}

function shellQuote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
}
