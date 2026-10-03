import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveLinuxSupervisorBinary } from "../resolveLinuxSupervisorBinary.js";

describe("resolveLinuxSupervisorBinary", () => {
    it("accepts an explicit binary independently of the host platform", () => {
        const directory = mkdtempSync(path.join(tmpdir(), "happy-supervisor-test-"));
        const binary = path.join(directory, "happy-agent-supervisor");
        writeFileSync(binary, "");
        chmodSync(binary, 0o755);

        try {
            expect(resolveLinuxSupervisorBinary("amd64", binary)).toBe(binary);
            expect(resolveLinuxSupervisorBinary("aarch64", binary)).toBe(binary);
        } finally {
            rmSync(directory, { force: true, recursive: true });
        }
    });

    it("rejects unknown architectures at runtime", () => {
        expect(() =>
            resolveLinuxSupervisorBinary(
                "riscv64" as Parameters<typeof resolveLinuxSupervisorBinary>[0],
            ),
        ).toThrow("Unsupported Linux supervisor architecture");
    });
});
