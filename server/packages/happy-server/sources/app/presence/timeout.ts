import { db } from "@/storage/db";
import { delay } from "@/utils/delay";
import { forever } from "@/utils/forever";
import { shutdownSignal } from "@/utils/shutdown";
import { buildMachineActivityEphemeral, eventRouter } from "@/app/events/eventRouter";

const MACHINE_TIMEOUT_MS = 1000 * 60 * 10;

export async function deactivateTimedOutMachines(now: number = Date.now()) {
    const machines = await db.machine.findMany({
        where: {
            active: true,
            lastActiveAt: {
                lte: new Date(now - MACHINE_TIMEOUT_MS)
            }
        }
    });
    for (const machine of machines) {
        const updated = await db.machine.updateManyAndReturn({
            where: { id: machine.id, active: true },
            data: { active: false }
        });
        if (updated.length === 0) {
            continue;
        }
        eventRouter.emitEphemeral({
            userId: machine.accountId,
            payload: buildMachineActivityEphemeral(machine.id, false, updated[0].lastActiveAt.getTime()),
            recipientFilter: { type: 'user-scoped-only' }
        });
    }
}

export function startTimeout() {
    forever('machine-timeout', async () => {
        while (true) {
            // Machine presence is a heartbeat concern. Session activity is not:
            // provider processes may run indefinitely and are deactivated only by
            // an explicit session-end or the daemon observing their process exit.
            await deactivateTimedOutMachines();

            // Wait for 1 minute
            await delay(1000 * 60, shutdownSignal);
        }
    });
}
