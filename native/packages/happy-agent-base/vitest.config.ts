import { defineConfig } from "vitest/config";

const chaos = process.env.HAPPY_AGENT_BASE_CHAOS_TESTS === "1";

export default defineConfig({
    test: {
        // Only the suite counts. Scratch files under `.context/` are notes and throwaway
        // harnesses, and must never join a run. Chaos is a separate, explicit gate: normal test
        // commands do not even collect it, while the opt-in command collects nothing else.
        include: [chaos ? "tests/chaos/**/*.test.ts" : "tests/**/*.test.ts"],
        exclude: chaos ? [] : ["tests/chaos/**/*.test.ts"],
    },
});
