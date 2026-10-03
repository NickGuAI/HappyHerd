import type { Context } from "@steve.kite/stdlib";
import { afterEach, describe, expect, it } from "vitest";

import type { Compute } from "../../sources/Compute.js";
import { computePermissions } from "../../sources/ComputePermissions.js";
import { createJustBashCompute } from "../../sources/justBash/createJustBashCompute.js";

const computes: Compute[] = [];
const unusedContext = {} as Context;
const workspacePermissions = computePermissions("workspace_write");

afterEach(async () => {
    await Promise.all(computes.splice(0).map((compute) => compute.dispose(unusedContext)));
});

describe("just-bash filesystem errors", () => {
    it("reports a missing file with the same properties Node's fs would", async () => {
        const compute = memoryCompute();

        const error = await captureError(compute.fs.lstat(workspacePermissions, "missing.txt"));

        expect(error.code).toBe("ENOENT");
        expect(error.errno).toBeTypeOf("number");
        expect(error.syscall).toBe("lstat");
        expect(error.path).toBe("/workspace/missing.txt");
    });

    it("reports a missing file the same way when reading through readFileBuffer", async () => {
        const compute = memoryCompute();

        const error = await captureError(
            compute.fs.readFileBuffer(workspacePermissions, "missing.txt"),
        );

        expect(error.code).toBe("ENOENT");
    });
});

async function captureError(promise: Promise<unknown>): Promise<NodeJS.ErrnoException> {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(Error);
        return error as NodeJS.ErrnoException;
    }
    throw new Error("Expected the promise to reject.");
}

function memoryCompute(files: Record<string, string> = {}): Compute {
    const compute = createJustBashCompute({
        storage: "memory",
        cwd: "/workspace",
        files,
    });
    computes.push(compute);
    return compute;
}
