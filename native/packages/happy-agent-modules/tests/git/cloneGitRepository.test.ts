import { execFile as execFileCallback } from "node:child_process";
import { access, lstat, mkdir, readdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
    cloneRemoteRepository,
    type GitCloneExecFile,
} from "../../sources/git/cloneRemoteRepository.js";
import { cleanupRoots, commitFile, createRepository, createRoot, git } from "./helpers.js";

const execFile = promisify(execFileCallback);
afterEach(cleanupRoots);

describe("cloneRemoteRepository", () => {
    it("clones into staging, proves origin, and atomically installs the destination", async () => {
        const source = await createRepository();
        await commitFile(source, "README.md", "fixture\n");
        const parent = await createRoot();
        const destination = join(parent, "clone");
        const expectedRemote = "https://git.example.test/team/example.git";
        let invocation: readonly string[] | undefined;
        const execute: GitCloneExecFile = async (file, args, options) => {
            invocation = args;
            const staging = args[3];
            if (staging === undefined) throw new Error("Expected a staging destination.");
            const result = await execFile(file, ["clone", "--quiet", "--", source, staging], {
                encoding: "utf8",
                env: options.env,
                maxBuffer: options.maxBuffer,
                timeout: options.timeout,
            });
            await git(staging, ["remote", "set-url", "origin", expectedRemote]);
            return result;
        };

        await cloneRemoteRepository({
            destination,
            execFile: execute,
            gitIdentity: { email: "steve@example.com", name: "Steve Korshakov" },
            source: { kind: "git", url: expectedRemote },
        });

        expect(invocation?.slice(0, 3)).toEqual(["clone", "--", expectedRemote]);
        expect(invocation?.[3]).not.toBe(destination);
        await expect(access(join(destination, "README.md"))).resolves.toBeUndefined();
        expect(await git(destination, ["remote", "get-url", "origin"])).toBe(expectedRemote);
        expect(await readdir(join(parent, ".rig", "clones"))).toEqual([]);
    });

    it("clones without inventing a Git identity when none is configured", async () => {
        const source = await createRepository();
        await commitFile(source, "README.md", "fixture\n");
        const parent = await createRoot();
        const destination = join(parent, "clone");
        const expectedRemote = "https://git.example.test/team/anonymous.git";
        let environment: NodeJS.ProcessEnv | undefined;
        const execute: GitCloneExecFile = async (file, args, options) => {
            environment = options.env;
            const staging = args[3];
            if (staging === undefined) throw new Error("Expected a staging destination.");
            const result = await execFile(file, ["clone", "--quiet", "--", source, staging], {
                encoding: "utf8",
                env: options.env,
                maxBuffer: options.maxBuffer,
                timeout: options.timeout,
            });
            await git(staging, ["remote", "set-url", "origin", expectedRemote]);
            return result;
        };

        await cloneRemoteRepository({
            destination,
            execFile: execute,
            source: { kind: "git", url: expectedRemote },
        });

        expect(environment?.GIT_AUTHOR_NAME).toBeUndefined();
        expect(environment?.GIT_AUTHOR_EMAIL).toBeUndefined();
        expect(environment?.GIT_COMMITTER_NAME).toBeUndefined();
        expect(environment?.GIT_COMMITTER_EMAIL).toBeUndefined();
        await expect(access(join(destination, "README.md"))).resolves.toBeUndefined();
    });

    it("removes a partial staging clone after failure", async () => {
        const parent = await createRoot();
        const destination = join(parent, "clone");
        await expect(
            cloneRemoteRepository({
                destination,
                execFile: async (_file, args) => {
                    const staging = args[3];
                    if (staging === undefined) throw new Error("Expected staging.");
                    await execFile("git", ["init", "--quiet", staging]);
                    throw new Error("clone failed");
                },
                gitIdentity: { email: "steve@example.com", name: "Steve Korshakov" },
                source: { kind: "git", url: "https://git.example.test/team/example.git" },
            }),
        ).rejects.toThrow("clone failed");
        await expect(lstat(destination)).rejects.toThrow();
        expect(await readdir(join(parent, ".rig", "clones"))).toEqual([]);
    });

    it.each([".rig", ".rig/clones"])(
        "refuses a symlinked managed clone root at %s",
        async (path) => {
            const parent = await createRoot();
            const redirected = await createRoot();
            if (path.includes("/")) await mkdir(join(parent, ".rig"));
            await symlink(redirected, join(parent, path));

            await expect(
                cloneRemoteRepository({
                    destination: join(parent, "clone"),
                    execFile: async () => {
                        throw new Error("must not execute");
                    },
                    gitIdentity: { email: "steve@example.com", name: "Steve Korshakov" },
                    source: { kind: "git", url: "https://git.example.test/team/example.git" },
                }),
            ).rejects.toThrow(/symbolic link/u);
            expect(await readdir(redirected)).toEqual([]);
        },
    );

    it.each([
        "file:///tmp/repository",
        "/tmp/repository",
        "ext::sh -c whoami",
        "https://token:secret@git.example/team/example.git",
        "ssh://git@git.example/team/example.git",
    ])("rejects unsafe remote %j", async (url) => {
        await expect(
            cloneRemoteRepository({
                destination: join(await createRoot(), "clone"),
                execFile: async () => {
                    throw new Error("must not execute");
                },
                gitIdentity: { email: "steve@example.com", name: "Steve Korshakov" },
                source: { kind: "git", url },
            }),
        ).rejects.toThrow(/Git remote URL/u);
    });
});
