/**
 * The command behind a Claude background shell identifier.
 *
 * Claude's shell tools name a running command with a string, while the machine numbers its
 * commands. The translation belongs to Claude's surface rather than to the machine, and anything
 * that is not one of those numbers is refused in a sentence the model can act on instead of being
 * coerced into command zero. Only the plain decimal spelling of a command is one of those
 * numbers: padding, a sign, an exponent, or another base is a model guessing at a handle it was
 * given verbatim, and guessing at which command it meant is worse than saying so.
 */
export function parseClaudeBashId(bashId: string): number {
    const parsed = Number(bashId);
    if (!/^[0-9]+$/u.test(bashId) || !Number.isSafeInteger(parsed) || parsed < 1) {
        throw new Error(`This is not a background shell identifier: ${JSON.stringify(bashId)}`);
    }
    return parsed;
}
