import { posix } from "node:path";

import { Bash, type IFileSystem } from "just-bash";
import type { Context } from "@steve.kite/stdlib";

import type { Compute } from "../Compute.js";
import type { ComputeHostPolicy } from "../ComputeHostPolicy.js";
import { createJustBashFileSystem } from "./impl/createJustBashFileSystem.js";
import { createJustBashShell } from "./impl/createJustBashShell.js";

/** A just-bash machine over a caller-owned virtual filesystem topology. */
export interface JustBashFileSystemComputeOptions {
    /** The fixed virtual directory commands and relative filesystem paths use. */
    readonly cwd: string;
    /** The caller-owned filesystem, which may contain any mount topology just-bash supports. */
    readonly fileSystem: IFileSystem;
    /** The virtual home directory exposed through `HOME`, `~`, and the compute filesystem. */
    readonly home: string;
    readonly hostPolicy?: ComputeHostPolicy;
}

/**
 * A compute over custom storage, with the guarded Bash and raw caller-owned storage available for
 * test setup that cannot go through the agent's permission boundary.
 */
export interface JustBashFileSystemCompute extends Compute {
    readonly bash: Bash;
    readonly rawFileSystem: IFileSystem;
}

/**
 * Creates a just-bash compute over an existing filesystem topology.
 *
 * The raw filesystem remains caller-owned. Each agent-facing operation wraps it with the
 * immutable permissions carried by that operation, so shell redirections and direct filesystem
 * calls enforce the same boundary without sharing ambient policy.
 */
export function createJustBashComputeFromFileSystem(
    options: JustBashFileSystemComputeOptions,
): JustBashFileSystemCompute {
    const cwd = normalizeCwd(options.cwd);
    const home = normalizeHome(options.home);
    const bash = new Bash({
        cwd,
        env: { HOME: home },
        fs: options.fileSystem,
    });
    const hostPolicy = options.hostPolicy ?? {};
    const shell = createJustBashShell(options.fileSystem, cwd, home, hostPolicy);

    return {
        bash,
        id: "just-bash",
        kind: "emulated",
        cwd,
        fs: createJustBashFileSystem(options.fileSystem, cwd, home, hostPolicy),
        rawFileSystem: options.fileSystem,
        shell,
        async dispose(_ctx: Context) {
            shell.setSessionExitListener?.(undefined);
            shell.setActiveSessionCountListener?.(undefined);
            await shell.killAllSessions?.();
        },
    };
}

function normalizeCwd(cwd: string): string {
    if (!posix.isAbsolute(cwd)) {
        throw new Error("The just-bash working directory must be an absolute virtual path.");
    }
    const normalized = posix.normalize(cwd);
    if (normalized === "/") {
        throw new Error("The just-bash working directory must be below the virtual root.");
    }
    return normalized;
}

function normalizeHome(home: string): string {
    if (!posix.isAbsolute(home)) {
        throw new Error("The just-bash home directory must be an absolute virtual path.");
    }
    return posix.normalize(home);
}
