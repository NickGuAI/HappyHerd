import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { GitCommandRunner } from "../../sources/git/GitCommandRunner.js";
import { detectGitDefaultBranch } from "../../sources/git/detectGitDefaultBranch.js";
import { parseHostingRepository } from "../../sources/git/parseHostingRepository.js";
import { probeGitRepository } from "../../sources/git/probeGitRepository.js";
import { remoteProjectName } from "../../sources/git/remoteProjectName.js";
import { resolveWorkspaceBase } from "../../sources/git/resolveWorkspaceBase.js";
import {
    cleanupRoots,
    commitFile,
    createRepository,
    git,
    gitRunner,
    setOriginMain,
} from "./helpers.js";

afterEach(cleanupRoots);

describe("repository facts and workspace base", () => {
    it("probes roots, rejects nested folders, and detects the default branch", async () => {
        const repository = await createRepository();
        const head = await commitFile(repository, "README.md", "fixture\n");
        const nested = join(repository, "nested");
        await mkdir(nested);

        expect(await detectGitDefaultBranch(gitRunner, repository)).toBe("main");
        expect(await probeGitRepository({ git: gitRunner, path: repository })).toMatchObject({
            facts: { branch: "main", head },
            presence: "present",
            worktreeSupport: "supported",
        });
        expect(await probeGitRepository({ git: gitRunner, path: nested })).toMatchObject({
            worktreeSupport: "unsupported",
            worktreeSupportReason: "This folder is inside a Git repository but is not its root.",
        });
    });

    it("forks origin/main rather than a moved local main", async () => {
        const repository = await createRepository();
        const remoteHead = await commitFile(repository, "base.txt", "base\n");
        await setOriginMain(repository, remoteHead);
        await commitFile(repository, "local.txt", "local\n");

        await expect(
            resolveWorkspaceBase({
                defaultBranch: "main",
                git: gitRunner,
                projectPath: repository,
            }),
        ).resolves.toEqual({ commit: remoteHead, ref: "origin/main" });
    });

    it("bounds fetch and threads the caller's abort signal through base resolution", async () => {
        const repository = await createRepository();
        const remoteHead = await commitFile(repository, "base.txt", "base\n");
        await setOriginMain(repository, remoteHead);
        await git(repository, ["remote", "add", "origin", "https://example.test/repository.git"]);
        const controller = new AbortController();
        const calls: Array<{
            args: readonly string[];
            signal: AbortSignal | undefined;
            timeoutMs: number | undefined;
        }> = [];
        const runner: GitCommandRunner = {
            async run(cwd, args, options) {
                calls.push({
                    args,
                    signal: options?.signal,
                    timeoutMs: options?.timeoutMs,
                });
                if (args[0] === "fetch") {
                    return { code: 1, stderr: "offline", stdout: "" };
                }
                return await gitRunner.run(cwd, args, options);
            },
        };

        await expect(
            resolveWorkspaceBase({
                defaultBranch: "main",
                git: runner,
                projectPath: repository,
                signal: controller.signal,
            }),
        ).resolves.toEqual({ commit: remoteHead, ref: "origin/main" });
        const fetch = calls.find((call) => call.args[0] === "fetch");
        expect(fetch?.timeoutMs).toBeGreaterThanOrEqual(60_000);
        expect(calls.every((call) => call.signal === controller.signal)).toBe(true);
    });

    it("reports the branch, its upstream, and how far it has diverged", async () => {
        const repository = await createRepository();
        const base = await commitFile(repository, "base.txt", "base\n");
        await setOriginMain(repository, base);
        await git(repository, ["remote", "add", "origin", repository]);
        await git(repository, ["config", "branch.main.remote", "origin"]);
        await git(repository, ["config", "branch.main.merge", "refs/heads/main"]);
        const head = await commitFile(repository, "local.txt", "local\n");

        expect(await probeGitRepository({ git: gitRunner, path: repository })).toMatchObject({
            facts: {
                ahead: 1,
                behind: 0,
                branch: "main",
                detached: false,
                head,
                upstream: "origin/main",
            },
        });
    });

    it("parses hosting identity without accepting local paths", () => {
        expect(remoteProjectName("https://github.com/slopus/rig.git")).toBe("rig");
        expect(remoteProjectName("git@github.com:slopus/rig.git")).toBe("rig");
        expect(remoteProjectName("/tmp/rig.git")).toBeUndefined();
        // A hosting name arrives percent-encoded and is shown as the characters it stands for.
        expect(remoteProjectName("https://github.com/slopus/%E2%98%83.git")).toBe("☃");
        expect(parseHostingRepository("git@github.com:slopus/rig.git")).toEqual({
            host: "github.com",
            owner: "slopus",
            repository: "rig",
        });
    });
});
