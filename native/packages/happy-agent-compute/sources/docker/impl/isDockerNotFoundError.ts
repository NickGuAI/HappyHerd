/** Whether a dockerode rejection is the daemon's 404 for a missing container, image, or path. */
export function isDockerNotFoundError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "statusCode" in error &&
        error.statusCode === 404
    );
}
