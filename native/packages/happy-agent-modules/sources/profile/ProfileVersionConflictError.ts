import type { Profile } from "./ProfileTypes.js";

/** A conditional profile mutation was based on a resource version that is no longer current. */
export class ProfileVersionConflictError extends Error {
    readonly current: Profile;

    constructor(current: Profile) {
        super("The profile has changed.");
        this.name = "ProfileVersionConflictError";
        this.current = structuredClone(current);
    }
}
