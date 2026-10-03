import { describe, expect, it } from "vitest";

import { computePermissions } from "../../../sources/ComputePermissions.js";
import { assertDockerReadPath } from "../../../sources/docker/impl/assertDockerReadPath.js";

describe("assertDockerReadPath", () => {
    it("allows Codex-style reads across the container in restricted modes", async () => {
        const permissions = computePermissions("workspace_write");
        for (const path of [
            "/home/user/.git-credentials",
            "/home/user/.npmrc",
            "/home/user/.config/gh/hosts.yml",
            "/home/user/.kube/config",
            "/home/user/.gnupg/pubring.kbx",
            "/home/user/.netrc",
            "/home/user/.docker/config.json",
            "/home/user/.SSH/id_rsa",
        ]) {
            await expect(
                assertDockerReadPath("/workspace", path, permissions, identity),
            ).resolves.toBe(path);
        }
    });

    it("resolves relative reads against the workspace", async () => {
        await expect(
            assertDockerReadPath(
                "/workspace",
                "credentials",
                computePermissions("read_only"),
                identity,
            ),
        ).resolves.toBe("/workspace/credentials");
    });

    it("refuses denied reads by spelling or canonical destination", async () => {
        const permissions = computePermissions("auto", {
            allowedReadPaths: ["/private"],
            deniedReadPaths: ["/private"],
        });

        await expect(
            assertDockerReadPath("/workspace", "/private/token", permissions, identity),
        ).rejects.toThrow("denied by this operation's permissions");
        await expect(
            assertDockerReadPath("/workspace", "private-alias/token", permissions, async (path) =>
                path.startsWith("/workspace/private-alias")
                    ? path.replace("/workspace/private-alias", "/private")
                    : path,
            ),
        ).rejects.toThrow("denied by this operation's permissions");
    });

    it("refuses caller-declared private directories outside Full access", async () => {
        const hostPolicy = { privateDirectories: ["/product/private"] };

        await expect(
            assertDockerReadPath(
                "/workspace",
                "/product/private/token",
                computePermissions("workspace_write"),
                identity,
                hostPolicy,
            ),
        ).rejects.toThrow("denied by this operation's permissions");
        await expect(
            assertDockerReadPath(
                "/workspace",
                "/product/private/token",
                computePermissions("full_access"),
                identity,
                hostPolicy,
            ),
        ).resolves.toBe("/product/private/token");
    });
});

async function identity(path: string): Promise<string> {
    return path;
}
