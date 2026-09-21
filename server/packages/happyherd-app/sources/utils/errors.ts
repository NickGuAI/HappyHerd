export class HappyHerdError extends Error {
    readonly canTryAgain: boolean;

    constructor(message: string, canTryAgain: boolean) {
        super(message);
        this.canTryAgain = canTryAgain;
        this.name = 'RetryableError';
        Object.setPrototypeOf(this, HappyHerdError.prototype);
    }
}