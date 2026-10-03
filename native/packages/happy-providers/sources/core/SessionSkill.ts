/**
 * A native skill as a vendor describes it in its prompt.
 *
 * Callers compose their own skill text, so this type exists to reproduce each vendor's own
 * catalog in tests rather than to accept skills through the session interface.
 */
export type SessionSkillSource =
    | "file"
    | "environment_resource"
    | "orchestrator_resource"
    | "custom_resource";

export interface SessionSkill {
    readonly name: string;
    readonly description: string;
    readonly source: SessionSkillSource;
    readonly location: string;
}
