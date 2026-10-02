/**
 * Keeps a leading number and replaces only what follows it.
 *
 * An automatically created workspace is often numbered, and the number is how a person tells one
 * from the next in a list. Naming it after the first message should change what the workspace is
 * about, not where it sits.
 */
export function withPreservedNumericPrefix(current: string, generated: string): string {
    // The separator the person already sees is kept too, so a renamed workspace still reads the
    // way its neighbours in the list do.
    const prefix = /^\d{1,4}[-_ ]+/u.exec(current)?.[0];
    return prefix === undefined ? generated : `${prefix}${generated}`;
}
