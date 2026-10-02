import { describe, expect, it } from "vitest";

import { computePermissions } from "../../../sources/ComputePermissions.js";
import { assertDockerWritePath } from "../../../sources/docker/impl/assertDockerWritePath.js";

describe("assertDockerWritePath", () => {
    it("refuses every write in read-only mode", async () => {
        await expect(
            assertDockerWritePath(
                "/workspace",
                "src/index.ts",
                computePermissions("read_only"),
                identity,
            ),
        ).rejects.toThrow("File changes are disabled in read-only mode.");
    });

    it("blocks Git configuration files outside Full access", async () => {
        for (const path of [".gitmodules", "nested/.gitconfig", "nested/.GITMODULES"]) {
            await expect(
                assertDockerWritePath(
                    "/workspace",
                    path,
                    computePermissions("workspace_write"),
                    identity,
                ),
            ).rejects.toThrow(
                "Workspace write mode cannot modify Git control files without Full access.",
            );
        }
    });

    it("allows ordinary workspace files and Full access Git configuration writes", async () => {
        await expect(
            assertDockerWritePath(
                "/workspace",
                "src/index.ts",
                computePermissions("workspace_write"),
                identity,
            ),
        ).resolves.toBe("/workspace/src/index.ts");
        await expect(
            assertDockerWritePath(
                "/workspace",
                ".gitmodules",
                computePermissions("full_access"),
                identity,
            ),
        ).resolves.toBe("/workspace/.gitmodules");
    });

    it("allows explicitly granted writes outside the workspace", async () => {
        await expect(
            assertDockerWritePath(
                "/workspace",
                "/cache/build/output.js",
                computePermissions("workspace_write", {
                    allowedWritePaths: ["/cache/build"],
                }),
                identity,
            ),
        ).resolves.toBe("/cache/build/output.js");
    });

    it("gives denied writes precedence over workspace and explicit grants", async () => {
        const permissions = computePermissions("workspace_write", {
            allowedWritePaths: ["/cache"],
            deniedWritePaths: ["/workspace/private", "/cache/private"],
        });

        await expect(
            assertDockerWritePath("/workspace", "private/token", permissions, identity),
        ).rejects.toThrow("denied by this operation's permissions");
        await expect(
            assertDockerWritePath("/workspace", "/cache/private/token", permissions, identity),
        ).rejects.toThrow("denied by this operation's permissions");
        await expect(
            assertDockerWritePath(
                "/workspace",
                "/cache/private/token",
                computePermissions("auto", {
                    deniedWritePaths: ["/cache/private"],
                    allowedWritePaths: ["/cache"],
                }),
                identity,
            ),
        ).rejects.toThrow("denied by this operation's permissions");
    });

    it("blocks symlinks that escape the workspace or alias protected paths", async () => {
        await expect(
            assertDockerWritePath(
                "/workspace",
                "escape/file",
                computePermissions("workspace_write"),
                async (path) => (path === "/workspace/escape/file" ? "/outside/file" : path),
            ),
        ).rejects.toThrow("cannot modify files outside the working directory");
        await expect(
            assertDockerWritePath(
                "/workspace",
                "config-alias",
                computePermissions("workspace_write"),
                async (path) =>
                    path === "/workspace/config-alias" ? "/workspace/.git/config" : path,
            ),
        ).rejects.toThrow(
            "Workspace write mode cannot modify Git control files without Full access.",
        );
    });

    it("protects only the project files and read-only directories the caller declares", async () => {
        const hostPolicy = {
            networkPolicyFiles: ["access.conf"],
            protectedProjectFiles: ["product.policy"],
            readableDirectories: ["/product/docs"],
        };
        for (const path of ["access.conf", "product.policy", "/product/docs/guide.md"]) {
            await expect(
                assertDockerWritePath(
                    "/workspace",
                    path,
                    computePermissions("workspace_write", {
                        allowedWritePaths: ["/product/docs"],
                    }),
                    identity,
                    hostPolicy,
                ),
            ).rejects.toThrow("denied by this operation's permissions");
        }
        await expect(
            assertDockerWritePath(
                "/workspace",
                "undeclared.policy",
                computePermissions("workspace_write"),
                identity,
                hostPolicy,
            ),
        ).resolves.toBe("/workspace/undeclared.policy");
    });
});

async function identity(path: string): Promise<string> {
    return path;
}
