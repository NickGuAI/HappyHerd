export interface ProviderUsageRequestErrorOptions {
    retryAt?: number;
    status: number;
}

/** A provider usage request failed with an actionable upstream response. */
export class ProviderUsageRequestError extends Error {
    readonly retryAt: number | undefined;
    readonly status: number;

    constructor(message: string, options: ProviderUsageRequestErrorOptions) {
        super(message);
        this.name = "ProviderUsageRequestError";
        this.retryAt = options.retryAt;
        this.status = options.status;
    }
}
