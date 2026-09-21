import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => {
    const dbMock = {
        account: { count: vi.fn() },
        session: { count: vi.fn() },
        sessionMessage: { count: vi.fn() },
        machine: { count: vi.fn() },
        $queryRaw: vi.fn()
    };

    return { dbMock };
});

vi.mock("@/storage/db", () => ({
    db: dbMock
}));

import {
    getMetricsLabelsFromRequest,
    httpRequestsCounter,
    register,
    updateDatabaseMetrics,
} from "./metrics2";

describe("updateDatabaseMetrics", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        register.resetMetrics();
        dbMock.account.count.mockResolvedValue(10);
        dbMock.session.count.mockResolvedValue(20);
        dbMock.sessionMessage.count.mockResolvedValue(30);
        dbMock.machine.count.mockResolvedValue(40);
        dbMock.$queryRaw.mockResolvedValue([{ estimated_count: 123n }]);
    });

    it("uses estimated counts instead of exact table counts", async () => {
        await updateDatabaseMetrics();

        expect(dbMock.account.count).not.toHaveBeenCalled();
        expect(dbMock.session.count).not.toHaveBeenCalled();
        expect(dbMock.sessionMessage.count).not.toHaveBeenCalled();
        expect(dbMock.machine.count).not.toHaveBeenCalled();
        expect(dbMock.$queryRaw).toHaveBeenCalledTimes(4);

        const queriedTables = dbMock.$queryRaw.mock.calls.map((call) => call[1]);
        expect(queriedTables).toEqual(['"Account"', '"Session"', '"SessionMessage"', '"Machine"']);
    });

    it("does not expose raw client header values in a metrics scrape", async () => {
        const marker = 'attacker-client-marker/private-version';
        const labels = getMetricsLabelsFromRequest({
            headers: { 'x-happy-client': marker },
        });

        httpRequestsCounter.inc({
            method: 'GET',
            route: '/health',
            status: '200',
            ...labels,
        });

        const scrape = await register.metrics();
        expect(scrape).not.toContain(marker);
        expect(scrape).not.toContain('attacker-client-marker');
        expect(scrape).toMatch(/http_requests_total\{[^}]*client="other"[^}]*client_type="other"/);
    });
});
