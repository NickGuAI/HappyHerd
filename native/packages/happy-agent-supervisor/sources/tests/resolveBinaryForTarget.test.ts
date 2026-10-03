import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ packageRoot: "" }));
vi.mock("node:url", async (importOriginal) => ({
    ...(await importOriginal<typeof import("node:url")>()),
    fileURLToPath: () => fixture.packageRoot,
}));
vi.mock("node:module", () => ({
    createRequire: () => ({
        resolve: () => {
            throw new Error("No installed platform artifact in the source-build fixture");
        },
    }),
}));

import { resolveBinaryForTarget } from "../impl/resolveBinaryForTarget.js";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sourceBuild() {
    const root = mkdtempSync(path.join(tmpdir(), "supervisor-source-resolver-"));
    roots.push(root);
    fixture.packageRoot = path.join(root, "package");
    const release = path.join(fixture.packageRoot, "native", "target", "release");
    mkdirSync(release, { recursive: true });
    const target = path.join(root, "installed-supervisor");
    writeFileSync(target, "fixture executable");
    const candidate = path.join(release, "happy-agent-supervisor");
    symlinkSync(target, candidate, "file");
    return { target, candidate };
}

describe("source-built supervisor resolution", () => {
    it("returns the real executable behind a build-target symlink for sandbox protection", () => {
        const { target, candidate } = sourceBuild();
        const resolved = resolveBinaryForTarget("linux-x64");
        expect(resolved).toBe(realpathSync(target));
        expect(resolved).not.toBe(candidate);
    });

    it("retains explicit override path semantics", () => {
        const { candidate } = sourceBuild();
        expect(resolveBinaryForTarget("linux-x64", candidate)).toBe(path.resolve(candidate));
    });
});
