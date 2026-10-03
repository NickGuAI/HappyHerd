/** The longest delay one Node timer is asked for at once; longer waits are re-armed in chunks. */
const MAX_TIMER_DELAY = 2_147_483_647;

/**
 * One alarm that fires at an absolute time.
 *
 * Scheduling keeps its own time: the alarm reads the clock and holds the timer itself, so nothing
 * outside the module decides when a wait ends or a message is due. A due time may be further away
 * than a single Node timer can express, so the alarm re-arms itself in chunks and only fires once
 * the clock has really reached the moment asked for. Timers are unreferenced, so a pending
 * scheduled message never keeps the process alive on its own. Cancelling is idempotent, and an
 * alarm that already fired cannot fire again.
 */
export class SchedulingAlarm {
    #handle: ReturnType<typeof setTimeout> | undefined;
    #done = false;

    constructor(dueAt: number, fire: () => void) {
        this.#arm(dueAt, fire);
    }

    cancel(): void {
        if (this.#done) return;
        this.#done = true;
        if (this.#handle !== undefined) clearTimeout(this.#handle);
        this.#handle = undefined;
    }

    #arm(dueAt: number, fire: () => void): void {
        if (this.#done) return;
        const remaining = dueAt - Date.now();
        if (remaining <= 0) {
            this.#done = true;
            this.#handle = undefined;
            fire();
            return;
        }
        const handle = setTimeout(
            () => {
                this.#handle = undefined;
                this.#arm(dueAt, fire);
            },
            Math.min(remaining, MAX_TIMER_DELAY),
        );
        (handle as { unref?: () => void }).unref?.();
        this.#handle = handle;
    }
}
