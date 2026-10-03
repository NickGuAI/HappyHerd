import { posix } from "node:path";

import type {
    CpOptions,
    FileContent,
    FsStat,
    IFileSystem,
    MkdirOptions,
    RmOptions,
} from "just-bash";

import type { ComputePermissions } from "../../ComputePermissions.js";
import type { ComputeHostPolicy } from "../../ComputeHostPolicy.js";
import { projectProtectedFileNames } from "../../sandbox/impl/projectProtectedFileNames.js";

/**
 * The permission boundary underneath both filesystem calls and shell commands.
 *
 * Shell redirections write through just-bash's filesystem directly, so checking only the
 * public `ComputeFileSystem` would leave a second, unguarded route to the same files.
 */
export class JustBashPermissionFileSystem implements IFileSystem {
    readonly #cwd: string;
    readonly #fs: IFileSystem;
    readonly #hostPolicy: ComputeHostPolicy;
    readonly #permissions: ComputePermissions;

    constructor(
        fs: IFileSystem,
        cwd: string,
        permissions: ComputePermissions,
        hostPolicy: ComputeHostPolicy = {},
    ) {
        this.#cwd = cwd;
        this.#fs = fs;
        this.#hostPolicy = hostPolicy;
        this.#permissions = permissions;
    }

    async readFile(
        path: string,
        options?: Parameters<IFileSystem["readFile"]>[1],
    ): Promise<string> {
        await this.#assertReadable(path);
        return await this.#fs.readFile(path, options);
    }

