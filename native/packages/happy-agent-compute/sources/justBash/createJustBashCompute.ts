import { posix } from "node:path";

import { InMemoryFs, MountableFs, ReadWriteFs, type InitialFiles } from "just-bash";

import type { Compute } from "../Compute.js";
import type { ComputeHostPolicy } from "../ComputeHostPolicy.js";
import { createJustBashComputeFromFileSystem } from "./createJustBashComputeFromFileSystem.js";

/** An entirely process-local just-bash machine. */
export interface JustBashMemoryComputeOptions {
    readonly storage: "memory";
    /** The fixed virtual directory commands and relative filesystem paths use. */
    readonly cwd: string;
    readonly files?: InitialFiles;
    readonly hostPolicy?: ComputeHostPolicy;
}

/** A just-bash machine whose working directory is mounted from one host folder. */
export interface JustBashFolderComputeOptions {
    readonly storage: "folder";
    /** The fixed virtual directory where `folder` is mounted. */
    readonly cwd: string;
    /** The fixed host folder exposed at `cwd`. */
    readonly folder: string;
    readonly hostPolicy?: ComputeHostPolicy;
}

/** The two storage shapes a just-bash compute can be constructed with. */
export type JustBashComputeOptions = JustBashFolderComputeOptions | JustBashMemoryComputeOptions;

/**
 * Creates one isolated just-bash filesystem and shell.
 *
 * The storage choice is explicit because an in-memory machine and a host-backed folder have
 * meaningfully different durability. Neither shape is inferred from which optional fields happen
 * to be present.
 */
export function createJustBashCompute(options: JustBashComputeOptions): Compute {
    const cwd = normalizeCwd(options.cwd);
    const storage = (() => {
        if (options.storage === "memory") {
            const memory = new InMemoryFs(options.files);
            memory.mkdirSync(cwd, { recursive: true });
            return memory;
        }
        return new MountableFs({
            base: new InMemoryFs(),
            mounts: [
                {
                    mountPoint: cwd,
                    filesystem: new ReadWriteFs({
                        root: options.folder,
                        maxFileReadSize: 0,
                    }),
                },
            ],
        });
    })();
    return createJustBashComputeFromFileSystem({
        cwd,
        fileSystem: storage,
        home: cwd,
        ...(options.hostPolicy === undefined ? {} : { hostPolicy: options.hostPolicy }),
    });
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
