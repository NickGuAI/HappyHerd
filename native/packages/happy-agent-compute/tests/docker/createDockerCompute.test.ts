import { PassThrough } from "node:stream";

import type Dockerode from "dockerode";
import { describe, expect, it, vi } from "vitest";

import type { Context } from "@steve.kite/stdlib";

import { computePermissions } from "../../sources/ComputePermissions.js";
import { createDockerCompute } from "../../sources/docker/createDockerCompute.js";

// Construction never touches the daemon: the container is resolved lazily on first use, so these
// checks run without Docker. The fake client would only be reached if a command actually ran.
const fakeClient = {} as unknown as Dockerode;

describe("createDockerCompute", () => {
    it("exposes a docker compute fixed to its working directory without ambient permissions", () => {
        const compute = createDockerCompute({
            client: fakeClient,
            docker: { image: "dev:local", workingDirectory: "/workspace" },
            sessionId: "session-1",
        });

        expect(compute.id).toBe("docker");
        expect(compute.kind).toBe("docker");
        expect(compute.cwd).toBe("/workspace");
        expect(compute.fs.cwd).toBe("/workspace");
        expect(compute.shell.cwd).toBe("/workspace");
        expect(compute).not.toHaveProperty("permissions");
        expect(compute.shell.supportsSessionInput).toBe(true);
    });

    it("disposes cleanly when nothing was ever started", async () => {
        const compute = createDockerCompute({
            client: fakeClient,
            docker: { container: "dev", workingDirectory: "/repo" },
            sessionId: "session-2",
        });

        await expect(compute.dispose({} as Context)).resolves.toBeUndefined();
    });

    it("removes the managed container it created when disposed", async () => {
        const fake = createCommandContainer();
        const client = {
            createContainer: vi.fn().mockResolvedValue(fake.container),
            getContainer: vi.fn(() => ({
                inspect: vi.fn().mockRejectedValue({ statusCode: 404 }),
            })),
        } as unknown as Dockerode;
        const compute = createDockerCompute({
            client,
            docker: {
                image: "dev:local",
                name: "compute-dispose-test",
                workingDirectory: "/workspace",
            },
            sessionId: "session-3",
        });

        await compute.fs.exists(computePermissions("full_access"), "file.txt");
        await compute.dispose({} as Context);

        expect(fake.remove).toHaveBeenCalledOnce();
        expect(fake.remove).toHaveBeenCalledWith({ force: true });
    });

    it("leaves an attached container untouched when disposed", async () => {
        const fake = createCommandContainer();
        const client = {
            getContainer: vi.fn(() => ({
                ...fake.container,
                inspect: vi.fn().mockResolvedValue({ State: { Running: true } }),
            })),
        } as unknown as Dockerode;
        const compute = createDockerCompute({
            client,
            docker: { container: "developer-container", workingDirectory: "/workspace" },
            sessionId: "session-4",
        });

        await compute.fs.exists(computePermissions("full_access"), "file.txt");
        await compute.dispose({} as Context);

        expect(fake.remove).not.toHaveBeenCalled();
    });

    it("removes a shared managed container only after its last owner disposes", async () => {
        const fake = createCommandContainer();
        const client = {
            createContainer: vi.fn().mockResolvedValue(fake.container),
            getContainer: vi.fn(() => ({
                inspect: vi.fn().mockRejectedValue({ statusCode: 404 }),
            })),
        } as unknown as Dockerode;
        const docker = {
            image: "dev:local",
            name: "shared-compute-dispose-test",
            workingDirectory: "/workspace",
        };
        const first = createDockerCompute({ client, docker, sessionId: "session-5" });
        const second = createDockerCompute({ client, docker, sessionId: "session-6" });

        await Promise.all([
            first.fs.exists(computePermissions("full_access"), "first.txt"),
            second.fs.exists(computePermissions("full_access"), "second.txt"),
        ]);
        await first.dispose({} as Context);
        expect(fake.remove).not.toHaveBeenCalled();

        await second.dispose({} as Context);
        expect(fake.remove).toHaveBeenCalledOnce();
    });
});

function createCommandContainer(): {
    container: Dockerode.Container;
    remove: ReturnType<typeof vi.fn>;
} {
    const remove = vi.fn().mockResolvedValue(undefined);
    const container = {
        async exec() {
            const stream = new PassThrough();
            return {
                inspect: async () => ({ ExitCode: 0 }),
                async start() {
                    queueMicrotask(() => stream.end());
                    return stream;
                },
            };
        },
        modem: {
            demuxStream(
                stream: NodeJS.ReadableStream,
                stdout: NodeJS.WritableStream,
                _stderr: NodeJS.WritableStream,
            ) {
                stream.pipe(stdout);
            },
        },
        remove,
        start: vi.fn().mockResolvedValue(undefined),
    } as unknown as Dockerode.Container;
    return { container, remove };
}
