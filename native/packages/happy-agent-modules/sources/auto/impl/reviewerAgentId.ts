import { createHash } from "node:crypto";

/**
 * Derives the private reviewer's identity from the main agent it reviews.
 *
 * There is one reviewer per main agent, and the mapping has to be both deterministic and private:
 * deterministic so a restart resolves the same reviewer without a stored index to go stale, and
 * private so that guessing a main agent ID cannot address its reviewer through the main system, an
 * HTTP route, or a tool. The reviewer only ever exists inside the private `AgentSystemLocal`, whose
 * store nothing else can reach, so a colliding guess still resolves nothing addressable.
 *
 * A cuid2 is a lowercase-alphanumeric identity beginning with a letter. Prefixing a fixed `r` and
 * taking the first 31 lowercase hex characters of the SHA-256 of the main ID yields a valid,
 * stable 32-character cuid2 that Agent Base accepts as an agent identity.
 */
export function reviewerAgentId(mainAgentId: string): string {
    const digest = createHash("sha256").update(mainAgentId, "utf8").digest("hex");
    return `r${digest.slice(0, 31)}`;
}
