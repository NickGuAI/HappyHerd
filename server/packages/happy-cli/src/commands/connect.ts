import chalk from 'chalk';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { StringDecoder } from 'string_decoder';
import { readCredentials } from '@/persistence';
import { ApiClient } from '@/api/api';
import { authenticateCodex } from './connect/authenticateCodex';
import { authenticateClaude } from './connect/authenticateClaude';
import { authenticateGemini } from './connect/authenticateGemini';
import { decodeJwtPayload } from './connect/utils';
import spawn from 'cross-spawn';
import {
    accountAuthFile,
    accountHome,
    upsertCredentialAccount,
    useCredentialAccount,
    validateAccountName,
} from '@/credentialPool/store';
import type { CredentialPoolPaths } from '@/credentialPool/store';
import type { CredentialAccount, CredentialProvider } from '@/credentialPool/types';

export type ConnectCommandDependencies = {
    credentialPoolPaths?: CredentialPoolPaths;
};

/**
 * Handle connect subcommand
 * 
 * Implements connect subcommands for storing AI vendor API keys:
 * - connect codex: Store OpenAI API key in Happy cloud
 * - connect claude: Store Anthropic API key in Happy cloud
 * - connect gemini: Store Gemini API key in Happy cloud
 * - connect help: Show help for connect command
 */
export async function handleConnectCommand(
    args: string[],
    dependencies: ConnectCommandDependencies = {},
): Promise<void> {
    const subcommand = args[0];

    if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
        showConnectHelp();
        return;
    }

    const accountOption = readAccountOption(args.slice(1));
    if (accountOption.name) {
        const provider = subcommand.toLowerCase();
        if (provider !== 'claude' && provider !== 'codex' && provider !== 'grok') {
            throw new Error('Named accounts are supported for claude, codex, and grok.');
        }
        await handleConnectNamedAccount(provider, accountOption.name, dependencies);
        return;
    }

    switch (subcommand.toLowerCase()) {
        case 'codex':
            await handleConnectVendor('codex', 'OpenAI');
            break;
        case 'claude':
            await handleConnectVendor('claude', 'Anthropic');
            break;
        case 'gemini':
            await handleConnectVendor('gemini', 'Gemini');
            break;
        case 'grok':
            throw new Error('Grok requires a nickname: happyherd connect grok --acct <nickname>');
        case 'status':
            await handleConnectStatus();
            break;
        default:
            console.error(chalk.red(`Unknown connect target: ${subcommand}`));
            showConnectHelp();
            process.exit(1);
    }
}

function showConnectHelp(): void {
    console.log(`
${chalk.bold('happy connect')} - Connect AI vendor API keys to Happy cloud

${chalk.bold('Usage:')}
  happyherd connect claude --acct <nickname>
  happyherd connect codex --acct <nickname>
  happyherd connect grok --acct <nickname>
  happy connect codex        Store your Codex API key in Happy cloud
  happy connect claude       Store your Anthropic API key in Happy cloud
  happy connect gemini       Store your Gemini API key in Happy cloud
  happy connect status       Show connection status for all vendors
  happy connect help         Show this help message

${chalk.bold('Description:')}
  The connect command allows you to securely store your AI vendor API keys
  in Happy cloud. This enables you to use these services through Happy
  without exposing your API keys locally.

${chalk.bold('Examples:')}
  happyherd connect claude --acct work
  happyherd connect codex --acct personal
  happyherd connect grok --acct primary
  happy connect codex
  happy connect claude
  happy connect gemini
  happy connect status

${chalk.bold('Notes:')} 
  • You must be authenticated with Happy first (run 'happy auth login')
  • API keys are encrypted and stored securely in Happy cloud
  • You can manage your stored keys at app.happy.engineering
`);
}

