/** Characters a regular expression reads as syntax, which a glob means literally. */
const REGEXP_SYNTAX = /[.+^$()|[\]\\]/;

/**
 * A glob as the expression that matches a path against it.
 *
 * The dialect is the small one people actually type: `**` crosses directories, `*` and `?` stay
 * within one segment, and `{a,b}` offers alternatives. Everything else — dots, brackets,
 * parentheses — is a literal character of a filename, so it is escaped rather than interpreted.
 * Matching is anchored: a pattern describes a whole path relative to where the search started,
 * not a fragment of one.
 */
export function globToRegExp(pattern: string, options: { ignoreCase?: boolean } = {}): RegExp {
    let expression = "";
    for (let index = 0; index < pattern.length; index += 1) {
        const character = pattern[index] ?? "";
        if (character === "*") {
            if (pattern[index + 1] === "*") {
                // `**/` may also match nothing at all, so `**/x` finds `x` in the root itself.
                index += pattern[index + 2] === "/" ? 2 : 1;
                expression += pattern[index] === "/" ? "(?:[^/]*/)*" : ".*";
                continue;
            }
            expression += "[^/]*";
            continue;
        }
        if (character === "?") {
            expression += "[^/]";
            continue;
        }
        if (character === "{") {
            const close = pattern.indexOf("}", index);
            if (close > index) {
                const alternatives = pattern.slice(index + 1, close).split(",");
                expression += `(?:${alternatives.map(escapeLiteral).join("|")})`;
                index = close;
                continue;
            }
        }
        expression += escapeLiteral(character);
    }
    return new RegExp(`^${expression}$`, options.ignoreCase === true ? "i" : "");
}

/** One stretch of a glob that means exactly the characters it contains. */
function escapeLiteral(value: string): string {
    return [...value]
        .map((character) => (REGEXP_SYNTAX.test(character) ? `\\${character}` : character))
        .join("");
}
