import { Type, type Static } from "@sinclair/typebox";

/**
 * Why a folder could not become a project. The codes are the ones a client shows a person, so
 * they stay stable and each one has exactly one human explanation beside it.
 */
export const projectRegistrationErrorCodeSchema = Type.Union([
    Type.Literal("invalid_request"),
    Type.Literal("managed_workspace_unavailable"),
    Type.Literal("not_directory"),
    Type.Literal("not_git_repository"),
    Type.Literal("not_git_top_level"),
    Type.Literal("path_inaccessible"),
    Type.Literal("path_missing"),
    Type.Literal("project_id_conflict"),
    Type.Literal("project_path_conflict"),
    Type.Literal("unsupported_git_source"),
]);

export type ProjectRegistrationErrorCode = Static<typeof projectRegistrationErrorCodeSchema>;

export class ProjectRegistrationError extends Error {
    readonly code: ProjectRegistrationErrorCode;

    constructor(code: ProjectRegistrationErrorCode, message: string) {
        super(message);
        this.code = code;
        this.name = "ProjectRegistrationError";
    }
}
