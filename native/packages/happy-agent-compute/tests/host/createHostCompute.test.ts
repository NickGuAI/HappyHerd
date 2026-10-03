import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRootContext, type Context } from "@steve.kite/stdlib";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Compute } from "../../sources/Compute.js";
import { computePermissions } from "../../sources/ComputePermissions.js";
import { createHostCompute } from "../../sources/host/index.js";
import { NativeProcessManager } from "../../sources/processes/index.js";

const ctx: Context = createRootContext().named("host-compute-test");
const computes: Compute[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(computes.splice(0).map((compute) => compute.dispose(ctx)));
    await Promise.all(
        temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
});

describe("createHostCompute filesystem", () => {
    it("identifies its provider without retaining machine-wide permissions", async () => {
        const { compute } = await hostCompute();

        expect(compute.id).toBe("host");
        expect(compute.kind).toBe("host");
        expect("permissions" in compute).toBe(false);
    });

    it("reads, writes, and stats files relative to its fixed working directory", async () => {
        const { compute } = await hostCompute();
        const permissions = computePermissions("workspace_write");

        await compute.fs.mkdir(permissions, "notes", { recursive: true });
        await compute.fs.writeFile(permissions, "notes/greeting.txt", "hello");

        await expect(compute.fs.readFile(permissions, "notes/greeting.txt")).resolves.toBe("hello");
        await expect(compute.fs.stat(permissions, "notes/greeting.txt")).resolves.toMatchObject({
            isFile: true,
            isDirectory: false,
            size: 5,
        });
    });

    it("pages directory names in stable UTF-8 byte order", async () => {
        const { compute, cwd } = await hostCompute();
        const permissions = computePermissions("workspace_write");
        await Promise.all(
            ["zeta", ".context", "alpha", "middle", "éclair"].map((name) =>
                writeFile(join(cwd, name), ""),
            ),
        );

        await expect(compute.fs.readdirPage(permissions, ".", { limit: 2 })).resolves.toEqual({
            entries: [".context", "alpha"],
            hasMore: true,
        });
        await expect(
            compute.fs.readdirPage(permissions, ".", { after: "alpha", limit: 3 }),
        ).resolves.toEqual({
            entries: ["middle", "zeta", "éclair"],
            hasMore: false,
        });
    });

    it("bounds a binary read at the file descriptor", async () => {
        const { compute, cwd } = await hostCompute();
        await writeFile(join(cwd, "image.bin"), Buffer.alloc(65_537, 1));

        await expect(
            compute.fs.readFileBuffer(computePermissions("workspace_write"), "image.bin", {
                maxBytes: 65_536,
            }),
        ).rejects.toThrow("exceeds 65536 bytes");
    });
});

