import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Context } from "@steve.kite/stdlib";
import { InMemoryFs, MountableFs } from "just-bash";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Compute } from "../../sources/Compute.js";
import { computePermissions } from "../../sources/ComputePermissions.js";
import { createJustBashCompute } from "../../sources/justBash/createJustBashCompute.js";
import { createJustBashComputeFromFileSystem } from "../../sources/justBash/createJustBashComputeFromFileSystem.js";

const computes: Compute[] = [];
const temporaryDirectories: string[] = [];
const unusedContext = {} as Context;
const workspacePermissions = computePermissions("workspace_write");

afterEach(async () => {
    await Promise.all(computes.splice(0).map((compute) => compute.dispose(unusedContext)));
    await Promise.all(
        temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
});

describe("createJustBashCompute filesystem", () => {
    it("identifies its provider without retaining machine-wide permissions", () => {
        const compute = memoryCompute();

        expect(compute.id).toBe("just-bash");
        expect(compute.kind).toBe("emulated");
        expect("permissions" in compute).toBe(false);
    });

    it("reads and writes files in memory relative to its fixed working directory", async () => {
        const compute = memoryCompute();

        await compute.fs.writeFile(workspacePermissions, "notes/greeting.txt", "hello");

        await expect(
            compute.fs.readFile(workspacePermissions, "/workspace/notes/greeting.txt"),
        ).resolves.toBe("hello");
        await expect(
            compute.fs.stat(workspacePermissions, "notes/greeting.txt"),
        ).resolves.toMatchObject({
            isFile: true,
            isDirectory: false,
            size: 5,
        });
    });

    it("uses a caller-owned multi-mount topology with home outside the workspace", async () => {
        const topology = new MountableFs({
            base: new InMemoryFs(),
            mounts: [
                {
                    mountPoint: "/workspace",
                    filesystem: new InMemoryFs({ "/project.txt": "workspace" }),
                },
                {
                    mountPoint: "/home/user",
                    filesystem: new InMemoryFs({ "/profile.txt": "home" }),
                },
            ],
        });
        const compute = createJustBashComputeFromFileSystem({
            cwd: "/workspace",
            fileSystem: topology,
            home: "/home/user",
        });
        computes.push(compute);

        expect(compute.rawFileSystem).toBe(topology);
        expect(compute.fs.home).toBe("/home/user");
        await expect(compute.fs.readFile(workspacePermissions, "~/profile.txt")).resolves.toBe(
            "home",
        );
        await expect(
            compute.shell.run({
                command: 'printf "%s\\n" "$HOME"; cat ~/profile.txt',
                permissions: workspacePermissions,
            }),
        ).resolves.toMatchObject({
            exitCode: 0,
            stdout: "/home/user\nhome",
        });
    });

    it("mounts a fixed host folder at the virtual working directory", async () => {
        const folder = await mkdtemp(join(tmpdir(), "agent-compute-just-bash-folder-"));
        temporaryDirectories.push(folder);
        const compute = createJustBashCompute({
            storage: "folder",
            cwd: "/workspace",
            folder,
        });
        computes.push(compute);

        await compute.fs.writeFile(workspacePermissions, "persisted.txt", "on disk");

        await expect(readFile(join(folder, "persisted.txt"), "utf8")).resolves.toBe("on disk");
    });

    it("pages directory names in UTF-8 byte order", async () => {
        const compute = memoryCompute({
            "/workspace/zeta": "",
            "/workspace/.context": "",
            "/workspace/alpha": "",
            "/workspace/middle": "",
            "/workspace/éclair": "",
        });

        await expect(
            compute.fs.readdirPage(workspacePermissions, ".", { limit: 2 }),
        ).resolves.toEqual({
            entries: [".context", "alpha"],
            hasMore: true,
        });
        await expect(
            compute.fs.readdirPage(workspacePermissions, ".", { after: "alpha", limit: 3 }),
        ).resolves.toEqual({
            entries: ["middle", "zeta", "éclair"],
            hasMore: false,
        });
    });
});

describe("createJustBashCompute permissions", () => {
    it("refuses direct and shell writes in read-only mode", async () => {
        const compute = memoryCompute();
        const permissions = computePermissions("read_only");

        await expect(compute.fs.writeFile(permissions, "blocked.txt", "no")).rejects.toThrow(
            "read-only mode",
        );
        const result = await compute.shell.run({
            command: "echo no > blocked.txt",
            permissions,
        });

        expect(result.exitCode).not.toBe(0);
        await expect(compute.fs.exists(permissions, "blocked.txt")).resolves.toBe(false);
    });

    it("refuses writes outside the working directory", async () => {
        const compute = memoryCompute();

        await expect(
            compute.fs.writeFile(workspacePermissions, "../outside.txt", "no"),
        ).rejects.toThrow("outside the working directory");
        const result = await compute.shell.run({
            command: "echo no > /outside.txt",
            permissions: workspacePermissions,
        });

        expect(result.exitCode).not.toBe(0);
        await expect(compute.fs.exists(workspacePermissions, "/outside.txt")).resolves.toBe(false);
    });

    it("guards shell redirection through a custom topology's symlinked parent", async () => {
        const topology = new InMemoryFs();
        topology.mkdirSync("/workspace", { recursive: true });
        topology.mkdirSync("/outside", { recursive: true });
        await topology.symlink("/outside", "/workspace/escape");
        const compute = createJustBashComputeFromFileSystem({
            cwd: "/workspace",
            fileSystem: topology,
            home: "/home/user",
        });
        computes.push(compute);

        const result = await compute.shell.run({
            command: "echo blocked > escape/from-shell.txt",
            permissions: workspacePermissions,
        });

        expect(result.exitCode).not.toBe(0);
        await expect(topology.exists("/outside/from-shell.txt")).resolves.toBe(false);
    });

    it("refuses per-operation denied write paths", async () => {
        const compute = memoryCompute({ "/workspace/protected/original.txt": "original" });
        const permissions = computePermissions("workspace_write", {
            deniedWritePaths: ["/workspace/protected"],
        });

        await expect(
            compute.fs.writeFile(permissions, "protected/original.txt", "changed"),
        ).rejects.toThrow("denied path");
        const result = await compute.shell.run({
            command: "echo changed > protected/from-shell.txt",
            permissions,
        });

        expect(result.exitCode).not.toBe(0);
        await expect(compute.fs.readFile(permissions, "protected/original.txt")).resolves.toBe(
            "original",
        );
        await expect(compute.fs.exists(permissions, "protected/from-shell.txt")).resolves.toBe(
            false,
        );
    });

    it("allows full access to write outside the workspace", async () => {
        const compute = memoryCompute();
        const permissions = computePermissions("full_access");

        await compute.fs.writeFile(permissions, "/outside.txt", "outside");

        await expect(compute.fs.readFile(permissions, "/outside.txt")).resolves.toBe("outside");
    });

    it("allows explicit writes outside the workspace unless the same path is denied", async () => {
        const compute = memoryCompute();
        const allowed = computePermissions("workspace_write", {
            allowedWritePaths: ["/output"],
        });
        const denied = computePermissions("workspace_write", {
            allowedWritePaths: ["/output"],
            deniedWritePaths: ["/output/private"],
        });

        await compute.fs.writeFile(allowed, "/output/artifact.txt", "built");
        await expect(
            compute.fs.writeFile(denied, "/output/private/secret.txt", "blocked"),
        ).rejects.toThrow("denied path");
        await expect(
            compute.fs.readFile(computePermissions("full_access"), "/output/artifact.txt"),
        ).resolves.toBe("built");
    });

    it("lets a read denial beat an allow-list for direct calls and shell commands", async () => {
        const compute = memoryCompute({ "/workspace/private/secret.txt": "hidden" });
        const permissions = computePermissions("auto", {
            allowedReadPaths: ["/workspace/private"],
            deniedReadPaths: ["/workspace/private"],
        });

        await expect(compute.fs.readFile(permissions, "private/secret.txt")).rejects.toThrow(
            "denied path",
        );
        const result = await compute.shell.run({
            command: "cat private/secret.txt",
            permissions,
        });

        expect(result.exitCode).not.toBe(0);
        expect(result.stdout).not.toContain("hidden");
    });

    it("keeps concurrent shell commands on their own immutable permission values", async () => {
        const compute = memoryCompute();

        const [readOnly, workspaceWrite] = await Promise.all([
            compute.shell.run({
                command: "sleep 0.01; echo blocked > blocked.txt",
                permissions: computePermissions("read_only"),
            }),
            compute.shell.run({
                command: "echo allowed > allowed.txt",
                permissions: workspacePermissions,
            }),
        ]);

        expect(readOnly.exitCode).not.toBe(0);
        expect(workspaceWrite.exitCode).toBe(0);
        await expect(compute.fs.exists(workspacePermissions, "blocked.txt")).resolves.toBe(false);
        await expect(compute.fs.readFile(workspacePermissions, "allowed.txt")).resolves.toBe(
            "allowed\n",
        );
    });

    it("applies the host policy to direct calls and shell redirections", async () => {
        const compute = createJustBashCompute({
            storage: "memory",
            cwd: "/workspace",
            files: {
                "/private/token": "secret",
                "/workspace/agent-policy.toml": "original",
            },
            hostPolicy: {
                privateDirectories: ["/private"],
                protectedProjectFiles: ["agent-policy.toml"],
            },
        });
        computes.push(compute);

        await expect(
            compute.fs.readFile(computePermissions("full_access"), "/private/token"),
        ).rejects.toThrow("denied path");
        await expect(
            compute.fs.writeFile(workspacePermissions, "agent-policy.toml", "changed"),
        ).rejects.toThrow("denied path");
        const shellResult = await compute.shell.run({
            command: "echo changed > agent-policy.toml; cat /private/token",
            permissions: workspacePermissions,
        });
        expect(shellResult.exitCode).not.toBe(0);
        await expect(
            compute.fs.readFile(computePermissions("full_access"), "agent-policy.toml"),
        ).resolves.toBe("original");
    });
});

describe("createJustBashCompute shell", () => {
    it("runs a command in the fixed working directory", async () => {
        const compute = memoryCompute();

        await expect(
            compute.shell.run({ command: "pwd; echo hello", permissions: workspacePermissions }),
        ).resolves.toMatchObject({
            stdout: "/workspace\nhello\n",
            stderr: "",
            exitCode: 0,
            timedOut: false,
        });
    });

    it("returns only unread output on later session reads", async () => {
        const compute = memoryCompute();
        const sessionId = await compute.shell.startSession({
            command: "echo first; sleep 0.01; echo second",
            permissions: workspacePermissions,
        });

        let completed;
        await vi.waitFor(async () => {
            completed = await compute.shell.readSession(sessionId, { waitMs: 20 });
            expect(completed?.status).toBe("completed");
        });
        expect(completed).toMatchObject({
            stdoutDelta: "first\nsecond\n",
            stderrDelta: "",
        });

        await expect(compute.shell.readSession(sessionId)).resolves.toMatchObject({
            stdout: "first\nsecond\n",
            stdoutDelta: "",
            stderrDelta: "",
        });
    });

    it("kills a running background command", async () => {
        const compute = memoryCompute();
        const sessionId = await compute.shell.startSession({
            command: "while true; do sleep 0.01; done",
            permissions: workspacePermissions,
        });
        await vi.waitFor(() => expect(compute.shell.activeSessionCount?.()).toBe(1));

        await expect(compute.shell.killSession(sessionId)).resolves.toMatchObject({
            sessionId,
            status: "killed",
        });
        expect(compute.shell.activeSessionCount?.()).toBe(0);
    });

    it("marks a session timed out without stopping it", async () => {
        const compute = memoryCompute();
        const sessionId = await compute.shell.startSession({
            command: "sleep 0.01; echo survived",
            permissions: workspacePermissions,
            timeoutMs: 0,
        });

        await vi.waitFor(async () => {
            await expect(
                compute.shell.readSession(sessionId, { peek: true }),
            ).resolves.toMatchObject({
                status: "completed",
                stdout: "survived\n",
                timedOut: true,
            });
        });
    });

    it("reports unsupported session input instead of pretending to accept it", async () => {
        const compute = memoryCompute();
        const sessionId = await compute.shell.startSession({
            command: "sleep 0.01",
            permissions: workspacePermissions,
        });

        expect(compute.shell.supportsSessionInput).toBe(false);
        await expect(
            compute.shell.writeSession(workspacePermissions, sessionId, "input"),
        ).resolves.toBe(false);
    });

    it("reports a background exit that no read observed", async () => {
        const compute = memoryCompute();
        const exits: unknown[] = [];
        compute.shell.setSessionExitListener?.((exit) => {
            exits.push(exit);
        });

        await compute.shell.startSession({
            command: "echo finished",
            permissions: workspacePermissions,
        });

        await vi.waitFor(() =>
            expect(exits).toEqual([
                {
                    command: "echo finished",
                    exitCode: 0,
                    sessionId: 1,
                    status: "completed",
                },
            ]),
        );
    });

    it("stops its active sessions when disposed", async () => {
        const compute = memoryCompute();
        const sessionId = await compute.shell.startSession({
            command: "while true; do sleep 0.01; done",
            permissions: workspacePermissions,
        });

        await compute.dispose(unusedContext);

        await expect(compute.shell.readSession(sessionId)).resolves.toMatchObject({
            status: "killed",
        });
        expect(compute.shell.activeSessionCount?.()).toBe(0);
    });
});

function memoryCompute(files: Record<string, string> = {}): Compute {
    const compute = createJustBashCompute({
        storage: "memory",
        cwd: "/workspace",
        files,
    });
    computes.push(compute);
    return compute;
}