function readAccountOption(args: string[]): { name?: string } {
    if (args.length === 0) return {};

    if (args.includes('-acct')) {
        throw new Error('Unknown option "-acct". Use --acct <nickname>.');
    }

    const accountOptionCount = args.filter((arg) => arg === '--acct').length;
    if (accountOptionCount > 1) {
        throw new Error('--acct may be specified only once.');
    }

    const index = args.indexOf('--acct');
    if (index < 0) {
        const unexpected = args[0];
        if (unexpected.startsWith('-')) {
            throw new Error(`Unknown connect option "${unexpected}". Use --acct <nickname> for a named account.`);
        }
        throw new Error(`Unexpected connect argument "${unexpected}". Use --acct <nickname> for a named account.`);
    }
    if (index !== 0) {
        throw new Error(`Unexpected connect argument "${args[0]}". Use --acct <nickname> for a named account.`);
    }

    const value = args[1];
    if (!value || value.startsWith('-')) {
        throw new Error('Missing nickname after --acct. Use --acct <nickname>.');
    }
    if (args.length > 2) {
        const unexpected = args[2];
        if (unexpected.startsWith('-')) {
            throw new Error(`Unknown connect option "${unexpected}". Only --acct <nickname> is supported.`);
        }
        throw new Error(`Unexpected connect argument "${unexpected}". Only --acct <nickname> is supported.`);
    }
    return { name: validateAccountName(value) };
}

const CLAUDE_SETUP_TOKEN_PROMPT = 'Paste code here if prompted > ';
const CLAUDE_SETUP_TOKEN_OUTPUT_TOKEN = /Welcome to Claude Code(?: v?\d+(?:\.\d+){1,3})?|[ \t]*[*·✢✶✻✽]?[ \t]*Opening browser to sign in(?: with your Claude account)?(?:…|\.\.\.)|Browser didn't open\? Use the url below to sign in(?: \(c to copy\))?|https:\/\/(?:claude\.com|claude\.ai)\/[^\s]+|Paste code here if prompted > /gu;

type ClaudeSetupTokenOutputChannel = 'stdout' | 'stderr';

/**
 * Claude's setup-token command renders an Ink screen even though its output is
 * piped. Terminal capture then records every redraw as another Welcome/spinner
 * line. Keep stdin attached to Claude, but turn those redraws into a small,
 * append-only transcript while leaving all other setup-token output intact.
 */
class ClaudeSetupTokenOutputMediator {
    private readonly pending: Record<ClaudeSetupTokenOutputChannel, string> = {
        stdout: '',
        stderr: '',
    };
    private readonly decoders: Record<ClaudeSetupTokenOutputChannel, StringDecoder> = {
        stdout: new StringDecoder('utf8'),
        stderr: new StringDecoder('utf8'),
    };
    private readonly seen = new Set<string>();
    private atLineStart = true;

    push(channel: ClaudeSetupTokenOutputChannel, chunk: Buffer): void {
        const write = channel === 'stdout'
            ? (text: string) => process.stdout.write(text)
            : (text: string) => process.stderr.write(text);
        this.pending[channel] += this.sanitize(this.decoders[channel].write(chunk));
        this.drainCompleteOutput(channel, write);
    }

    private drainCompleteOutput(
        channel: ClaudeSetupTokenOutputChannel,
        write: (text: string) => void,
    ): void {
        let newline = this.pending[channel].indexOf('\n');
        while (newline >= 0) {
            const line = this.pending[channel].slice(0, newline);
            this.pending[channel] = this.pending[channel].slice(newline + 1);
            this.render(line, write, true);
            newline = this.pending[channel].indexOf('\n');
        }

        // Claude's manual-code prompt deliberately has no trailing newline.
        // Render it immediately so inherited stdin remains understandable.
        const promptEnd = this.pending[channel].indexOf(CLAUDE_SETUP_TOKEN_PROMPT)
            + CLAUDE_SETUP_TOKEN_PROMPT.length;
        if (promptEnd >= CLAUDE_SETUP_TOKEN_PROMPT.length) {
            const ready = this.pending[channel].slice(0, promptEnd);
            this.pending[channel] = this.pending[channel].slice(promptEnd);
            this.render(ready, write, false);
        }
    }

    flush(): void {
        for (const channel of ['stdout', 'stderr'] as const) {
            const write = channel === 'stdout'
                ? (text: string) => process.stdout.write(text)
                : (text: string) => process.stderr.write(text);
            this.pending[channel] += this.sanitize(this.decoders[channel].end());
            this.drainCompleteOutput(channel, write);
            if (this.pending[channel]) {
                this.render(this.pending[channel], write, false);
                this.pending[channel] = '';
            }
        }
    }

