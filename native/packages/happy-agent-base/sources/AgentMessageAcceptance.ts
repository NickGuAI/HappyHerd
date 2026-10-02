/** The outcome of offering one caller-identified message to an agent. */
export interface AgentMessageAcceptance {
    /** The caller-supplied or Base-generated cuid2 identity. */
    readonly id: string;
    /** Which delivery queue accepted the message. */
    readonly delivery: "send" | "steer";
    /**
     * Whether this identity was inserted now or was already known. This is the durable result
     * unless the caller explicitly requests non-waiting delivery; in that mode Base returns the
     * current process's immediate reservation. The target's own loop always uses that mode.
     */
    readonly accepted: "created" | "existing";
}
