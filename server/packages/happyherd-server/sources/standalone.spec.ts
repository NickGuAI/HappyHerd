import { describe, expect, it } from "vitest";
import { isStandaloneEntrypoint } from "./standalone";

describe("isStandaloneEntrypoint", () => {
    it("recognizes standalone script paths on Windows and POSIX", () => {
        expect(isStandaloneEntrypoint("C:\\Projects\\Work\\happyherd\\packages\\happyherd-server\\sources\\standalone.ts")).toBe(true);
        expect(isStandaloneEntrypoint("/repo/packages/happyherd-server/sources/standalone.ts")).toBe(true);
        expect(isStandaloneEntrypoint("/repo/packages/happyherd-server/dist/happyherd-server")).toBe(true);
        expect(isStandaloneEntrypoint("C:\\repo\\packages\\happyherd-server\\dist\\happyherd-server.exe")).toBe(true);
    });

    it("rejects unrelated entrypoints", () => {
        expect(isStandaloneEntrypoint("C:\\repo\\node_modules\\vitest\\vitest.mjs")).toBe(false);
        expect(isStandaloneEntrypoint("/repo/packages/happyherd-server/sources/main.ts")).toBe(false);
    });
});