    private sanitize(text: string): string {
        return text
            // OSC hyperlinks and titles.
            .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, '')
            // A vertical cursor move separates two Ink screen frames.
            .replace(/\u001b\[[0-?]*[ -/]*[ABEFHf]/g, '\n')
            // Remaining CSI and short escape sequences are display controls.
            .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
            .replace(/\u001b[()][A-Z0-9]/g, '')
            .replace(/\r/g, '\n')
            .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f]/g, '');
    }

    private render(text: string, write: (text: string) => void, terminated: boolean): void {
        let cursor = 0;
        for (const match of text.matchAll(CLAUDE_SETUP_TOKEN_OUTPUT_TOKEN)) {
            this.renderOrdinaryText(text.slice(cursor, match.index), write);
            this.renderKnownToken(match[0], write);
            cursor = (match.index ?? 0) + match[0].length;
        }
        this.renderOrdinaryText(text.slice(cursor), write);

        if (terminated && !this.atLineStart) {
            write('\n');
            this.atLineStart = true;
        }
    }

    private renderOrdinaryText(text: string, write: (text: string) => void): void {
        const visible = text.trim();
        if (!visible) return;
        this.writeLine(visible, write);
    }

    private renderKnownToken(token: string, write: (text: string) => void): void {
        let key: string;
        let visible: string;
        let trailingNewline = true;

        if (token.includes('Welcome to Claude Code')) {
            key = 'welcome';
            visible = token.trim();
        } else if (token.includes('Opening browser to sign in')) {
            key = 'opening-browser';
            visible = token.trim().replace(/^[*·✢✶✻✽]\s*/, '');
        } else if (token.startsWith('Browser didn\'t open?')) {
            key = 'browser-instruction';
            visible = token.trim();
        } else if (token.startsWith('https://')) {
            key = `url:${token}`;
            visible = token;
        } else {
            key = 'paste-code-prompt';
            visible = token;
            trailingNewline = false;
        }

        if (this.seen.has(key)) return;
        this.seen.add(key);
        if (trailingNewline) this.writeLine(visible, write);
        else {
            if (!this.atLineStart) write('\n');
            write(visible);
            this.atLineStart = false;
        }
    }

    private writeLine(text: string, write: (text: string) => void): void {
        if (!this.atLineStart) write('\n');
        write(`${text}\n`);
        this.atLineStart = true;
    }
}

function codexAuthFile(tokens: Awaited<ReturnType<typeof authenticateCodex>>): string {
    return `${JSON.stringify({
        OPENAI_API_KEY: null,
        tokens: {
            id_token: tokens.id_token,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            account_id: tokens.account_id,
        },
        last_refresh: new Date().toISOString(),
    }, null, 2)}\n`;
}

