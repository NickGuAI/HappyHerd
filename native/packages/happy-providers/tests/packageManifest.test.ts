import { readFile } from "node:fs/promises";

import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

const packageManifestSchema = Type.Object({
    name: Type.Literal("@slopus/happy-providers"),
    private: Type.Optional(Type.Boolean()),
    browser: Type.Literal(false),
    engines: Type.Object({ node: Type.String() }),
    exports: Type.Object({
        ".": Type.Object({
            types: Type.Literal("./dist/index.d.ts"),
            import: Type.Literal("./dist/index.js"),
            default: Type.Literal("./dist/index.js"),
        }),
    }),
    files: Type.Array(Type.String()),
    publishConfig: Type.Object({
        access: Type.Literal("public"),
        provenance: Type.Literal(true),
    }),
    scripts: Type.Object({
        build: Type.String(),
        prepack: Type.String(),
    }),
});

describe("published package contract", () => {
    it("is a public Node-only package with built ESM exports and shipped documentation", async () => {
        const path = new URL("../package.json", import.meta.url);
        const manifest = Value.Parse(
            packageManifestSchema,
            JSON.parse(await readFile(path, "utf8")),
        );

        expect(manifest.private).not.toBe(true);
        expect(manifest.engines.node).toBe(">=22.19.0");
        expect(manifest.files).toEqual(
            expect.arrayContaining(["dist", "README.md", "EXAMPLES.md", "VENDOR_*.md"]),
        );
        expect(manifest.scripts.prepack).toContain("build");
    });
});
