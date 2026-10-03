import { runScanGit } from "./runScanGit.js";

export async function runSandboxedGitCommand(
    cwd: string,
    args: readonly string[],
    options: { signal?: AbortSignal } = {},
): Promise<string> {
    const result = await runScanGit({
        args,
        cwd,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    return result.stdout.trim();
}
