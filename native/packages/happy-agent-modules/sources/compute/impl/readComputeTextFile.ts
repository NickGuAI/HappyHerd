import type { Context } from "@steve.kite/stdlib";

import type { Compute } from "../Compute.js";
import { computePermissionsForContext } from "./computePermissionsForContext.js";
import type { FileReadLog } from "../../impl/FileReadLog.js";
import { resolveComputePath } from "./resolveComputePath.js";

/** One page of a text file, as every vendor's read tool receives it before it is worded. */
export interface ComputeTextFileRead {
    /** The absolute path on the machine, whatever the model wrote. */
    readonly path: string;
    /** The lines this page carries, without numbering. */
    readonly lines: readonly string[];
    /** The 1-based number of the first line carried. */
    readonly startLine: number;
    /** How many lines the whole file has. */
    readonly totalLines: number;
    /** Lines remain after this page. */
    readonly moreLines: boolean;
}

/**
 * Read one page of a text file and remember having read it.
 *
 * Paging is the whole of what a caller may vary here: which line to start at and how many to
 * take. What the page then looks like — numbered or bare, and what a truncated answer says —
 * belongs to the vendor tool asking, because that is the surface the model was trained on.
 * Recording the read is not optional and does not belong to the caller: it is what later earns
 * the right to change the file.
 */
export async function readComputeTextFile(
    compute: Compute,
    reads: FileReadLog,
    ctx: Context,
    options: {
        readonly path: string;
        readonly offset?: number;
        readonly limit?: number;
        readonly maxLines: number;
    },
): Promise<ComputeTextFileRead> {
    const permissions = computePermissionsForContext(ctx);
    const filePath = resolveComputePath(options.path, compute.cwd, compute.fs.home);
    const stat = await compute.fs.stat(permissions, filePath);
    if (stat.isDirectory) throw new Error(`This path is a directory, not a file: ${filePath}`);
    const raw = await compute.fs.readFile(permissions, filePath);
    const lines = raw.split(/\r?\n/);
    const startLine = options.offset === undefined || options.offset < 1 ? 1 : options.offset;
    const selected = lines.slice(
        startLine - 1,
        startLine - 1 + Math.min(options.limit ?? options.maxLines, options.maxLines),
    );
    await reads.record(ctx, filePath, stat.mtimeMs);
    return {
        path: filePath,
        lines: selected,
        startLine,
        totalLines: lines.length,
        moreLines: startLine - 1 + selected.length < lines.length,
    };
}
