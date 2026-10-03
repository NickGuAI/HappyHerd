import { agentDatabaseRun } from "@slopus/happy-agent-base";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
    assertUserInputRequest,
    formatDetailPageForModel,
    type UserInputRequest,
} from "../../sources/userInput/index.js";
import {
    createUserInputDatabase,
    createUserInputModule,
    onlinePresence,
    ScriptedPresenceModule,
    singularAsk,
} from "./userInputTestSupport.js";

const agentId = "agent-one";

describe("UserInput persistence and boundary integrity", () => {
    it.fails("rejects a row whose denormalized agent column disagrees with its JSON", async () => {
        const module = createUserInputModule();
        const database = createUserInputDatabase(module, "user-input-column-integrity");
        await database.ready;
        try {
            const request = await module.ask(
                database.context,
                agentId,
                singularAsk(),
                "column-integrity",
            );
            await agentDatabaseRun(
                database.context.db,
                sql`UPDATE happy_user_input_requests
                    SET asking_agent_id = 'other-agent'
                    WHERE id = ${request.id}`,
            );
            await expect(module.get(database.context, agentId, request.id)).rejects.toThrow(
                "agent",
            );
        } finally {
            database.close();
        }
    });

    it.fails("rejects an answered batch whose primary answer disagrees with its answer map", async () => {
        const module = createUserInputModule();
        const database = createUserInputDatabase(module, "user-input-batch-answer-integrity");
        await database.ready;
        try {
            const request = await module.ask(
                database.context,
                agentId,
                {
                    context: "Two related choices.",
                    questions: [
                        {
                            id: "scope",
                            question: "Scope?",
                            options: [{ label: "Small", description: "Safer" }],
                        },
                        {
                            id: "rollout",
                            question: "Rollout?",
                            options: [{ label: "Now", description: "Fast" }],
                        },
                    ],
                },
                "batch-answer-integrity",
            );
            const malformed: UserInputRequest = {
                ...request,
                status: "answered",
                answer: "Wrong primary answer",
                answers: {
                    scope: "Small",
                    rollout: "Now",
                },
                answeredAt: request.createdAt + 1,
                updatedAt: request.createdAt + 1,
            } as UserInputRequest;
            await agentDatabaseRun(
                database.context.db,
                sql`UPDATE happy_user_input_requests
                    SET status = 'answered',
                        updated_at = ${malformed.updatedAt},
                        request_json = ${JSON.stringify(malformed)}
                    WHERE id = ${request.id}`,
            );
            await expect(module.get(database.context, agentId, request.id)).rejects.toThrow(
                "primary answer",
            );
        } finally {
            database.close();
        }
    });

    it("settles away on a synchronous presence-away subscription callback", async () => {
        // Presence answers "online" when asked, then says "away" the moment anyone subscribes:
        // the wait must take the answer the subscription gives it, synchronously.
        const presence = new ScriptedPresenceModule(onlinePresence(), (_ctx, publish) => {
            publish({
                answerWaitMs: 0,
                title: "Away",
                emoji: "🌙",
                prompt: "Continue independently.",
            });
        });
        const module = createUserInputModule(presence);
        const database = createUserInputDatabase(module, "user-input-sync-presence");
        await database.ready;
        try {
            const request = await module.ask(
                database.context,
                agentId,
                singularAsk(),
                "sync-presence",
            );
            await expect(module.wait(database.context, agentId, request.id)).resolves.toMatchObject(
                { status: "away" },
            );
        } finally {
            database.close();
        }
    });

    it.fails("keeps a detail-page continuation cursor visible within the model output budget", () => {
        const request: UserInputRequest = {
            id: "detail-request",
            askingAgentId: agentId,
            question: "Question",
            context: "Context",
            status: "pending",
            createdAt: 1,
            updatedAt: 1,
        };
        const output = formatDetailPageForModel(
            {
                request,
                detail: "D".repeat(2_000),
                cursor: 0,
                detailTotal: 2_000,
                nextCursor: "1",
            },
            256,
        );
        expect(output).toContain("Next cursor: 1");
    });

    it.fails("rejects a request whose valid per-field inputs exceed the total detail bound", async () => {
        const module = createUserInputModule();
        const database = createUserInputDatabase(module, "user-input-detail-total-bound");
        await database.ready;
        try {
            await expect(
                module.ask(
                    database.context,
                    agentId,
                    {
                        context: "C".repeat(100_000),
                        questions: Array.from({ length: 4 }, (_, index) => ({
                            id: `question-${String(index)}`,
                            question: `Question ${String(index)}`,
                            options: Array.from({ length: 13 }, (_, choice) => ({
                                label: `Choice ${String(choice)}`,
                                description: "D".repeat(2_000),
                            })),
                        })),
                    },
                    "detail-total-bound",
                ),
            ).rejects.toThrow("detail");
        } finally {
            database.close();
        }
    });

    it("keeps a request private from an agent that is no relation", async () => {
        const module = createUserInputModule();
        const database = createUserInputDatabase(module, "user-input-auth-result");
        await database.ready;
        try {
            const request = await module.ask(
                database.context,
                agentId,
                singularAsk(),
                "auth-result",
            );
            await expect(module.get(database.context, "other-agent", request.id)).rejects.toThrow(
                "not authorized",
            );
        } finally {
            database.close();
        }
    });

    it("keeps direct event payload assertions strict about unknown keys", () => {
        expect(() =>
            assertUserInputRequest({
                id: "bad",
                askingAgentId: agentId,
                question: "Question",
                context: "Context",
                status: "pending",
                createdAt: 1,
                updatedAt: 1,
                unknown: true,
            } as never),
        ).toThrow("invalid");
    });
});
