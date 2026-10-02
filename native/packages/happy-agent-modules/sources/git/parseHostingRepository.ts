import { Type, type Static } from "@sinclair/typebox";

export const hostingRepositorySchema = Type.Object(
    {
        host: Type.Union([
            Type.Literal("bitbucket.org"),
            Type.Literal("github.com"),
            Type.Literal("gitlab.com"),
        ]),
        owner: Type.String({ minLength: 1 }),
        repository: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
);
export type HostingRepository = Static<typeof hostingRepositorySchema>;

export function parseHostingRepository(remote: string): HostingRepository | undefined {
    let host: string;
    let path: string;
    try {
        if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(remote)) {
            const url = new URL(remote);
            host = url.hostname.toLocaleLowerCase("en-US");
            path = url.pathname;
        } else {
            const match = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/u.exec(remote);
            if (match === null) return undefined;
            host = (match[1] ?? "").toLocaleLowerCase("en-US");
            path = match[2] ?? "";
        }
        if (host !== "github.com" && host !== "gitlab.com" && host !== "bitbucket.org") {
            return undefined;
        }
        const parts = path
            .replace(/^\/+/u, "")
            .replace(/\.git$/iu, "")
            .split("/")
            .map((part) => decodeURIComponent(part));
        if (parts.length < 2 || (host !== "gitlab.com" && parts.length !== 2)) return undefined;
        const owner = parts.slice(0, -1).join("/");
        const repository = parts.at(-1) ?? "";
        const valid = /^[A-Za-z0-9_.-]{1,100}$/u;
        if (
            owner.split("/").some((part) => !valid.test(part) || part === "." || part === "..") ||
            !valid.test(repository) ||
            repository === "." ||
            repository === ".."
        ) {
            return undefined;
        }
        return { host, owner, repository };
    } catch {
        return undefined;
    }
}
