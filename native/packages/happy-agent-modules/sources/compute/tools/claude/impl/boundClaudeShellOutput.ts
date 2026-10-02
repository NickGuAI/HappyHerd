import { boundOutputText, type BoundedText } from "../../../impl/boundOutputText.js";

/**
 * How much of a command's output Claude's shell tools carry in one answer. Claude's own Bash
 * description promises a bound and names it, so the number lives here rather than being borrowed
 * from another vendor's budget.
 */
export const MAX_CLAUDE_SHELL_OUTPUT_CHARACTERS = 40_000;

/**
 * Cut a command's output to what Bash and the Task tools promise to carry.
 *
 * The newest lines are the ones that say how a command went, so those are the ones kept.
 */
export function boundClaudeShellOutput(value: string): BoundedText {
    return boundOutputText(value, {
        maxCharacters: MAX_CLAUDE_SHELL_OUTPUT_CHARACTERS,
        keep: "tail",
    });
}
