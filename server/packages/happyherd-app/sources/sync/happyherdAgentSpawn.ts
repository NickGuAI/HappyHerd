/** A catalog-owned destination understood by HappyHerd Agent's native spawn RPC. */
export type HappyHerdAgentSpawnTarget =
    | { kind: 'project'; id: string }
    | { kind: 'workspace'; id: string }
    | { kind: 'newWorkspace'; projectId: string };

/** A previously selected catalog workspace disappeared before spawn. */
export class HappyHerdAgentWorkspaceUnavailableError extends Error {
    constructor() {
        super();
        this.name = 'HappyHerdAgentWorkspaceUnavailableError';
        Object.setPrototypeOf(this, HappyHerdAgentWorkspaceUnavailableError.prototype);
    }
}

/**
 * Resolves the workspace picker state to a durable HappyHerd Agent catalog target.
 * A null project means this is an ordinary directory spawn. Once a project is
 * known, an unknown workspace must never fall back to importing its path as a
 * second project.
 */
export function resolveHappyHerdAgentSpawnTarget(options: {
    projectId: string | null | undefined;
    workspaceSelection: string;
    workspaces: readonly { id: string; path: string }[];
}): HappyHerdAgentSpawnTarget | null {
    const projectId = options.projectId?.trim();
    if (!projectId) return null;

    if (options.workspaceSelection === '__new__') {
        return { kind: 'newWorkspace', projectId };
    }
    if (options.workspaceSelection === '__none__') {
        return { kind: 'project', id: projectId };
    }

    const workspace = options.workspaces.find((candidate) => (
        candidate.path === options.workspaceSelection
    ));
    if (!workspace) {
        throw new HappyHerdAgentWorkspaceUnavailableError();
    }
    return { kind: 'workspace', id: workspace.id };
}
