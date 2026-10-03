import { SchedulingAlarm } from "./SchedulingAlarm.js";

/** Why a suspended agent woke up: its time came, or something arrived for it first. */
export type SchedulingSuspensionOutcome = "elapsed" | "interrupted";

/**
 * The agents currently suspended in a wait, and the two things that can end one.
 *
 * This registry is deliberately in-memory: it holds only the live suspensions of this process,
 * never the record of what is being waited for, which is a durable row. A restart loses every
 * entry here and loses nothing, because the durable wait is re-entered by the tool call that
 * owns it.
 */
export class SchedulingSuspensions {
    readonly #suspended = new Map<string, Set<(outcome: SchedulingSuspensionOutcome) => void>>();

    /**
     * Hold this agent until its due time, until something arrives for it, or until its turn is
     * cancelled. Nothing here is durable, so the caller settles the record it holds afterwards.
     */
    async suspend(
        agentId: string,
        dueAt: number,
        lifetime: AbortSignal | undefined,
    ): Promise<SchedulingSuspensionOutcome> {
        if (lifetime?.aborted === true) return "interrupted";
        if (dueAt <= Date.now()) return "elapsed";
        return await new Promise<SchedulingSuspensionOutcome>((resolve) => {
            const waiting = this.#suspended.get(agentId) ?? new Set();
            this.#suspended.set(agentId, waiting);
            let alarm: SchedulingAlarm | undefined;
            const wake = (outcome: SchedulingSuspensionOutcome): void => {
                if (!waiting.delete(wake)) return;
                if (waiting.size === 0) this.#suspended.delete(agentId);
                alarm?.cancel();
                lifetime?.removeEventListener("abort", onAbort);
                resolve(outcome);
            };
            const onAbort = (): void => wake("interrupted");
            waiting.add(wake);
            lifetime?.addEventListener("abort", onAbort, { once: true });
            alarm = new SchedulingAlarm(dueAt, () => wake("elapsed"));
        });
    }

    /** End every wait this agent is holding, because a message has arrived for it. */
    interrupt(agentId: string): void {
        for (const wake of [...(this.#suspended.get(agentId) ?? [])]) wake("interrupted");
    }

    /** End every wait in the process, which is what a shutdown does to all of them. */
    interruptAll(): void {
        for (const agentId of [...this.#suspended.keys()]) this.interrupt(agentId);
    }
}
