import { PGlite } from "@electric-sql/pglite";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "../utils/log";
import { startPGliteCheckpoints } from "./pgliteCheckpoints";

vi.mock("../utils/log", () => ({ log: vi.fn() }));

const interval = 5 * 60 * 1000;
const MiB = 1024 * 1024;

async function walBytes(dir: string) {
    const names = await readdir(join(dir, "pg_wal"));
    const segments = await Promise.all(names.filter(name => /^[0-9A-F]{24}$/.test(name))
        .map(name => stat(join(dir, "pg_wal", name))));
    return segments.reduce((sum, segment) => sum + segment.size, 0);
}

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("PGlite checkpoints", () => {
    it("bounds WAL across repeated writes while the control keeps growing", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const results: number[][] = [];
        for (const maintained of [false, true]) {
            const dir = await mkdtemp(join(tmpdir(), "pglite-wal-"));
            const pg = new PGlite(dir);
            let stop = async () => {};
            try {
                await pg.exec(`CREATE TABLE wal_test (id int PRIMARY KEY, payload text);
                    ALTER TABLE wal_test ALTER COLUMN payload SET STORAGE EXTERNAL;
                    INSERT INTO wal_test SELECT i, repeat(md5(i::text), 256) FROM generate_series(1, 1024) i;`);
                if (maintained) stop = startPGliteCheckpoints(pg);
                const sizes: number[] = [];
                for (let batch = 1; batch <= 24; batch++) {
                    await pg.query("UPDATE wal_test SET payload = repeat(md5((id + $1)::text), 256)", [batch]);
                    await vi.advanceTimersByTimeAsync(interval);
                    sizes.push(await walBytes(dir));
                }
                results.push(sizes);
                const data = await pg.query<{ count: number }>(
                    "SELECT count(*)::int AS count FROM wal_test WHERE payload = repeat(md5((id + 24)::text), 256)");
                expect(data.rows[0].count).toBe(1024);
                await stop();
                await pg.close();
                const reopened = new PGlite(dir);
                try {
                    expect((await reopened.query<{ count: number }>("SELECT count(*)::int AS count FROM wal_test")).rows[0].count).toBe(1024);
                } finally {
                    await reopened.close();
                }
            } finally {
                await stop();
                if (!pg.closed) await pg.close();
                await rm(dir, { recursive: true, force: true });
            }
        }
        const [control, maintained] = results;
        expect(control[23] - control[7]).toBeGreaterThan(100 * MiB);
        expect(control[23]).toBeGreaterThan(200 * MiB);
        // Default PostgreSQL min_wal_size retains recyclable segments. Assert a
        // plateau, not an immediate fall to zero or a hard max_wal_size quota.
        expect(Math.max(...maintained.slice(8))).toBeLessThanOrEqual(96 * MiB);
        expect(maintained[23]).toBeLessThanOrEqual(maintained[7]);
        console.info("WAL MiB by batch (control / maintained):", results.map(sizes => sizes.map(size => size / MiB)));
    }, 60_000);

    it("waits for a real transaction and drains one checkpoint when stopped", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const pg = new PGlite();
        await pg.exec("CREATE TABLE checkpoint_test (id int)");
        const exec = vi.spyOn(pg, "exec");
        let release!: () => void;
        let entered!: () => void;
        const ready = new Promise<void>(resolve => { entered = resolve; });
        const gate = new Promise<void>(resolve => { release = resolve; });
        const transaction = pg.transaction(async tx => {
            await tx.exec("INSERT INTO checkpoint_test VALUES (1)");
            entered();
            await gate;
        });
        const stop = startPGliteCheckpoints(pg);
        try {
            await ready;
            await vi.advanceTimersByTimeAsync(interval * 3);
            expect(exec).toHaveBeenCalledTimes(1);
            let drained = false;
            const stopping = stop().then(() => { drained = true; });
            await Promise.resolve();
            expect(drained).toBe(false);
            release();
            await transaction;
            await stopping;
            expect(drained).toBe(true);
            await vi.advanceTimersByTimeAsync(interval * 2);
            expect(exec).toHaveBeenCalledTimes(1);
            expect((await pg.query("SELECT id FROM checkpoint_test")).rows).toEqual([{ id: 1 }]);
        } finally {
            release();
            await transaction;
            await stop();
            await pg.close();
        }
    });

    it("reports a failed checkpoint and retries at the next interval", async () => {
        vi.useFakeTimers();
        const pg = new PGlite();
        await pg.waitReady;
        const exec = vi.spyOn(pg, "exec").mockRejectedValueOnce(new Error("checkpoint failure"));
        const stop = startPGliteCheckpoints(pg);
        try {
            await vi.advanceTimersByTimeAsync(interval);
            expect(log).toHaveBeenCalledWith(
                { module: "pglite", level: "error" },
                "WAL checkpoint failed; retrying at the next interval: Error: checkpoint failure"
            );
            await vi.advanceTimersByTimeAsync(interval);
            expect(exec).toHaveBeenCalledTimes(2);
        } finally {
            await stop();
            await pg.close();
        }
    });

    it("cancels an idle timer and does nothing for external PostgreSQL", async () => {
        vi.useFakeTimers();
        await startPGliteCheckpoints(null)();
        expect(vi.getTimerCount()).toBe(0);
        const pg = new PGlite();
        await pg.waitReady;
        const exec = vi.spyOn(pg, "exec");
        const stop = startPGliteCheckpoints(pg);
        await stop();
        await vi.advanceTimersByTimeAsync(interval * 2);
        expect(exec).not.toHaveBeenCalled();
        await pg.close();
    });
});
