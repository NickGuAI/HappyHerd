import { beforeEach, describe, expect, it, vi } from "vitest";

const {
    dbMock,
    emitEphemeralMock,
    buildMachineActivityEphemeralMock,
} = vi.hoisted(() => ({
    dbMock: {
        session: {
            findMany: vi.fn(),
            updateManyAndReturn: vi.fn(),
        },
        machine: {
            findMany: vi.fn(),
            updateManyAndReturn: vi.fn(),
        },
    },
    emitEphemeralMock: vi.fn(),
    buildMachineActivityEphemeralMock: vi.fn(),
}));

vi.mock("@/storage/db", () => ({ db: dbMock }));
vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: { emitEphemeral: emitEphemeralMock },
    buildMachineActivityEphemeral: buildMachineActivityEphemeralMock,
}));

import { deactivateTimedOutMachines } from "./timeout";

describe("presence timeout", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dbMock.machine.findMany.mockResolvedValue([]);
    });

    it("never deactivates sessions based on elapsed time", async () => {
        await deactivateTimedOutMachines(Date.parse("2036-01-01T00:00:00.000Z"));

        expect(dbMock.session.findMany).not.toHaveBeenCalled();
        expect(dbMock.session.updateManyAndReturn).not.toHaveBeenCalled();
    });

    it("keeps the independent machine-presence timeout", async () => {
        const now = Date.parse("2026-08-09T12:00:00.000Z");
        const lastActiveAt = new Date(now - 11 * 60 * 1000);
        dbMock.machine.findMany.mockResolvedValue([{ id: "machine-1", accountId: "account-1", lastActiveAt }]);
        dbMock.machine.updateManyAndReturn.mockResolvedValue([{ id: "machine-1", lastActiveAt }]);
        buildMachineActivityEphemeralMock.mockReturnValue({ type: "machine-activity" });

        await deactivateTimedOutMachines(now);

        expect(dbMock.machine.findMany).toHaveBeenCalledWith({
            where: {
                active: true,
                lastActiveAt: { lte: new Date(now - 10 * 60 * 1000) },
            },
        });
        expect(dbMock.machine.updateManyAndReturn).toHaveBeenCalledWith({
            where: { id: "machine-1", active: true },
            data: { active: false },
        });
        expect(emitEphemeralMock).toHaveBeenCalledWith({
            userId: "account-1",
            payload: { type: "machine-activity" },
            recipientFilter: { type: "user-scoped-only" },
        });
    });
});
