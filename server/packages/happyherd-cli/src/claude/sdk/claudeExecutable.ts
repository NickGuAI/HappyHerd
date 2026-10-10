import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type ClaudeVersionUtils = {
    findGlobalClaudeCliPath: () => { path: string; source: string } | null;
};

const require = createRequire(import.meta.url);

/** Use the same explicit/PATH/package-manager resolution as the local launcher. */
export function resolveClaudeCodeExecutable(): string | undefined {
    const moduleDirectory = dirname(fileURLToPath(import.meta.url));
    const candidates = [
        resolve(moduleDirectory, '../../../scripts/claude_version_utils.cjs'),
        resolve(moduleDirectory, '../scripts/claude_version_utils.cjs'),
    ];

    for (const candidate of candidates) {
        try {
            const utils = require(candidate) as ClaudeVersionUtils;
            return utils.findGlobalClaudeCliPath()?.path;
        } catch {
            // Source tests and the bundled package place this maintained CJS
            // resolver at different relative paths.
        }
    }

    return undefined;
}
