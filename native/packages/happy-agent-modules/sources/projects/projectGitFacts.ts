import type { GitRepositoryFacts } from "../git/types.js";

import type { ProjectGitFacts } from "./Project.js";

/**
 * What a catalog row keeps of everything Git said.
 *
 * A probe and a live scan both answer with the full repository facts; a row keeps divergence, the
 * branch, the head, and the upstream, and drops what it has no column for. Both catalogs record
 * the same shape, so the translation lives in one place.
 */
export function projectGitFactsFrom(facts: GitRepositoryFacts): ProjectGitFacts {
    return {
        ahead: facts.ahead,
        behind: facts.behind,
        detached: facts.detached,
        ...(facts.branch === undefined ? {} : { branch: facts.branch }),
        ...(facts.head === undefined ? {} : { head: facts.head }),
        ...(facts.upstream === undefined ? {} : { upstream: facts.upstream }),
    };
}
