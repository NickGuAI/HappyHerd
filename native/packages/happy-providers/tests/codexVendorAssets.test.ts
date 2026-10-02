import { describe, expect, it } from "vitest";

import { codex_agent_instructions } from "@/vendors/codex/prompts/codex_agent_instructions.js";
import { codexSkills } from "@/vendors/codex/skills/codexSkills.js";
import { exec } from "@/vendors/codex/tools/exec.js";
import { tool_search } from "@/vendors/codex/tools/tool_search.js";

describe("Codex reconstruction assets", () => {
    it("keeps literal prompts, skills, and TypeBox tools available to reproduce the client", () => {
        expect(codex_agent_instructions).toContain("You are Codex");
        expect(codexSkills.length).toBeGreaterThan(0);
        expect(exec.name).toBe("exec");
        expect(tool_search.parameters?.type).toBe("object");
    });

    it("keeps them out of the external interface, because callers own their prompts and tools", async () => {
        const index = (await import("@/index.js")) as Record<string, unknown>;
        expect(index.codex_agent_instructions).toBeUndefined();
        expect(index.codexSkills).toBeUndefined();
        expect(index.exec).toBeUndefined();
        expect(index.tool_search).toBeUndefined();
    });
});
