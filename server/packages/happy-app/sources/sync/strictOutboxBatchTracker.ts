type StrictOutboxBatch<TOptimistic> = {
    optimistic: readonly TOptimistic[];
    resolve: () => void;
    reject: (error: Error) => void;
};

/**
 * Keeps strict optimistic records out of the visible message store until the
 * server accepts their outbox batch. Retryable transport failures deliberately
 * leave the entry untouched; terminal rejection drops it and releases the
 * caller with the server error.
 */
export class StrictOutboxBatchTracker<TOptimistic> {
    private batches = new Map<string, StrictOutboxBatch<TOptimistic>>();

    register(batchId: string, optimistic: readonly TOptimistic[]): Promise<void> {
        if (this.batches.has(batchId)) {
            throw new Error(`Strict outbox batch ${batchId} is already pending`);
        }
        return new Promise<void>((resolve, reject) => {
            this.batches.set(batchId, {
                optimistic: [...optimistic],
                resolve,
                reject,
            });
        });
    }

    settle(
        batchId: string,
        args: {
            error?: Error;
            applyOptimistic: (messages: readonly TOptimistic[]) => void;
        },
    ): void {
        if (args.error) {
            this.reject(batchId, args.error);
            return;
        }
        this.accept(batchId, args.applyOptimistic);
    }

    private accept(batchId: string, applyOptimistic: (messages: readonly TOptimistic[]) => void): void {
        const batch = this.batches.get(batchId);
        if (!batch) return;

        this.batches.delete(batchId);
        try {
            if (batch.optimistic.length > 0) {
                applyOptimistic(batch.optimistic);
            }
            batch.resolve();
        } catch (error) {
            batch.reject(error instanceof Error ? error : new Error(String(error)));
        }
    }

    private reject(batchId: string, error: Error): void {
        const batch = this.batches.get(batchId);
        if (!batch) return;

        this.batches.delete(batchId);
        batch.reject(error);
    }
}