async function createClaudeSetupToken(): Promise<string> {
    const configured = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
    if (configured) return configured;
    return new Promise((resolve, reject) => {
        const child = spawn('claude', ['setup-token'], {
            stdio: ['inherit', 'pipe', 'pipe'],
            windowsHide: true,
            env: process.env,
        });
        let output = '';
        const display = new ClaudeSetupTokenOutputMediator();
        let childError: Error | undefined;
        let exitCode: number | null | undefined;
        let settled = false;
        child.stdout?.on('data', (chunk: Buffer) => {
            output += chunk.toString('utf8');
            display.push('stdout', chunk);
        });
        child.stderr?.on('data', (chunk: Buffer) => {
            output += chunk.toString('utf8');
            display.push('stderr', chunk);
        });
        child.once('error', (error) => {
            childError = error;
        });
        child.once('exit', (code) => {
            exitCode = code;
        });
        child.once('close', (code) => {
            display.flush();
            if (settled) return;
            settled = true;
            if (childError) {
                reject(childError);
                return;
            }
            const finalExitCode = code ?? exitCode;
            if (finalExitCode !== 0) {
                reject(new Error(`claude setup-token exited with status ${finalExitCode ?? 'unknown'}`));
                return;
            }
            const plain = output.replace(/\u001b\[[0-9;]*m/g, '');
            const token = plain.match(/sk-ant-[A-Za-z0-9_-]+/)?.[0];
            if (!token) {
                reject(new Error('Claude did not return a setup token. Set CLAUDE_CODE_OAUTH_TOKEN and retry.'));
                return;
            }
            resolve(token);
        });
    });
}

type CredentialAccountInput = Omit<CredentialAccount, 'createdAt' | 'updatedAt' | 'limitedUntil'>;

async function retainCredentialAccount(
    account: CredentialAccountInput,
    paths?: CredentialPoolPaths,
): Promise<void> {
    if (paths) await upsertCredentialAccount(account, { paths });
    else await upsertCredentialAccount(account);
}

async function selectCredentialAccount(
    provider: CredentialProvider,
    name: string,
    paths?: CredentialPoolPaths,
): Promise<void> {
    if (paths) await useCredentialAccount(provider, name, paths);
    else await useCredentialAccount(provider, name);
}

function ensureOwnerOnlyAccountHome(home: string): void {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    chmodSync(dirname(dirname(home)), 0o700);
    chmodSync(dirname(home), 0o700);
    chmodSync(home, 0o700);
}

async function handleConnectNamedAccount(
    provider: CredentialProvider,
    name: string,
    dependencies: ConnectCommandDependencies,
): Promise<void> {
    console.log(chalk.bold(`\nConnecting ${provider} account "${name}"\n`));
    if (provider === 'claude') {
        const token = await createClaudeSetupToken();
        await retainCredentialAccount({
            provider,
            name,
            credential: { type: 'oauth-token', token },
        }, dependencies.credentialPoolPaths);
    } else if (provider === 'codex') {
        const authFile = accountAuthFile(provider, name, dependencies.credentialPoolPaths);
        const home = dirname(authFile);
        ensureOwnerOnlyAccountHome(home);
        const tokens = await authenticateCodex();
        writeFileSync(authFile, codexAuthFile(tokens), { encoding: 'utf8', mode: 0o600 });
        chmodSync(authFile, 0o600);
        await retainCredentialAccount({
            provider,
            name,
            credential: { type: 'auth-file', path: authFile },
        }, dependencies.credentialPoolPaths);
    } else {
        const home = accountHome(provider, name, dependencies.credentialPoolPaths);
        ensureOwnerOnlyAccountHome(home);
        const result = spawn.sync('grok', ['login'], {
            stdio: 'inherit',
            windowsHide: true,
            env: { ...process.env, GROK_HOME: home },
        });
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(`grok login exited with status ${result.status ?? 'unknown'}`);
        chmodSync(join(home, 'auth.json'), 0o600);
        await retainCredentialAccount({
            provider,
            name,
            credential: { type: 'auth-file', path: join(home, 'auth.json') },
        }, dependencies.credentialPoolPaths);
    }
    await selectCredentialAccount(provider, name, dependencies.credentialPoolPaths);
    console.log(chalk.green(`Connected and selected ${provider} account "${name}".`));
}

async function handleConnectVendor(vendor: 'codex' | 'claude' | 'gemini', displayName: string): Promise<void> {
    console.log(chalk.bold(`\n🔌 Connecting ${displayName} to Happy cloud\n`));

    // Check if authenticated
    const credentials = await readCredentials();
    if (!credentials) {
        console.log(chalk.yellow('⚠️  Not authenticated with Happy'));
        console.log(chalk.gray('  Please run "happy auth login" first'));
        process.exit(1);
    }

    // Create API client
    const api = await ApiClient.create(credentials);

    // Handle vendor authentication
    if (vendor === 'codex') {
        console.log('🚀 Registering Codex token with server');
        const codexAuthTokens = await authenticateCodex();
        await api.registerVendorToken('openai', { oauth: codexAuthTokens });
        console.log('✅ Codex token registered with server');
        process.exit(0);
    } else if (vendor === 'claude') {
        console.log('🚀 Registering Anthropic token with server');
        const anthropicAuthTokens = await authenticateClaude();
        await api.registerVendorToken('anthropic', { oauth: anthropicAuthTokens });
        console.log('✅ Anthropic token registered with server');
        process.exit(0);
    } else if (vendor === 'gemini') {
        console.log('🚀 Registering Gemini token with server');
        const geminiAuthTokens = await authenticateGemini();
        await api.registerVendorToken('gemini', { oauth: geminiAuthTokens });
        console.log('✅ Gemini token registered with server');
        
        // Also update local Gemini config to keep tokens in sync
        updateLocalGeminiCredentials(geminiAuthTokens);
        
        process.exit(0);
    } else {
        throw new Error(`Unsupported vendor: ${vendor}`);
    }
}

/**
 * Show connection status for all vendors
 */
async function handleConnectStatus(): Promise<void> {
    console.log(chalk.bold('\n🔌 Connection Status\n'));

    // Check if authenticated
    const credentials = await readCredentials();
    if (!credentials) {
        console.log(chalk.yellow('⚠️  Not authenticated with Happy'));
        console.log(chalk.gray('  Please run "happy auth login" first'));
        process.exit(1);
    }

    // Create API client
    const api = await ApiClient.create(credentials);

    // Check each vendor
    const vendors: Array<{ key: 'openai' | 'anthropic' | 'gemini'; name: string; display: string }> = [
        { key: 'gemini', name: 'Gemini', display: 'Google Gemini' },
        { key: 'openai', name: 'Codex', display: 'OpenAI Codex' },
        { key: 'anthropic', name: 'Claude', display: 'Anthropic Claude' },
    ];

    for (const vendor of vendors) {
        try {
            const token = await api.getVendorToken(vendor.key);
            
            if (token?.oauth) {
                // Try to extract user info from id_token (JWT)
                let userInfo = '';
                
                if (token.oauth.id_token) {
                    const payload = decodeJwtPayload(token.oauth.id_token);
                    if (payload?.email) {
                        userInfo = chalk.gray(` (${payload.email})`);
                    }
                }
                
                // Check if token might be expired
                const expiresAt = token.oauth.expires_at || (token.oauth.expires_in ? Date.now() + token.oauth.expires_in * 1000 : null);
                const isExpired = expiresAt && expiresAt < Date.now();
                
                if (isExpired) {
                    console.log(`  ${chalk.yellow('⚠️')}  ${vendor.display}: ${chalk.yellow('expired')}${userInfo}`);
                } else {
                    console.log(`  ${chalk.green('✓')}  ${vendor.display}: ${chalk.green('connected')}${userInfo}`);
                }
            } else {
                console.log(`  ${chalk.gray('○')}  ${vendor.display}: ${chalk.gray('not connected')}`);
            }
        } catch {
            console.log(`  ${chalk.gray('○')}  ${vendor.display}: ${chalk.gray('not connected')}`);
        }
    }

    console.log('');
    console.log(chalk.gray('To connect a vendor, run: happy connect <vendor>'));
    console.log(chalk.gray('Example: happy connect gemini'));
    console.log('');
}

/**
 * Update local Gemini credentials file to keep in sync with Happy cloud
 * This ensures the Gemini SDK uses the same account as Happy
 */
function updateLocalGeminiCredentials(tokens: {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
}): void {
    try {
        const geminiDir = join(homedir(), '.gemini');
        const credentialsPath = join(geminiDir, 'oauth_creds.json');
        
        // Create directory if it doesn't exist
        if (!existsSync(geminiDir)) {
            mkdirSync(geminiDir, { recursive: true });
        }
        
        // Write credentials in the format Gemini CLI expects
        const credentials = {
            access_token: tokens.access_token,
            token_type: tokens.token_type || 'Bearer',
            scope: tokens.scope || 'https://www.googleapis.com/auth/cloud-platform',
            ...(tokens.refresh_token && { refresh_token: tokens.refresh_token }),
            ...(tokens.id_token && { id_token: tokens.id_token }),
            ...(tokens.expires_in && { expires_in: tokens.expires_in }),
        };
        
        writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2), 'utf-8');
        console.log(chalk.gray(`  Updated local credentials: ${credentialsPath}`));
    } catch (error) {
        // Non-critical error - server tokens will still work
        console.log(chalk.yellow(`  ⚠️ Could not update local credentials: ${error}`));
    }
}
