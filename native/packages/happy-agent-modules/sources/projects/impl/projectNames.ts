import { isCuid } from "@paralleldrive/cuid2";

import { ProjectRegistrationError } from "../ProjectRegistrationError.js";

const MAX_DISPLAY_NAME_CHARACTERS = 100;

/**
 * A display name a person typed. It is trimmed, bounded, and free of the invisible characters
 * that would make two different names look identical in a sidebar.
 */
export function validateProjectName(value: string): string {
    const name = value.trim();
    if (name.length === 0) throw new Error("The name cannot be empty.");
    if ([...name].length > MAX_DISPLAY_NAME_CHARACTERS) {
        throw new Error(
            `The name cannot be longer than ${String(MAX_DISPLAY_NAME_CHARACTERS)} characters.`,
        );
    }
    if (/[\p{Cc}\p{Cf}]/u.test(name)) {
        throw new Error("The name cannot contain control characters.");
    }
    return name;
}

/** A managed project's name also names its folder, so it has to be exactly one folder name. */
export function validateManagedProjectFolderName(value: string): string {
    const name = validateProjectName(value);
    if (
        name === "." ||
        name === ".." ||
        name === ".rig" ||
        name.includes("/") ||
        name.includes("\\")
    ) {
        throw new ProjectRegistrationError(
            "invalid_request",
            "The managed project name must be one folder name.",
        );
    }
    return name;
}

/**
 * Accepts an identity a client chose for something it is creating, so a retry lands on the
 * entity the first attempt made rather than making a second one.
 */
export function clientChosenId(value: string, entity: string): string {
    const id = value.trim();
    if (!isCuid(id)) {
        throw new Error(`The ${entity} ID must be a cuid2 identity.`);
    }
    return id;
}

export function clientChosenProjectId(value: string): string {
    try {
        return clientChosenId(value, "project");
    } catch {
        throw new ProjectRegistrationError(
            "invalid_request",
            "The project ID must be a cuid2 identity.",
        );
    }
}

/**
 * Validates an explicitly requested base reference. Most workspaces name no base at all and fork
 * the project's trunk; a caller that does name one is held to a reference Git can be handed safely.
 */
export function requestedBaseRef(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    const baseRef = value.trim();
    if (baseRef.length === 0) return undefined;
    if (baseRef.length > 200 || baseRef.startsWith("-") || /[\p{Cc}\p{Cf}]/u.test(baseRef)) {
        throw new Error("The workspace base reference is invalid.");
    }
    return baseRef;
}
