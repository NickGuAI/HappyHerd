import type Dockerode from "dockerode";
import { describe, expect, it, vi } from "vitest";

import type { DockerEnvironment } from "../../../sources/docker/DockerEnvironment.js";
import {
    dockerNetworkPolicyFileNames,
    dockerProtectedProjectFileNames,
    resolveDockerPrivateDirectories,
    snapshotDockerHostPolicy,
} from "../../../sources/docker/impl/resolveDockerHostPolicy.js";

describe("resolveDockerHostPolicy", () => {
    it("derives project protection entirely from the caller's declaration", () => {
        const policy = {
            networkPolicyFiles: ["access.conf"],
            protectedProjectFiles: ["product.policy"],
        };

        expect(dockerNetworkPolicyFileNames(policy)).toEqual(["access.conf"]);
        expect(dockerProtectedProjectFileNames(policy)).toEqual(["product.policy", "access.conf"]);
        expect(dockerProtectedProjectFileNames({})).toEqual([]);
    });

    it("captures policy arrays independently from later caller mutation", () => {
        const protectedProjectFiles = ["product.policy"];
        const snapshot = snapshotDockerHostPolicy({ protectedProjectFiles });

        protectedProjectFiles.push("later.policy");

        expect(snapshot.protectedProjectFiles).toEqual(["product.policy"]);
    });

    it("resolves declared private path variables from image and command environments", async () => {
        const inspect = vi.fn().mockResolvedValue({
            Config: {
                Env: ["PRODUCT_PRIVATE_ROOT=/image/private", "IGNORED_ROOT=/not-private"],
            },
        });
        const environment = {
            config: { workingDirectory: "/workspace" },
            container: async () => ({ inspect }) as unknown as Dockerode.Container,
        } as DockerEnvironment;

        await expect(
            resolveDockerPrivateDirectories(
                environment,
                {
                    privateDirectories: ["/fixed/private"],
                    privatePathVariables: ["PRODUCT_PRIVATE_ROOT"],
                },
                { PRODUCT_PRIVATE_ROOT: "/command/private" },
            ),
        ).resolves.toEqual(["/fixed/private", "/command/private"]);
    });
});
