import type { Context } from "@steve.kite/stdlib";
import { describe, expect, it } from "vitest";

import { ComputeProviders } from "../../sources/ComputeProviders.js";
import { computePermissions } from "../../sources/ComputePermissions.js";
import { justBashComputeProvider } from "../../sources/justBash/justBashComputeProvider.js";

const ctx = {} as Context;

describe("justBashComputeProvider", () => {
    it("creates an in-memory compute with validated initial files", async () => {
        const providers = new ComputeProviders([justBashComputeProvider]);

        const compute = await providers.create(ctx, "just-bash", {
            storage: "memory",
            cwd: "/workspace",
            files: { "/workspace/readme.txt": "hello" },
            hostPolicy: { protectedProjectFiles: ["agent-policy.toml"] },
        });

        expect(justBashComputeProvider.id).toBe("just-bash");
        expect(justBashComputeProvider.description).toMatch(/\S/u);
        expect(
            justBashComputeProvider.providesHostFileSystemAccess({
                storage: "memory",
                cwd: "/workspace",
                hostPolicy: { protectedProjectFiles: ["agent-policy.toml"] },
            }),
        ).toBe(false);
        expect(
            justBashComputeProvider.providesHostFileSystemAccess({
                storage: "folder",
                cwd: "/workspace",
                folder: "/host/project",
            }),
        ).toBe(true);
        expect(compute.id).toBe("just-bash");
        expect(compute.kind).toBe("emulated");
        await expect(
            compute.fs.readFile(computePermissions("read_only"), "readme.txt"),
        ).resolves.toBe("hello");
        await compute.dispose(ctx);
    });

    it("enforces the discriminated storage union and refuses per-machine permissions", async () => {
        const providers = new ComputeProviders([justBashComputeProvider]);

        await expect(
            providers.create(ctx, "just-bash", {
                storage: "folder",
                cwd: "/workspace",
            }),
        ).rejects.toThrow("just-bash compute configuration is not valid");
        await expect(
            providers.create(ctx, "just-bash", {
                storage: "memory",
                cwd: "/workspace",
                permissions: { mode: "full_access" },
            }),
        ).rejects.toThrow("just-bash compute configuration is not valid");
        await expect(
            providers.create(ctx, "just-bash", {
                storage: "memory",
                cwd: "/workspace",
                hostPolicy: { unknownBoundary: ["/private"] },
            }),
        ).rejects.toThrow("just-bash compute configuration is not valid");
    });
});
