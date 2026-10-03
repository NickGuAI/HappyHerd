import { sql } from "drizzle-orm";
import { agentDatabaseRun } from "@slopus/happy-agent-base";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
    secretAgentIdSchema,
    secretAttachInputSchema,
    secretCommandEnvironmentSchema,
    secretEnvironmentVariableNameSchema,
    secretHostEnvironmentSchema,
    secretIdSchema,
    secretListInputSchema,
    secretPageSchema,
    secretReferenceSchema,
    secretRegistrationInputSchema,
    secretScopeRefSchema,
    secretUpdateInputSchema,
} from "../../sources/secrets/Secret.js";
import {
    assertSecretCommandEnvironment,
    assertSecretHostEnvironment,
    assertSecretReference,
} from "../../sources/secrets/SecretStore.js";
import { createSecretDatabase, secretsMigrations } from "../../sources/secrets/SecretDatabase.js";
import { moduleDatabase, type ModuleDatabase } from "../support/moduleDatabase.js";

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

describe("Secrets schemas and persistence boundaries", () => {
    it("rejects unknown keys and enforces identity, scope, page, and patch bounds", () => {
        expect(Value.Check(secretAgentIdSchema, `agent-${"a".repeat(250)}`)).toBe(true);
        expect(Value.Check(secretAgentIdSchema, `agent-${"a".repeat(251)}`)).toBe(false);
        expect(Value.Check(secretAgentIdSchema, "line\nbreak")).toBe(false);
        expect(Value.Check(secretIdSchema, "A_valid.id:1")).toBe(true);
        expect(Value.Check(secretIdSchema, "bad id")).toBe(false);
        expect(Value.Check(secretIdSchema, "😀")).toBe(false);
        expect(Value.Check(secretScopeRefSchema, "scope/opaque")).toBe(true);
        expect(Value.Check(secretScopeRefSchema, "scope\nbad")).toBe(false);
        expect(Value.Check(secretEnvironmentVariableNameSchema, "_A9")).toBe(true);
        expect(Value.Check(secretEnvironmentVariableNameSchema, "9A")).toBe(false);

        expect(
            Value.Check(secretRegistrationInputSchema, {
                id: "secret",
                description: "Description",
                environment: { TOKEN: "value" },
                unknown: true,
            }),
        ).toBe(false);
        expect(
            Value.Check(secretUpdateInputSchema, {
                description: "Description",
                environment: { TOKEN: null },
                unknown: true,
            }),
        ).toBe(false);
        expect(Value.Check(secretUpdateInputSchema, {})).toBe(false);
        expect(
            Value.Check(secretListInputSchema, {
                limit: 1,
                cursor: 0,
                scopeRef: "scope",
                unknown: true,
            }),
        ).toBe(false);
        expect(
            Value.Check(secretAttachInputSchema, {
                scopeRef: "scope",
                secretId: "secret",
                unknown: true,
            }),
        ).toBe(false);
        expect(
            Value.Check(secretPageSchema, {
                secrets: [],
                limit: 1,
                nextCursor: 0,
                unknown: true,
            }),
        ).toBe(false);
        expect(
            Value.Check(secretReferenceSchema, {
                id: "secret",
                description: "Description",
                environmentVariables: ["TOKEN"],
                revision: "1",
                value: "should-not-exist",
            }),
        ).toBe(false);
    });

    it("requires hidden names for every command environment name and rejects case collisions", () => {
        expect(() => assertSecretHostEnvironment({ TOKEN: "value", token: "collision" })).toThrow(
            "colliding",
        );
        expect(() =>
            assertSecretCommandEnvironment({
                environment: { TOKEN: "value" },
                hiddenEnvironmentVariables: [],
            }),
        ).toThrow("must hide");
        expect(() =>
            assertSecretCommandEnvironment({
                environment: { TOKEN: "value" },
                hiddenEnvironmentVariables: ["TOKEN", "token"],
            }),
        ).toThrow("duplicate hidden");
        expect(() =>
            assertSecretCommandEnvironment({
                environment: { TOKEN: "value" },
                hiddenEnvironmentVariables: ["token"],
            }),
        ).not.toThrow();
    });

    it("normalizes database pages, scopes, attachments, and owner isolation at the SQL boundary", async () => {
        await withDatabase("secrets-database-pages", async (database) => {
            const store = createSecretDatabase();
            for (const id of ["a", "b", "c"]) {
                await store.register(database.context, "owner-a", {
                    id,
                    description: id,
                    environment: { [`VAR_${id.toUpperCase()}`]: id },
                });
            }
            await store.register(database.context, "owner-b", {
                id: "a",
                description: "other owner",
                environment: { OTHER: "other" },
            });
            await store.attach(database.context, "owner-a", {
                scopeRef: "scope",
                secretId: "b",
            });

            await expect(store.list(database.context, "owner-a", { limit: 2 })).resolves.toEqual({
                secrets: [
                    {
                        id: "a",
                        description: "a",
                        environmentVariables: ["VAR_A"],
                        revision: "1",
                    },
                    {
                        id: "b",
                        description: "b",
                        environmentVariables: ["VAR_B"],
                        revision: "1",
                    },
                ],
                limit: 2,
                nextCursor: 2,
            });
            await expect(
                store.list(database.context, "owner-a", { limit: 2, cursor: 2 }),
            ).resolves.toEqual({
                secrets: [
                    {
                        id: "c",
                        description: "c",
                        environmentVariables: ["VAR_C"],
                        revision: "1",
                    },
                ],
                limit: 2,
            });
            await expect(
                store.list(database.context, "owner-a", { limit: 10, scopeRef: "scope" }),
            ).resolves.toMatchObject({
                secrets: [{ id: "b" }],
                limit: 10,
            });
            await expect(store.reference(database.context, "owner-b", "a")).resolves.toMatchObject({
                description: "other owner",
            });
            await expect(store.reference(database.context, "owner-a", "a")).resolves.toMatchObject({
                description: "a",
            });
            expect(
                await store.attachment(database.context, "owner-a", {
                    scopeRef: "scope",
                    secretId: "b",
                }),
            ).toEqual({ scopeRef: "scope", secretId: "b" });
            expect(
                await store.attachment(database.context, "owner-b", {
                    scopeRef: "scope",
                    secretId: "b",
                }),
            ).toBeUndefined();
        });
    });

    it("increments revisions for value changes, preserves them for metadata changes, and cleans attachments on remove", async () => {
        await withDatabase("secrets-database-mutations", async (database) => {
            const store = createSecretDatabase();
            await store.register(database.context, "agent", {
                id: "secret",
                description: "Original",
                environment: { TOKEN: "one" },
            });
            await store.attach(database.context, "agent", {
                scopeRef: "scope",
                secretId: "secret",
            });
            await expect(
                store.update(database.context, "agent", "secret", {
                    description: "Changed",
                }),
            ).resolves.toMatchObject({ changed: true, reference: { revision: "1" } });
            await expect(
                store.update(database.context, "agent", "secret", {
                    environment: { TOKEN: "two" },
                }),
            ).resolves.toMatchObject({ changed: true, reference: { revision: "2" } });
            await expect(
                store.update(database.context, "agent", "secret", {
                    environment: { MISSING: null },
                }),
            ).resolves.toMatchObject({ changed: false, reference: { revision: "2" } });
            await expect(store.remove(database.context, "agent", "secret")).resolves.toMatchObject({
                removed: true,
                reference: { id: "secret", revision: "2" },
            });
            await expect(
                store.attachment(database.context, "agent", {
                    scopeRef: "scope",
                    secretId: "secret",
                }),
            ).resolves.toBeUndefined();
            await expect(store.remove(database.context, "agent", "secret")).resolves.toMatchObject({
                removed: false,
            });
        });
    });

    it("fails closed when persisted secret JSON, flags, or metadata are malformed", async () => {
        await withDatabase("secrets-database-malformed", async (database) => {
            const store = createSecretDatabase();
            await agentDatabaseRun(
                database.database,
                sql`INSERT INTO happy_agent_secrets
                    (owner_agent_id, id, description, environment_json, revision, available_to_model, kind)
                    VALUES (${"agent"}, ${"bad-json"}, ${"Bad"}, ${"{broken"}, ${"1"}, ${null}, ${null})`,
            );
            await expect(store.reference(database.context, "agent", "bad-json")).rejects.toThrow(
                "invalid environment JSON",
            );

            await agentDatabaseRun(
                database.database,
                sql`UPDATE happy_agent_secrets
                    SET environment_json = ${JSON.stringify({ TOKEN: "value" })},
                        available_to_model = ${2}
                    WHERE id = ${"bad-json"}`,
            );
            await expect(store.reference(database.context, "agent", "bad-json")).rejects.toThrow(
                "model-availability flag",
            );

            await agentDatabaseRun(
                database.database,
                sql`UPDATE happy_agent_secrets
                    SET available_to_model = ${null},
                        environment_json = ${JSON.stringify({ TOKEN: "one", token: "two" })}
                    WHERE id = ${"bad-json"}`,
            );
            await expect(store.reference(database.context, "agent", "bad-json")).rejects.toThrow(
                "colliding environment",
            );

            await agentDatabaseRun(
                database.database,
                sql`UPDATE happy_agent_secrets
                    SET environment_json = ${JSON.stringify({ TOKEN: "value" })},
                        id = ${"bad id"}
                    WHERE id = ${"bad-json"}`,
            );
            await expect(store.reference(database.context, "agent", "bad id")).rejects.toThrow(
                "invalid reference",
            );
        });
    });

    it("returns cloned persistence values and accepts empty environment shapes", async () => {
        await withDatabase("secrets-database-clones", async (database) => {
            const store = createSecretDatabase();
            await store.register(database.context, "agent", {
                id: "clone",
                description: "Clone",
                environment: { TOKEN: "value" },
            });
            const reference = await store.reference(database.context, "agent", "clone");
            if (reference === undefined) throw new Error("Expected reference");
            reference.environmentVariables.push("MUTATED");
            await expect(store.reference(database.context, "agent", "clone")).resolves.toEqual({
                id: "clone",
                description: "Clone",
                environmentVariables: ["TOKEN"],
                revision: "1",
            });

            await expect(
                store.resolveForHost(database.context, "agent", "scope", ["clone"]),
            ).resolves.toEqual({});
            expect(Value.Check(secretHostEnvironmentSchema, {})).toBe(true);
            expect(
                Value.Check(secretCommandEnvironmentSchema, {
                    environment: {},
                    hiddenEnvironmentVariables: [],
                }),
            ).toBe(true);
        });
    });
});