describe("createHostCompute permissions", () => {
    it("refuses writes in read-only mode", async () => {
        const { compute } = await hostCompute();
        const permissions = computePermissions("read_only");

        await expect(compute.fs.writeFile(permissions, "blocked.txt", "no")).rejects.toThrow(
            "read-only mode",
        );
        await expect(compute.fs.exists(permissions, "blocked.txt")).resolves.toBe(false);
    });

    it("refuses writes outside the working directory", async () => {
        const { compute, cwd } = await hostCompute();

        await expect(
            compute.fs.writeFile(
                computePermissions("workspace_write"),
                join(cwd, "..", "outside.txt"),
                "no",
            ),
        ).rejects.toThrow("outside the working directory");
    });

    it("refuses writing Git control files without full access", async () => {
        const { compute, cwd } = await hostCompute();
        await mkdir(join(cwd, ".git"), { recursive: true });

        await expect(
            compute.fs.writeFile(computePermissions("workspace_write"), ".git/config", "[core]\n"),
        ).rejects.toThrow("Git control files");
    });

    it("allows full access to write outside the workspace", async () => {
        const { compute, cwd } = await hostCompute();
        const permissions = computePermissions("full_access");
        const outside = join(cwd, "..", "full-access-outside.txt");
        temporaryDirectories.push(outside);

        await compute.fs.writeFile(permissions, outside, "outside");

        await expect(compute.fs.readFile(permissions, outside)).resolves.toBe("outside");
    });

    it("uses per-operation read grants for private paths outside the workspace", async () => {
        const root = await makeTemporaryDirectory();
        const cwd = join(root, "workspace");
        const home = join(root, "home");
        await mkdir(join(home, ".codex", "skills"), { recursive: true });
        await mkdir(cwd, { recursive: true });
        await writeFile(join(home, ".codex", "skills", "user.txt"), "user\n");
        const compute = createHostCompute({
            ctx,
            cwd,
            home,
            platform: "win32",
        });
        computes.push(compute);
        const permissions = computePermissions("workspace_write", {
            allowedReadPaths: [join(home, ".codex", "skills")],
        });

        await expect(compute.fs.readFile(permissions, "~/.codex/skills/user.txt")).resolves.toBe(
            "user\n",
        );
    });

    it("allows a per-operation write grant outside the workspace", async () => {
        const root = await makeTemporaryDirectory();
        const cwd = join(root, "workspace");
        const outside = join(root, "output");
        await Promise.all([mkdir(cwd, { recursive: true }), mkdir(outside, { recursive: true })]);
        const compute = createHostCompute({ ctx, cwd });
        computes.push(compute);
        const permissions = computePermissions("workspace_write", {
            allowedWritePaths: [outside],
        });

        await compute.fs.writeFile(permissions, join(outside, "artifact.txt"), "built");

        await expect(
            compute.fs.readFile(computePermissions("full_access"), join(outside, "artifact.txt")),
        ).resolves.toBe("built");
    });

    it("lets explicit read and write denials beat grants", async () => {
        const root = await makeTemporaryDirectory();
        const cwd = join(root, "workspace");
        const denied = join(cwd, "denied");
        await mkdir(denied, { recursive: true });
        await writeFile(join(denied, "original.txt"), "original");
        const compute = createHostCompute({ ctx, cwd });
        computes.push(compute);
        const permissions = computePermissions("auto", {
            allowedReadPaths: [denied],
            deniedReadPaths: [denied],
            allowedWritePaths: [denied],
            deniedWritePaths: [denied],
        });

        await expect(compute.fs.readFile(permissions, "denied/original.txt")).rejects.toThrow(
            "denied path",
        );
        await expect(
            compute.fs.writeFile(permissions, "denied/original.txt", "changed"),
        ).rejects.toThrow("denied path");
        await expect(
            compute.fs.readFile(computePermissions("full_access"), "denied/original.txt"),
        ).resolves.toBe("original");
    });

    it("uses the permission value passed to each call without retaining the previous one", async () => {
        const { compute } = await hostCompute();
        const readOnly = computePermissions("read_only");
        const workspaceWrite = computePermissions("workspace_write");

        await expect(compute.fs.writeFile(readOnly, "note.txt", "no")).rejects.toThrow(
            "read-only mode",
        );
        await compute.fs.writeFile(workspaceWrite, "note.txt", "yes");
        await expect(compute.fs.readFile(readOnly, "note.txt")).resolves.toBe("yes");
    });

    it("applies the compute host policy to direct filesystem operations", async () => {
        const root = await makeTemporaryDirectory();
        const cwd = join(root, "workspace");
        const privateDirectory = join(root, "private");
        const readableDirectory = join(root, "reference");
        await Promise.all([
            mkdir(cwd, { recursive: true }),
            mkdir(privateDirectory, { recursive: true }),
            mkdir(readableDirectory, { recursive: true }),
        ]);
        await Promise.all([
            writeFile(join(privateDirectory, "token"), "secret"),
            writeFile(join(readableDirectory, "guide.md"), "guide"),
        ]);
        const compute = createHostCompute({
            ctx,
            cwd,
            hostPolicy: {
                privateDirectories: [privateDirectory],
                protectedProjectFiles: ["agent-policy.toml"],
                readableDirectories: [readableDirectory],
            },
            platform: "win32",
        });
        computes.push(compute);

        await expect(
            compute.fs.readFile(computePermissions("full_access"), join(privateDirectory, "token")),
        ).rejects.toThrow("denied path");
        await expect(
            compute.fs.readFile(
                computePermissions("workspace_write"),
                join(readableDirectory, "guide.md"),
            ),
        ).resolves.toBe("guide");
        await expect(
            compute.fs.writeFile(
                computePermissions("workspace_write"),
                "agent-policy.toml",
                "changed",
            ),
        ).rejects.toThrow("protected project file");
    });
});

describe("createHostCompute process manager ownership", () => {
    it("shuts down the process manager it constructs", async () => {
        const root = await makeTemporaryDirectory();
        const cwd = join(root, "workspace");
        await mkdir(cwd, { recursive: true });
        const killAll = vi.spyOn(NativeProcessManager.prototype, "killAll");
        const compute = createHostCompute({
            ctx,
            cwd,
        });

        await compute.dispose(ctx);

        expect(killAll).toHaveBeenCalledWith(ctx, {
            forceAfterMs: 2_000,
            includeDetached: true,
        });
    });

    it("leaves an injected process manager under caller ownership", async () => {
        const root = await makeTemporaryDirectory();
        const cwd = join(root, "workspace");
        await mkdir(cwd, { recursive: true });
        const processManager = new NativeProcessManager(ctx);
        const killAll = vi.spyOn(processManager, "killAll");
        const compute = createHostCompute({
            ctx,
            cwd,
            processManager,
        });

        await compute.dispose(ctx);

        expect(killAll).not.toHaveBeenCalled();
    });
});

async function hostCompute(): Promise<{ compute: Compute; cwd: string }> {
    const root = await makeTemporaryDirectory();
    const cwd = join(root, "workspace");
    await mkdir(cwd, { recursive: true });
    const compute = createHostCompute({ ctx, cwd });
    computes.push(compute);
    return { compute, cwd };
}

async function makeTemporaryDirectory(): Promise<string> {
    const path = await mkdtemp(join(tmpdir(), "host-compute-"));
    temporaryDirectories.push(path);
    return path;
}