    async readFileBytes(
        path: string,
    ): Promise<Awaited<ReturnType<NonNullable<IFileSystem["readFileBytes"]>>>> {
        await this.#assertReadable(path);
        if (this.#fs.readFileBytes !== undefined) return await this.#fs.readFileBytes(path);
        return (await this.#fs.readFile(path, "binary")) as unknown as Awaited<
            ReturnType<NonNullable<IFileSystem["readFileBytes"]>>
        >;
    }

    async readFileBuffer(path: string): Promise<Uint8Array> {
        await this.#assertReadable(path);
        return await this.#fs.readFileBuffer(path);
    }

    async writeFile(
        path: string,
        content: FileContent,
        options?: Parameters<IFileSystem["writeFile"]>[2],
    ): Promise<void> {
        await this.#assertWritable(path);
        await this.#fs.writeFile(path, content, options);
    }

    async appendFile(
        path: string,
        content: FileContent,
        options?: Parameters<IFileSystem["appendFile"]>[2],
    ): Promise<void> {
        await this.#assertWritable(path);
        await this.#fs.appendFile(path, content, options);
    }

    async exists(path: string): Promise<boolean> {
        await this.#assertReadable(path);
        return await this.#fs.exists(path);
    }

    async stat(path: string): Promise<FsStat> {
        await this.#assertReadable(path);
        return await this.#fs.stat(path);
    }

    async mkdir(path: string, options?: MkdirOptions): Promise<void> {
        await this.#assertWritable(path);
        await this.#fs.mkdir(path, options);
    }

    async readdir(path: string): Promise<string[]> {
        await this.#assertReadable(path);
        return await this.#fs.readdir(path);
    }

    async readdirWithFileTypes(
        path: string,
    ): Promise<Awaited<ReturnType<NonNullable<IFileSystem["readdirWithFileTypes"]>>>> {
        await this.#assertReadable(path);
        if (this.#fs.readdirWithFileTypes !== undefined) {
            return await this.#fs.readdirWithFileTypes(path);
        }
        return await Promise.all(
            (await this.#fs.readdir(path)).map(async (name) => {
                const stat = await this.#fs.lstat(posix.join(path, name));
                return {
                    name,
                    isFile: stat.isFile,
                    isDirectory: stat.isDirectory,
                    isSymbolicLink: stat.isSymbolicLink,
                };
            }),
        );
    }

    async rm(path: string, options?: RmOptions): Promise<void> {
        await this.#assertWritable(path, false);
        await this.#fs.rm(path, options);
    }

    async cp(source: string, destination: string, options?: CpOptions): Promise<void> {
        await this.#assertReadable(source);
        await this.#assertWritable(destination);
        await this.#fs.cp(source, destination, options);
    }

    async mv(source: string, destination: string): Promise<void> {
        await this.#assertWritable(source, false);
        await this.#assertWritable(destination, false);
        await this.#fs.mv(source, destination);
    }

    resolvePath(base: string, path: string): string {
        return this.#fs.resolvePath(base, path);
    }

    getAllPaths(): string[] {
        return this.#fs
            .getAllPaths()
            .filter((path) => !this.#isDeniedReadPath(this.#fs.resolvePath(this.#cwd, path)));
    }

    async chmod(path: string, mode: number): Promise<void> {
        await this.#assertWritable(path);
        await this.#fs.chmod(path, mode);
    }

    async symlink(target: string, linkPath: string): Promise<void> {
        await this.#assertWritable(linkPath, false);
        await this.#fs.symlink(target, linkPath);
    }

    async link(existingPath: string, newPath: string): Promise<void> {
        await this.#assertWritable(newPath, false);
        await this.#fs.link(existingPath, newPath);
    }

    async readlink(path: string): Promise<string> {
        await this.#assertReadable(path, false);
        return await this.#fs.readlink(path);
    }

    async lstat(path: string): Promise<FsStat> {
        await this.#assertReadable(path, false);
        return await this.#fs.lstat(path);
    }

    async realpath(path: string): Promise<string> {
        await this.#assertReadable(path);
        return await this.#fs.realpath(path);
    }

    async utimes(path: string, atime: Date, mtime: Date): Promise<void> {
        await this.#assertWritable(path);
        await this.#fs.utimes(path, atime, mtime);
    }

    async #assertReadable(path: string, followFinal = true): Promise<void> {
        const target = this.#fs.resolvePath(this.#cwd, path);
        const canonicalTarget = await this.#resolvePotentialPath(target, followFinal);
        if (this.#isDeniedReadPath(target) || this.#isDeniedReadPath(canonicalTarget)) {
            throw new Error(`Permission boundary blocks reading the denied path: ${target}.`);
        }
    }

    async #assertWritable(path: string, followFinal = true): Promise<void> {
        const mode = this.#permissions.mode;
        const target = this.#fs.resolvePath(this.#cwd, path);
        const canonicalTarget = await this.#resolvePotentialPath(target, followFinal);
        if (this.#isDeniedWritePath(target) || this.#isDeniedWritePath(canonicalTarget)) {
            throw new Error(`Permission boundary blocks modifying the denied path: ${target}.`);
        }
        if (mode === "full_access") return;
        if (mode === "read_only") {
            throw new Error("File changes are disabled in read-only mode.");
        }

        const canonicalCwd = await this.#resolvePotentialPath(this.#cwd, true);
        const allowed =
            this.#isAllowedWritePath(target) || this.#isAllowedWritePath(canonicalTarget);
        if (
            (!isWithin(this.#cwd, target) || !isWithin(canonicalCwd, canonicalTarget)) &&
            !allowed
        ) {
            throw new Error(
                `Workspace write mode cannot modify files outside the working directory: ${this.#cwd}.`,
            );
        }
    }

    #isAllowedWritePath(target: string): boolean {
        return (this.#permissions.allowedWritePaths ?? []).some((allowedPath) =>
            isWithin(this.#fs.resolvePath(this.#cwd, allowedPath), target),
        );
    }

    #isDeniedReadPath(target: string): boolean {
        return this.#isWithinAny(target, [
            ...(this.#permissions.deniedReadPaths ?? []),
            ...(this.#hostPolicy.privateDirectories ?? []),
        ]);
    }

    #isDeniedWritePath(target: string): boolean {
        if (
            this.#isWithinAny(target, [
                ...(this.#permissions.deniedWritePaths ?? []),
                ...(this.#hostPolicy.privateDirectories ?? []),
            ])
        ) {
            return true;
        }
        return (
            this.#permissions.mode !== "full_access" &&
            projectProtectedFileNames(this.#hostPolicy).some(
                (name) => target === this.#fs.resolvePath(this.#cwd, name),
            )
        );
    }

    #isWithinAny(target: string, paths: readonly string[]): boolean {
        const deniedPaths = paths;
        for (const deniedPath of deniedPaths) {
            if (isWithin(this.#fs.resolvePath(this.#cwd, deniedPath), target)) return true;
        }
        return false;
    }

    /**
     * Resolves the existing part of a path, then puts its missing suffix back.
     *
     * A new file cannot itself be passed to `realpath`, but one of its parents may be a symlink.
     * Resolving that parent prevents a write spelled inside the workspace from landing outside it.
     */
    async #resolvePotentialPath(path: string, followFinal: boolean): Promise<string> {
        const normalized = posix.normalize(path);
        const suffix: string[] = [];
        let existing = followFinal ? normalized : posix.dirname(normalized);
        if (!followFinal) suffix.unshift(posix.basename(normalized));

        for (;;) {
            try {
                return posix.join(await this.#fs.realpath(existing), ...suffix);
            } catch {
                const parent = posix.dirname(existing);
                if (parent === existing) return normalized;
                suffix.unshift(posix.basename(existing));
                existing = parent;
            }
        }
    }
}

function isWithin(directory: string, path: string): boolean {
    const relative = posix.relative(posix.normalize(directory), posix.normalize(path));
    return relative === "" || (!relative.startsWith("../") && relative !== "..");
}
