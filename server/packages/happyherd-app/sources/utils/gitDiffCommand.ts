/** Commands sent through the existing session shell RPC. */
export interface GitDiffOptions {
    contextLines?: number;
    ignoreWhitespace?: boolean;
    /** Remote machine platform, never the browser platform. */
    platform?: string;
}

export const FULL_FILE_CONTEXT = 100_000;

/** POSIX shell quoting; Windows uses an encoded argv invocation below. */
export function quoteShellPath(path: string): string {
    return `"${path.replace(/([\\"$`])/g, '\\$1')}"`;
}

/**
 * Node is part of the CLI runtime on every supported host. Encoding argv keeps
 * filenames out of cmd.exe expansion and avoids an external base64 executable.
 * Only fixed JavaScript and base64 data enter the shell command.
 */
function nodeGitCommand(args: string[], base64: boolean): string {
    const bytes = new TextEncoder().encode(JSON.stringify(args));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const encoded = btoa(binary);
    return `node -e "const a=JSON.parse(Buffer.from('${encoded}','base64').toString('utf8'));process.stdout.write(require('child_process').execFileSync('git',a,{maxBuffer:33554432})${base64 ? ".toString('base64')" : ''})"`;
}

export function buildGitDiffCommand(path: string, options: GitDiffOptions = {}): string {
    const flags = ['--no-ext-diff'];
    if (options.contextLines !== undefined) flags.push(`-U${options.contextLines}`);
    if (options.ignoreWhitespace) flags.push('-w');
    if (options.platform === 'win32') {
        return nodeGitCommand(['--literal-pathspecs', '-c', 'core.quotepath=false', 'diff', 'HEAD', ...flags, '--', path], false);
    }
    return `git --literal-pathspecs -c core.quotepath=false diff HEAD ${flags.join(' ')} -- ${quoteShellPath(path)}`;
}

/** Reads the binary HEAD blob without shell pipelines or text transcoding. */
export function buildGitShowBase64Command(path: string): string {
    return nodeGitCommand(['-c', 'core.quotepath=false', 'show', `HEAD:${path}`], true);
}
