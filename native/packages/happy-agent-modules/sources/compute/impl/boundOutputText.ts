/** How a piece of output was cut down, and by how much. */
export interface BoundedText {
    readonly text: string;
    readonly truncated: boolean;
    readonly omittedCharacters: number;
}

/** Which end of a long output is the one worth keeping. */
export type BoundedTextEnd = "head" | "tail";

/**
 * Fit output into what the model can usefully be given, and say what was left out.
 *
 * Silence is the failure mode worth avoiding here: a model handed the first half of a file with
 * no sign that a second half exists reasons confidently about a file it has not seen. So every
 * cut carries a note in the text itself, counted in characters because that is what was actually
 * measured. Which end survives depends on the output: a file is read from the top, while a
 * command's newest lines are the ones that say how it went.
 */
export function boundOutputText(
    value: string,
    options: { maxCharacters: number; keep?: BoundedTextEnd },
): BoundedText {
    if (value.length <= options.maxCharacters) {
        return { text: value, truncated: false, omittedCharacters: 0 };
    }
    const omittedCharacters = value.length - options.maxCharacters;
    if (options.maxCharacters <= 0) {
        // A budget of nothing leaves no room for the note either, and a note that overflowed the
        // budget it announces would be its own kind of untruth.
        return { text: "", truncated: true, omittedCharacters };
    }
    if (options.keep === "tail") {
        const note = `[Earlier output was truncated: ${String(omittedCharacters)} characters are not shown.]`;
        return {
            text: `${note}\n${value.slice(omittedCharacters)}`,
            truncated: true,
            omittedCharacters,
        };
    }
    const note = `[Output was truncated: ${String(omittedCharacters)} further characters are not shown.]`;
    return {
        text: `${value.slice(0, options.maxCharacters)}\n${note}`,
        truncated: true,
        omittedCharacters,
    };
}
