export async function runCleanupSteps(
    label: string,
    steps: readonly (() => Promise<void>)[],
): Promise<void> {
    const errors: unknown[] = [];
    for (const step of steps) {
        try {
            await step();
        } catch (error) {
            errors.push(error);
        }
    }
    if (errors.length > 0) {
        throw new AggregateError(errors, `Could not fully clean up ${label}.`);
    }
}
