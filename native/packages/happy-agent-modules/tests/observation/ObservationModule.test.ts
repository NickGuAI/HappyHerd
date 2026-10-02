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
    vi.unstubAllEnvs();
    await Promise.all(
        temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
});

/**
 * A configuration module rooted in a throwaway folder.
 *
 * Observation reads its settings and every path it writes to from this one module, so a test that
 * wants a different layout gives it a different root rather than options of its own.
 */
async function configIn(root: string): Promise<ConfigModule> {
    return await ConfigModule.load(join(root, ".happy"));
}

async function temporaryRoot(name: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), name));
    temporaryDirectories.push(root);
    return root;
}

function message(recordId: string, text: string): HistoryMessage {
    return { blocks: [{ type: "text", text }], recordId, role: "assistant" };
}

describe("ObservationModule", () => {
    it("logs to a file through the context it installs", async () => {
        const root = await temporaryRoot("happy-observation-module-");
        const config = await configIn(root);
        const observation = await ObservationModule.start(config);

        const ctx = withLogContext(observation.install(createRootContext()), {
            agentId: "agent1",
        });
        ctx.log.info("The agent said something.");
        ctx.log.debug("Quieter than the configured level.");
        await observation.flush();

        const written = await readFile(config.configuration.paths.logPath, "utf8");
        const records = written
            .trimEnd()
            .split("\n")
            .map((line) => JSON.parse(line) as Record<string, unknown>);
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            agentId: "agent1",
            msg: "The agent said something.",
            name: "happy-agent",
        });

        await observation.close();
    });

    it("writes no history dump until it is asked for one", async () => {
        const root = await temporaryRoot("happy-observation-module-off-");
        const config = await configIn(root);
        const observation = await ObservationModule.start(config);

        await observation.recordHistory(createRootContext(), "agent1", [message("r1", "hello")]);
        await observation.flush();

        expect(observation.settings.historyDump).toBe(false);
        await expect(readdir(config.configuration.paths.historyDumpHome)).rejects.toThrow();

        await observation.close();
    });

    it("dumps committed history when the environment turns it on", async () => {
        vi.stubEnv("HAPPY_OBSERVATION_HISTORY_DUMP", "true");
        const root = await temporaryRoot("happy-observation-module-dump-");
        const config = await configIn(root);
        const observation = await ObservationModule.start(config);

        await observation.recordHistory(createRootContext(), "agent1", [message("r1", "hello")]);
        await observation.flush();

        const dumped = await readFile(
            join(config.configuration.paths.historyDumpHome, "agent1.jsonl"),
            "utf8",
        );
        expect(JSON.parse(dumped.trimEnd())).toMatchObject({ agentId: "agent1", recordId: "r1" });

        await observation.close();
    });

    it("installs nothing when logging and tracing are both off", async () => {
        vi.stubEnv("HAPPY_OBSERVATION_LOGS", "false");
        const root = await temporaryRoot("happy-observation-module-silent-");
        const config = await configIn(root);
        const observation = await ObservationModule.start(config);

        const rootCtx = createRootContext();
        expect(observation.install(rootCtx)).toBe(rootCtx);
        // A span with no tracer installed simply runs its work, so nothing costs anything.
        expect(await rootCtx.span("agent.turn", async () => "done")).toBe("done");
        await expect(readdir(config.configuration.paths.observationHome)).rejects.toThrow();

        await observation.close();
    });

    it("closes once, and stays closed", async () => {
        const root = await temporaryRoot("happy-observation-module-close-");
        const config = await configIn(root);
        const observation = await ObservationModule.start(config);

        await observation.close();
        await expect(observation.close()).resolves.toBeUndefined();
    });
});
