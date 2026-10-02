import type Dockerode from "dockerode";
import { describe, expect, it, vi } from "vitest";

import type { Context } from "@steve.kite/stdlib";

import { ComputeProviders } from "../../sources/ComputeProviders.js";
import {
    createDockerComputeProvider,
    dockerComputeProvider,
} from "../../sources/docker/dockerComputeProvider.js";

describe("dockerComputeProvider", () => {
    it("describes the built-in Docker provider", () => {
        expect(dockerComputeProvider.id).toBe("docker");
        expect(dockerComputeProvider.description).toMatch(/Docker/);
        expect(
            dockerComputeProvider.providesHostFileSystemAccess({
                image: "dev:local",
                workingDirectory: "/workspace",
            }),
        ).toBe(false);
        expect(
            dockerComputeProvider.providesHostFileSystemAccess({
                image: "dev:local",
                mounts: [
                    { readOnly: true, source: "/host/docs", target: "/product/docs" },
                    { readOnly: true, source: "/host/output", target: "/product/output" },
                ],
                workingDirectory: "/workspace",
            }),
        ).toBe(true);
        expect(
            dockerComputeProvider.providesHostFileSystemAccess({
                container: "dev",
                workingDirectory: "/workspace",
            }),
        ).toBe(true);
    });

    it("validates and carries the embedding product's host policy as data", async () => {
        const clientFactory = vi.fn(() => ({}) as Dockerode);
        const providers = new ComputeProviders([createDockerComputeProvider(clientFactory)]);
        const config = {
            hostPolicy: {
                networkPolicyFiles: ["access.conf"],
                privateDirectories: ["/product/private"],
                protectedProjectFiles: ["product.policy"],
                readableDirectories: ["/product/docs"],
            },
            image: "dev:local",
            workingDirectory: "/workspace",
        };

        await expect(providers.create({} as Context, "docker", config)).resolves.toMatchObject({
            id: "docker",
        });
        expect(clientFactory).toHaveBeenCalledWith(config);
    });

    it("obtains a live Dockerode client from its factory after config validation", async () => {
        const client = {} as Dockerode;
        const clientFactory = vi.fn(() => client);
        const providers = new ComputeProviders([createDockerComputeProvider(clientFactory)]);
        const config = { container: "dev", workingDirectory: "/workspace" };

        const compute = await providers.create({} as Context, "docker", config);

        expect(clientFactory).toHaveBeenCalledWith(config);
        expect(compute.id).toBe("docker");
        expect(compute.kind).toBe("docker");
        expect(compute.cwd).toBe("/workspace");
    });

    it("requires exactly one of an image and attached container", async () => {
        const clientFactory = vi.fn(() => ({}) as Dockerode);
        const providers = new ComputeProviders([createDockerComputeProvider(clientFactory)]);

        await expect(
            providers.create({} as Context, "docker", { workingDirectory: "/workspace" }),
        ).rejects.toThrow("configuration is not valid");
        await expect(
            providers.create({} as Context, "docker", {
                container: "dev",
                image: "dev:local",
                workingDirectory: "/workspace",
            }),
        ).rejects.toThrow("configuration is not valid");
        expect(clientFactory).not.toHaveBeenCalled();
    });

    it("rejects managed-container settings on an attached container and unknown fields", async () => {
        const clientFactory = vi.fn(() => ({}) as Dockerode);
        const providers = new ComputeProviders([createDockerComputeProvider(clientFactory)]);

        await expect(
            providers.create({} as Context, "docker", {
                container: "dev",
                mounts: [{ source: ".", target: "/workspace" }],
                workingDirectory: "/workspace",
            }),
        ).rejects.toThrow("configuration is not valid");
        await expect(
            providers.create({} as Context, "docker", {
                image: "dev:local",
                unexpected: true,
                workingDirectory: "/workspace",
            }),
        ).rejects.toThrow("configuration is not valid");
        expect(clientFactory).not.toHaveBeenCalled();
    });
});
