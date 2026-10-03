import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRootContext } from "@steve.kite/stdlib";
import { afterEach, describe, expect, it } from "vitest";

import { ComputeProviders } from "../../sources/ComputeProviders.js";
import { hostComputeProvider } from "../../sources/host/hostComputeProvider.js";

const ctx = createRootContext().named("host-compute-provider-test");
const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
});

describe("hostComputeProvider", () => {
    it("creates a host compute from its validated working directory", async () => {
        const cwd = await makeTemporaryDirectory();
        const providers = new ComputeProviders([hostComputeProvider]);

        const compute = await providers.create(ctx, "host", {
            cwd,
            hostPolicy: { protectedProjectFiles: ["agent-policy.toml"] },
        });

        expect(hostComputeProvider.id).toBe("host");
        expect(hostComputeProvider.description).toMatch(/\S/u);
        expect(providers.ids()).toEqual(["host"]);
        expect(providers.all()).toEqual([hostComputeProvider]);
        expect(
            hostComputeProvider.providesHostFileSystemAccess({
                cwd,
                hostPolicy: { protectedProjectFiles: ["agent-policy.toml"] },
            }),
        ).toBe(true);
        expect(compute.id).toBe("host");
        expect(compute.kind).toBe("host");
        expect(compute.cwd).toBe(cwd);
        await compute.dispose(ctx);
    });

    it("requires only the serializable host configuration and refuses ambient permissions", async () => {
        const cwd = await makeTemporaryDirectory();
        const providers = new ComputeProviders([hostComputeProvider]);

        await expect(providers.create(ctx, "host", {})).rejects.toThrow(
            "host compute configuration is not valid",
        );
        await expect(
            providers.create(ctx, "host", {
                cwd,
                permissions: { mode: "full_access" },
            }),
        ).rejects.toThrow("host compute configuration is not valid");
        await expect(
            providers.create(ctx, "host", {
                cwd,
                hostPolicy: { unknownBoundary: ["/private"] },
            }),
        ).rejects.toThrow("host compute configuration is not valid");
    });
});

async function makeTemporaryDirectory(): Promise<string> {
    const path = await mkdtemp(join(tmpdir(), "host-provider-"));
    temporaryDirectories.push(path);
    return path;
}
