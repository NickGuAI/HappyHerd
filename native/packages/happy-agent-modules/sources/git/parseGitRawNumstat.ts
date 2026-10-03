import { Type, type Static } from "@sinclair/typebox";

export const gitDiffChangeKindSchema = Type.Union([
    Type.Literal("added"),
    Type.Literal("copied"),
    Type.Literal("deleted"),
    Type.Literal("modified"),
    Type.Literal("renamed"),
    Type.Literal("submodule"),
    Type.Literal("type_changed"),
]);
export type GitDiffChangeKind = Static<typeof gitDiffChangeKindSchema>;

export const gitDiffChangeSchema = Type.Object(
    {
        binary: Type.Boolean(),
        deletions: Type.Optional(Type.Integer({ minimum: 0 })),
        insertions: Type.Optional(Type.Integer({ minimum: 0 })),
        kind: gitDiffChangeKindSchema,
        path: Type.String(),
        previousPath: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
);
export type GitDiffChange = Static<typeof gitDiffChangeSchema>;

export function parseGitRawNumstat(output: string): readonly GitDiffChange[] {
    const fields = output.split("\0");
    const raw: { kind: GitDiffChangeKind; path: string; previousPath?: string }[] = [];
    let index = 0;
    for (; index < fields.length; index += 1) {
        const field = fields[index];
        if (field === undefined || field.length === 0) continue;
        if (!field.startsWith(":")) break;
        const status = field.split(" ").at(-1) ?? "";
        const letter = status[0] ?? "M";
        const path = fields[index + 1] ?? "";
        index += 1;
        if (letter === "R" || letter === "C") {
            const destination = fields[index + 1] ?? "";
            index += 1;
            raw.push({
                kind: letter === "R" ? "renamed" : "copied",
                path: destination,
                previousPath: path,
            });
        } else {
            raw.push({ kind: rawKind(letter, field), path });
        }
    }
    const counts: { binary: boolean; deletions: number; insertions: number }[] = [];
    for (; index < fields.length; index += 1) {
        const field = fields[index];
        if (field === undefined || field.length === 0) continue;
        const [insertions, deletions, inlinePath] = field.split("\t");
        if (deletions === undefined) continue;
        const binary = insertions === "-" || deletions === "-";
        counts.push({
            binary,
            deletions: binary ? 0 : parseCount(deletions),
            insertions: binary ? 0 : parseCount(insertions),
        });
        if (inlinePath === undefined || inlinePath.length === 0) index += 2;
    }
    return raw.map((entry, position) => {
        const count = counts[position];
        return {
            binary: count?.binary ?? false,
            kind: entry.kind,
            path: entry.path,
            ...(entry.previousPath === undefined ? {} : { previousPath: entry.previousPath }),
            ...(count === undefined || count.binary || entry.kind === "submodule"
                ? {}
                : { deletions: count.deletions, insertions: count.insertions }),
        };
    });
}

function rawKind(letter: string, record: string): GitDiffChangeKind {
    const [, oldMode, newMode] = /^:(\d{6}) (\d{6})/u.exec(record) ?? [];
    if (oldMode === "160000" || newMode === "160000") return "submodule";
    if (letter === "A") return "added";
    if (letter === "D") return "deleted";
    if (letter === "T") return "type_changed";
    return "modified";
}

function parseCount(value: string | undefined): number {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
