import { describe, expect, it } from "vitest";

import { SecretsModule } from "../../sources/secrets/SecretsModule.js";
import { secretsMigrations } from "../../sources/secrets/SecretDatabase.js";
import { moduleDatabase, type ModuleDatabase } from "../support/moduleDatabase.js";

const AGENT = "agent-a";

async function withDatabase<T>(
    name: string,
    callback: (
        database: ModuleDatabase & {
            readonly database: import("@slopus/happy-agent-base").AgentDatabase;
        },
    ) => Promise<T>,
): Promise<T> {
    const database = moduleDatabase(secretsMigrations, name);
    await database.ready;
    try {
        return await callback(database);
    } finally {
        database.close();
    }
}

async function registerAndAttach(
    module: SecretsModule,
    database: ModuleDatabase,
    id: string,
    environment: Record<string, string>,
    scopeRef = "scope-1",
    availableToModel?: boolean,
): Promise<void> {
    await module.register(database.context, AGENT, {
        id,
        description: id,
        environment,
        ...(availableToModel === undefined ? {} : { availableToModel }),
    });
    await module.attach(database.context, AGENT, scopeRef, id);
}

describe("SecretsModule host and command resolution", () => {
    it("resolves only attached secrets by default and supports explicit, empty, and cloned selections", async () => {
        await withDatabase("secrets-resolution-host", async (database) => {
            const module = new SecretsModule();
            await registerAndAttach(module, database, "attached", { ATTACHED: "one" });
            await module.register(database.context, AGENT, {
                id: "unattached",
                description: "unattached",
                environment: { UNATTACHED: "two" },
            });

            await expect(
                module.resolveForHost(database.context, AGENT, "scope-1"),
            ).resolves.toEqual({ ATTACHED: "one" });
            await expect(
                module.resolveForHost(database.context, AGENT, "scope-1", ["attached"]),
            ).resolves.toEqual({ ATTACHED: "one" });
            await expect(
                module.resolveForHost(database.context, AGENT, "scope-1", []),
            ).resolves.toEqual({});
            await expect(
                module.resolveForHost(database.context, AGENT, "scope-1", ["unattached"]),
            ).rejects.toThrow("not attached");

            const selected = await module.resolveForHost(database.context, AGENT, "scope-1", [
                "attached",
            ]);
            selected.ATTACHED = "caller mutation";
            await expect(
                module.resolveForHost(database.context, AGENT, "scope-1", ["attached"]),
            ).resolves.toEqual({ ATTACHED: "one" });
        });
    });

    it("keeps resolved values out of every model-facing shape", async () => {
        await withDatabase("secrets-resolution-model-facing", async (database) => {
            const module = new SecretsModule();
            await registerAndAttach(module, database, "one", { ONE: "database-value" });

            await expect(
                module.resolveForHost(database.context, AGENT, "scope-1"),
            ).resolves.toEqual({ ONE: "database-value" });

            const page = await module.list(database.context, AGENT, { scopeRef: "scope-1" });
            expect(JSON.stringify(page)).not.toContain("database-value");
            expect(module.formatPageForModel(page)).not.toContain("database-value");
            expect(JSON.stringify(module.beforeStart())).not.toContain("database-value");
        });
    });

    it("allows a trusted host to resolve host-only attachments while command resolution rejects them", async () => {
        await withDatabase("secrets-resolution-availability", async (database) => {
            const module = new SecretsModule();
            await registerAndAttach(module, database, "managed", {
                HOST_TOKEN: "host-only-value",
            });
            await module.update(database.context, AGENT, "managed", {
                availableToModel: false,
            });

            await expect(
                module.resolveForHost(database.context, AGENT, "scope-1"),
            ).resolves.toEqual({ HOST_TOKEN: "host-only-value" });
            await expect(
                module.resolveForCommand(database.context, AGENT, "scope-1"),
            ).rejects.toThrow("not available to agent commands");
            await expect(
                module.resolveForCommand(database.context, AGENT, "scope-1", ["managed"]),
            ).rejects.toThrow("not available to agent commands");
        });
    });

    it("rejects invalid selections before reading any value", async () => {
        await withDatabase("secrets-resolution-selection", async (database) => {
            const module = new SecretsModule();
            await registerAndAttach(module, database, "one", { TOKEN: "value" });

            await expect(
                module.resolveForHost(database.context, AGENT, "scope-1", ["one", "one"]),
            ).rejects.toThrow("selection is invalid");
            await expect(
                module.resolveForHost(database.context, AGENT, "scope-1", ["missing"]),
            ).rejects.toThrow("not attached");
            await expect(
                module.resolveForHost(database.context, AGENT, "scope-1", ["bad id"]),
            ).rejects.toThrow("selection is invalid");
        });
    });

    it("merges attached secrets deterministically and hides attached names case-insensitively", async () => {
        await withDatabase("secrets-resolution-command", async (database) => {
            const module = new SecretsModule();
            await registerAndAttach(module, database, "first", { TOKEN: "one", Ambient: "a" });
            await registerAndAttach(module, database, "second", { zed: "two" });

            await expect(
                module.resolveForCommand(database.context, AGENT, "scope-1"),
            ).resolves.toEqual({
                environment: { Ambient: "a", TOKEN: "one", zed: "two" },
                hiddenEnvironmentVariables: ["Ambient", "TOKEN", "zed"],
            });
            await expect(
                module.resolveForCommand(database.context, AGENT, "scope-1", ["second"]),
            ).resolves.toEqual({
                environment: { zed: "two" },
                hiddenEnvironmentVariables: ["Ambient", "TOKEN", "zed"],
            });
        });
    });

    it("rejects case-insensitive collisions between two attached secrets", async () => {
        await withDatabase("secrets-resolution-command-collision", async (database) => {
            const module = new SecretsModule();
            await registerAndAttach(module, database, "first", { TOKEN: "one" });
            await registerAndAttach(module, database, "second", { token: "two" });

            await expect(
                module.resolveForCommand(database.context, AGENT, "scope-1"),
            ).rejects.toThrow("both define");
            await expect(module.resolveForHost(database.context, AGENT, "scope-1")).rejects.toThrow(
                "both define",
            );
            // Selecting one side of the collision is unambiguous, so it still resolves.
            await expect(
                module.resolveForHost(database.context, AGENT, "scope-1", ["first"]),
            ).resolves.toEqual({ TOKEN: "one" });
        });
    });

    it("rejects invalid environments at the registration boundary", async () => {
        await withDatabase("secrets-resolution-invalid-inputs", async (database) => {
            const module = new SecretsModule();
            const invalidEnvironments: unknown[] = [
                { TOKEN: "nul\u0000value" },
                { "1NOT_VALID": "value" },
                { TOKEN: "value", token: "collision" },
                { TOKEN: "x".repeat(65_537) },
                Object.fromEntries(
                    Array.from({ length: 257 }, (_, index) => [`VAR_${index}`, "value"]),
                ),
            ];
            let index = 0;
            for (const environment of invalidEnvironments) {
                index += 1;
                await expect(
                    module.register(database.context, AGENT, {
                        id: `invalid-${index}`,
                        description: "Invalid",
                        environment: environment as never,
                    }),
                    `case ${index}`,
                ).rejects.toThrow();
                expect(
                    await module.reference(database.context, AGENT, `invalid-${index}`),
                ).toBeUndefined();
            }
        });
    });
});
