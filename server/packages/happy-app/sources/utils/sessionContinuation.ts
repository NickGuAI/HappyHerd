export type SessionTurnDeliveryOptions = {
    deliveryMode?: 'queue';
    awaitDelivery: boolean;
};

export type SessionTurnReceipt = {
    localId: string;
};

/**
 * Persist an archived session's next turn before resuming its exact provider
 * process, then carry that record ID into reconnect catch-up so it is not
 * mistaken for already-consumed history.
 */
export async function deliverSessionTurn<T extends SessionTurnReceipt | undefined>(options: {
    isDisconnected: boolean;
    canResume: boolean;
    sessionLifecycleState?: string;
    requestedDeliveryMode?: 'queue';
    awaitDelivery: boolean;
    deliver: (delivery: SessionTurnDeliveryOptions) => Promise<T>;
    resume: (replayQueueMessageId: string) => Promise<void>;
}): Promise<T> {
    const shouldResumeAfterDelivery = options.isDisconnected
        && options.canResume
        && options.sessionLifecycleState === 'archived';
    const receipt = await options.deliver({
        deliveryMode: shouldResumeAfterDelivery ? 'queue' : options.requestedDeliveryMode,
        awaitDelivery: shouldResumeAfterDelivery || options.awaitDelivery,
    });

    if (shouldResumeAfterDelivery && receipt) {
        await options.resume(receipt.localId);
    }

    return receipt;
}
