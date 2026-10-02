import type { ComputeFileSystem, ComputePermissions } from "../Compute.js";
import {
    isPathInside,
    joinComputePath,
    parentComputePath,
    relativeComputePath,
} from "./resolveComputePath.js";
import { escapeRegExp } from "./escapeRegExp.js";

interface GitIgnoreRule {
    readonly directoryOnly: boolean;
    readonly negated: boolean;
    readonly expression: RegExp;
}

const MAX_GIT_IGNORE_BYTES = 128 * 1024;
const MAX_GIT_IGNORE_RULES = 4_096;

export interface GitIgnoreScope {
    readonly directory: string;
    readonly rules: readonly GitIgnoreRule[];
}

/** Read one directory's optional `.gitignore` file. */
export async function readGitIgnoreScope(
    fs: ComputeFileSystem,
    permissions: ComputePermissions,
    directory: string,
): Promise<GitIgnoreScope | undefined> {
    let bytes: Uint8Array;
    try {
        bytes = await fs.readFileBuffer(permissions, joinComputePath(directory, ".gitignore"), {
            maxBytes: MAX_GIT_IGNORE_BYTES + 1,
        });
    } catch {
        return undefined;
    }
    if (bytes.byteLength > MAX_GIT_IGNORE_BYTES) return undefined;
    const content = new TextDecoder().decode(bytes);
    const rules: GitIgnoreRule[] = [];
    for (const line of content.split(/\r?\n/)) {
        if (rules.length >= MAX_GIT_IGNORE_RULES) break;
        const rule = parseGitIgnoreRule(line);
        if (rule !== undefined) rules.push(rule);
    }
    return { directory, rules };
}

/**
 * Load the ignore files that govern a search root, from its Git root down to the root itself.
 *
 * A search may begin below the workspace root, but Git still applies the workspace's ignore
 * rules there. The nearest `.git` marker bounds the ancestor walk so a parent repository cannot
 * unexpectedly govern an unrelated search.
 */
export async function loadInitialGitIgnoreScopes(
    fs: ComputeFileSystem,
    permissions: ComputePermissions,
    root: string,
): Promise<readonly GitIgnoreScope[]> {
    const workspaceRoot = fs.cwd;
    if (isPathInside(workspaceRoot, root)) {
        if (await hasGitMarker(fs, permissions, workspaceRoot)) {
            const directories = descendantDirectories(workspaceRoot, root);
            if (directories !== undefined) {
                return await readScopes(fs, permissions, directories);
            }
        }
        // The compute workspace is the normal search boundary. If it is not a Git root, do not
        // walk every parent directory just to prove that no repository marker exists.
        return await readScopes(fs, permissions, [root]);
    }

    const ancestors = [root];
    let cursor = root;
    let gitRootIndex: number | undefined;
    while (true) {
        try {
            await fs.lstat(permissions, joinComputePath(cursor, ".git"));
            gitRootIndex = ancestors.length - 1;
            break;
        } catch {
            // A missing or unreadable marker is not the root of this search.
        }
        const parent = parentComputePath(cursor);
        if (parent === cursor) break;
        ancestors.push(parent);
        cursor = parent;
    }

    const directories =
        gitRootIndex === undefined ? [root] : ancestors.slice(0, gitRootIndex + 1).reverse();
    return await readScopes(fs, permissions, directories);
}

async function readScopes(
    fs: ComputeFileSystem,
    permissions: ComputePermissions,
    directories: readonly string[],
): Promise<readonly GitIgnoreScope[]> {
    const scopes: GitIgnoreScope[] = [];
    for (const directory of directories) {
        const scope = await readGitIgnoreScope(fs, permissions, directory);
        if (scope !== undefined) scopes.push(scope);
    }
    return scopes;
}

async function hasGitMarker(
    fs: ComputeFileSystem,
    permissions: ComputePermissions,
    directory: string,
): Promise<boolean> {
    try {
        await fs.lstat(permissions, joinComputePath(directory, ".git"));
        return true;
    } catch {
        return false;
    }
}

function descendantDirectories(root: string, target: string): readonly string[] | undefined {
    const directories: string[] = [];
    let cursor = target;
    while (true) {
        directories.push(cursor);
        if (cursor === root) return directories.reverse();
        const parent = parentComputePath(cursor);
        if (parent === cursor || !isPathInside(root, parent)) return undefined;
        cursor = parent;
    }
}

/** Apply nested Git ignore rules to one candidate path. */
export function isGitIgnored(
    path: string,
    isDirectory: boolean,
    scopes: readonly GitIgnoreScope[],
): boolean {
    let ignored = false;
    for (const scope of scopes) {
        if (!isPathInside(scope.directory, path)) continue;
        const relative = relativeComputePath(scope.directory, path).replaceAll("\\", "/");
        for (const rule of scope.rules) {
            if (rule.directoryOnly && !isDirectory) continue;
            if (rule.expression.test(relative)) ignored = !rule.negated;
        }
    }
    return ignored;
}

function parseGitIgnoreRule(line: string): GitIgnoreRule | undefined {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
        return undefined;
    }
    const negated = trimmed.startsWith("!");
    let pattern = negated ? trimmed.slice(1) : trimmed;
    if (pattern.startsWith("\\#")) pattern = pattern.slice(1);
    const directoryOnly = pattern.endsWith("/");
    if (directoryOnly) pattern = pattern.slice(0, -1);
    if (pattern.length === 0) return undefined;
    const anchored = pattern.startsWith("/") || pattern.includes("/");
    if (pattern.startsWith("/")) pattern = pattern.slice(1);
    const body = gitIgnoreGlobToRegExp(pattern);
    return {
        directoryOnly,
        negated,
        expression: new RegExp(anchored ? `^${body}$` : `(?:^|/)${body}$`),
    };
}

function gitIgnoreGlobToRegExp(pattern: string): string {
    let expression = "";
    for (let index = 0; index < pattern.length; index += 1) {
        const character = pattern[index] ?? "";
        if (character === "*") {
            if (pattern[index + 1] === "*") {
                if (pattern[index + 2] === "/") {
                    expression += "(?:[^/]*/)*";
                    index += 2;
                } else {
                    expression += ".*";
                    index += 1;
                }
            } else {
                expression += "[^/]*";
            }
            continue;
        }
        if (character === "?") {
            expression += "[^/]";
            continue;
        }
        expression += escapeRegExp(character);
    }
    return expression;
}
