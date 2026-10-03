import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRootContext, withLogContext } from "@steve.kite/stdlib";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfigModule } from "../../sources/config/index.js";
import type { HistoryMessage } from "../../sources/history/index.js";
import { ObservationModule } from "../../sources/observation/ObservationModule.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await Promise.all(
        temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
});

async function temporaryRoot(name: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), name));
    temporaryDirectories.push(root);
    return root;
}

function message(recordId: string, text: string): HistoryMessage {
    return { blocks: [{ type: "text", text }], recordId, role: "assistant" };
}

async function configIn(root: string): Promise<ConfigModule> {
    return await ConfigModule.load(join(root, ".happy"));
}

function logRecords(raw: string): Array<Record<string, unknown>> {
    return raw
        .trimEnd()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("ObservationModule edge cases", () => {
    it("uses the installed root only, leaving contexts derived from the old root silent", async () => {
        const root = await temporaryRoot("happy-observation-install-");
        const config = await configIn(root);
        const observation = await ObservationModule.start(config);
        const original = createRootContext();
        const installed = observation.install(original);

        withLogContext(original, { source: "old-root" }).log.info("must not be written");
        withLogContext(installed, { source: "installed-root" }).log.info("must be written");
        await observation.close();

        const records = logRecords(await readFile(config.configuration.paths.logPath, "utf8"));
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            source: "installed-root",
            msg: "must be written",
        });
    });

    it("keeps the history dump independent from logging", async () => {
        vi.stubEnv("HAPPY_OBSERVATION_LOGS", "false");
        vi.stubEnv("HAPPY_OBSERVATION_HISTORY_DUMP", "true");
        const root = await temporaryRoot("happy-observation-independent-");
        const config = await configIn(root);
        const observation = await ObservationModule.start(config);

        await observation.recordHistory(createRootContext(), "agent1", [message("r1", "hello")]);
        await observation.flush();
        await observation.close();

        expect(
            await readFile(
                join(config.configuration.paths.historyDumpHome, "agent1.jsonl"),
                "utf8",
            ),
        ).toContain('"recordId":"r1"');
        await expect(readFile(config.configuration.paths.logPath, "utf8")).rejects.toThrow();
    });

    it("creates no observation files when every sink is disabled", async () => {
        vi.stubEnv("HAPPY_OBSERVATION_LOGS", "false");
        vi.stubEnv("HAPPY_OBSERVATION_HISTORY_DUMP", "false");
        vi.stubEnv("HAPPY_OBSERVATION_TRACES", "false");
        const root = await temporaryRoot("happy-observation-disabled-");
        const config = await configIn(root);
        const observation = await ObservationModule.start(config);

        const installed = observation.install(createRootContext());
        await installed.span("silent", async (ctx) => {
            ctx.log.info("silent");
            return "complete";
        });
        await observation.close();

        await expect(readdir(config.configuration.paths.observationHome)).rejects.toThrow();
    });

    it("installs an optional tracer without making tracing part of the caller's work", async () => {
        vi.stubEnv("HAPPY_OBSERVATION_LOGS", "false");
        vi.stubEnv("HAPPY_OBSERVATION_TRACES", "true");
        vi.stubEnv("HAPPY_OBSERVATION_TRACES_ENDPOINT", "http://127.0.0.1:1/v1/traces");
        const root = await temporaryRoot("happy-observation-tracing-");
        const config = await configIn(root);
        const observation = await ObservationModule.start(config);

        const installed = observation.install(createRootContext());
        await expect(
            installed.span("agent.turn", async (ctx) => {
                return await ctx.span("agent.inference", async () => "done");
            }),
        ).resolves.toBe("done");
        await expect(observation.close()).resolves.toBeUndefined();
    });

    it("labels traces with the deployment it was started for", async () => {
        vi.stubEnv("HAPPY_OBSERVATION_LOGS", "false");
        vi.stubEnv("HAPPY_OBSERVATION_TRACES", "true");
        vi.stubEnv("HAPPY_OBSERVATION_TRACES_ENDPOINT", "http://127.0.0.1:1/v1/traces");
        const root = await temporaryRoot("happy-observation-deployment-");
        const config = await configIn(root);
        const observation = await ObservationModule.start(config, "local-development");

        const installed = observation.install(createRootContext());
        await expect(installed.span("agent.turn", async () => "done")).resolves.toBe("done");
        await expect(observation.close()).resolves.toBeUndefined();
    });

    it("logs every lifecycle hook with its stable identifiers and outcome", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
        vi.stubEnv("HAPPY_OBSERVATION_LOG_LEVEL", "trace");
        const root = await temporaryRoot("happy-observation-hooks-");
        const config = await configIn(root);
        const observation = await ObservationModule.start(config);
        const ctx = observation.install(createRootContext());
        const hooks = observation.beforeStart();
        const scope = {
            agent: {
                effort: "high",
                id: "agent1",
                model: "gpt-5.6-sol",
                provider: "codex",
            },
            kv: {},
            sharedKV: {},
            runKV: {},
            historyKV: {},
        };

        hooks.beforeAgentLoop?.(ctx, scope as never, { loopId: "loop1" });
        hooks.beforeTurn?.(ctx, scope as never, {
            loopId: "loop1",
            turnId: "turn1",
            contextTokens: 42,
        });
        hooks.afterTurn?.(ctx, scope as never, {
            loopId: "loop1",
            turnId: "turn1",
            contextTokens: 42,
            aborted: true,
        });
        hooks.beforeInference?.(ctx, scope as never, {
            loopId: "loop1",
            turnId: "turn1",
            contextTokens: 42,
            inferenceId: "inference1",
        });
        hooks.onEvent?.(ctx, scope as never, { type: "block_start" });
        vi.advanceTimersByTime(60_000);
        hooks.onEvent?.(ctx, scope as never, { type: "reasoning_start" });
        vi.advanceTimersByTime(1);
        hooks.onEvent?.(ctx, scope as never, { type: "block_reset" });
        hooks.onEvent?.(ctx, scope as never, {
            type: "retrying",
            attempt: 1,
            reason: "provider busy",
        });
        vi.advanceTimersByTime(2_000);
        hooks.onEvent?.(ctx, scope as never, { type: "block_start" });
        vi.advanceTimersByTime(3_000);
        hooks.onEvent?.(ctx, scope as never, { type: "text_start" });
        hooks.afterInference?.(
            ctx,
            scope as never,
            {
                loopId: "loop1",
                turnId: "turn1",
                contextTokens: 42,
                inferenceId: "inference1",
                state: "normal",
                tokens: { input: 3, output: 4 },
            } as never,
        );
        hooks.afterInference?.(
            ctx,
            scope as never,
            {
                loopId: "loop1",
                turnId: "turn1",
                contextTokens: undefined,
                inferenceId: "inference2",
                state: undefined,
                tokens: undefined,
                errorMessage: "provider failed",
            } as never,
        );
        hooks.beforeToolCall?.(
            ctx,
            scope as never,
            { callId: "call1", tool: { name: "read_file" }, arguments: {} } as never,
        );
        vi.advanceTimersByTime(100);
        hooks.afterToolCall?.(
            ctx,
            scope as never,
            {
                callId: "call1",
                tool: { name: "read_file" },
                arguments: {},
                content: [],
                isError: false,
            } as never,
        );
        hooks.beforeToolCall?.(
            ctx,
            scope as never,
            { callId: "call2", tool: { name: "write_file" }, arguments: {} } as never,
        );
        vi.advanceTimersByTime(200);
        hooks.afterToolCall?.(
            ctx,
            scope as never,
            {
                callId: "call2",
                tool: { name: "write_file" },
                arguments: {},
                content: [],
                isError: true,
            } as never,
        );
        for (const status of ["cancelled", "completed", "failed"] as const) {
            hooks.beforeCompaction?.(ctx, scope as never, {
                loopId: "loop1",
                turnId: "turn1",
                contextTokens: 42,
                compactionId: `compact-${status}`,
            });
            vi.advanceTimersByTime(300);
            hooks.afterCompaction?.(
                ctx,
                scope as never,
                {
                    loopId: "loop1",
                    turnId: "turn1",
                    contextTokens: undefined,
                    compactionId: `compact-${status}`,
                    result: { status },
                } as never,
            );
        }
        hooks.afterAgentSettled?.(ctx, scope as never, {
            loopId: "loop1",
            settlementId: "settlement1",
        });

        await observation.flush();
        await observation.close();

        const records = logRecords(await readFile(config.configuration.paths.logPath, "utf8"));
        expect(records).toHaveLength(23);
        expect(records.map((record) => record.msg)).toEqual(
            expect.arrayContaining([
                'agent:run:start agentId="agent1" loopId="loop1"',
                'agent:turn:start agentId="agent1" turnId="turn1" contextTokens=42',
                'agent:turn:finish agentId="agent1" turnId="turn1" outcome=cancelled',
                'inference:start agentId="agent1" inferenceId="inference1" provider="codex" model="gpt-5.6-sol" effort="high" contextTokens=42',
                'inference:first-activity agentId="agent1" inferenceId="inference1" attempt=1 event="reasoning_start" attemptElapsedMs=60000 elapsedMs=60000',
                'inference:retry agentId="agent1" inferenceId="inference1" retry=1 elapsedMs=60001 reason="provider busy"',
                'inference:first-activity agentId="agent1" inferenceId="inference1" attempt=2 event="text_start" attemptElapsedMs=3000 elapsedMs=65001',
                'inference:finish agentId="agent1" inferenceId="inference1" state="normal" durationMs=65001 inputTokens=3 outputTokens=4',
                'inference:finish agentId="agent1" inferenceId="inference2" state="missing" error="provider failed"',
                'tool:finish agentId="agent1" callId="call1" tool="read_file" outcome=completed durationMs=100',
                'tool:finish agentId="agent1" callId="call2" tool="write_file" outcome=error durationMs=200',
                'compaction:finish agentId="agent1" compactionId="compact-completed" outcome=completed durationMs=300',
                'agent:run:finish agentId="agent1" loopId="loop1" settlementId="settlement1" outcome=completed',
            ]),
        );
        expect(records[0]).toMatchObject({ agentId: "agent1", loopId: "loop1" });
        expect(
            records.find((record) =>
                String(record.msg).startsWith('inference:finish agentId="agent1"'),
            ),
        ).toMatchObject({
            inferenceId: "inference1",
            inputTokens: 3,
            outputTokens: 4,
            state: "normal",
        });
        expect(
            records.find((record) => String(record.msg).includes('inferenceId="inference2"')),
        ).toMatchObject({ inferenceId: "inference2" });
    });

    it("does not emit history after the module is closed", async () => {
        vi.stubEnv("HAPPY_OBSERVATION_HISTORY_DUMP", "true");
        const root = await temporaryRoot("happy-observation-closed-history-");
        const config = await configIn(root);
        const observation = await ObservationModule.start(config);

        await observation.close();
        await observation.recordHistory(createRootContext(), "agent1", [message("r1", "ignored")]);
        await observation.flush();

        await expect(
            readFile(join(config.configuration.paths.historyDumpHome, "agent1.jsonl"), "utf8"),
        ).rejects.toThrow();
    });
});
