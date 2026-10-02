import { Type, type Static } from "@sinclair/typebox";

export const gitStatusEntrySchema = Type.Object(
    {
        from: Type.Optional(Type.String()),
        path: Type.String(),
        staged: Type.Boolean(),
        unmerged: Type.Boolean(),
        unstaged: Type.Boolean(),
        untracked: Type.Boolean(),
    },
    { additionalProperties: false },
);
export type GitStatusEntry = Static<typeof gitStatusEntrySchema>;

export const gitStatusV2Schema = Type.Object(
    {
        ahead: Type.Integer({ minimum: 0 }),
        behind: Type.Integer({ minimum: 0 }),
        branch: Type.Optional(Type.String()),
        detached: Type.Boolean(),
        entries: Type.Array(gitStatusEntrySchema),
        head: Type.Optional(Type.String()),
        upstream: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
);
export type GitStatusV2 = Static<typeof gitStatusV2Schema>;

export function parseGitStatusV2(output: string): GitStatusV2 {
    const fields = output.split("\0");
    const entries: GitStatusEntry[] = [];
    let ahead = 0;
    let behind = 0;
    let branch: string | undefined;
    let head: string | undefined;
    let upstream: string | undefined;

    for (let index = 0; index < fields.length; index += 1) {
        const field = fields[index];
        if (field === undefined || field.length === 0) continue;
        const kind = field[0];
        if (kind === "#") {
            const [, name, ...rest] = field.split(" ");
            const value = rest.join(" ");
            if (name === "branch.oid") head = value === "(initial)" ? undefined : value;
            else if (name === "branch.head") branch = value === "(detached)" ? undefined : value;
            else if (name === "branch.upstream") upstream = value;
            else if (name === "branch.ab") {
                const [aheadValue, behindValue] = value.split(" ");
                ahead = parseSigned(aheadValue);
                behind = parseSigned(behindValue);
            }
            continue;
        }
        if (kind === "1" || kind === "2") {
            const parts = field.split(" ");
            const codes = parts[1] ?? "..";
            const path = parts.slice(kind === "1" ? 8 : 9).join(" ");
            const entry: GitStatusEntry = {
                path,
                staged: codes[0] !== "." && codes[0] !== undefined,
                unmerged: false,
                unstaged: codes[1] !== "." && codes[1] !== undefined,
                untracked: false,
            };
            if (kind === "2") {
                const from = fields[index + 1];
                index += 1;
                if (from !== undefined && from.length > 0) entry.from = from;
            }
            entries.push(entry);
            continue;
        }
        if (kind === "u") {
            entries.push({
                path: field.split(" ").slice(10).join(" "),
                staged: false,
                unmerged: true,
                unstaged: true,
                untracked: false,
            });
            continue;
        }
        if (kind === "?") {
            entries.push({
                path: field.slice(2),
                staged: false,
                unmerged: false,
                unstaged: true,
                untracked: true,
            });
        }
    }
    return {
        ahead,
        behind,
        ...(branch === undefined ? {} : { branch }),
        detached: head !== undefined && branch === undefined,
        entries,
        ...(head === undefined ? {} : { head }),
        ...(upstream === undefined ? {} : { upstream }),
    };
}

function parseSigned(value: string | undefined): number {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}
