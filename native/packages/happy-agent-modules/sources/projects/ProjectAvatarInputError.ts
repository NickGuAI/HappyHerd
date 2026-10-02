/**
 * Raised when a public project-avatar upload is not a supported image.
 *
 * The project module also uses the normalizer during best-effort avatar
 * discovery. Keeping this error in the module's public seam lets the API map
 * malformed uploads to `invalid_request` without translating unrelated
 * storage or catalog failures into a client error.
 */
export class ProjectAvatarInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ProjectAvatarInputError";
    }
}
