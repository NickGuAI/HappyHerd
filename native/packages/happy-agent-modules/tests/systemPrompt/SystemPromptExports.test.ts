import * as root from "../../sources/index.js";
import {
    systemPromptAvailableModelsSchema,
    systemPromptIdentitySchema,
    systemPromptSelectionSchema,
} from "../../sources/systemPrompt/SystemPromptModule.js";
import { systemPromptProviderKindSchema } from "../../sources/systemPrompt/SystemPromptSelection.js";
import { describe, expect, it } from "vitest";

describe("System Prompt package exports", () => {
    it("exposes the same runtime contracts from the package root", () => {
        expect(root.systemPromptAvailableModelsSchema).toBe(systemPromptAvailableModelsSchema);
        expect(root.systemPromptIdentitySchema).toBe(systemPromptIdentitySchema);
        expect(root.systemPromptSelectionSchema).toBe(systemPromptSelectionSchema);
        expect(root.systemPromptProviderKindSchema).toBe(systemPromptProviderKindSchema);
        expect(root.SystemPromptModule).toBeDefined();
        expect(root.AGENTS_MD_SPEC).toContain("# AGENTS.md");
        expect(root.systemPromptForModel).toBeDefined();
    });

    it("no longer publishes a host-supplied options or global-reader contract", () => {
        expect("systemPromptModuleOptionsSchema" in root).toBe(false);
        expect("agentsMdGlobalInstructionsReaderSchema" in root).toBe(false);
    });
});
