import chalk from 'chalk';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
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
    const index = args.indexOf('--acct');
    if (index < 0) return {};
    const value = args[index + 1];
    if (!value || value.startsWith('-')) throw new Error('Missing nickname after --acct.');
    return { name: validateAccountName(value) };
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
        child.stdout?.on('data', (chunk: Buffer) => {
            output += chunk.toString('utf8');
            process.stdout.write(chunk);
        });
        child.stderr?.on('data', (chunk: Buffer) => {
            output += chunk.toString('utf8');
            process.stderr.write(chunk);
        });
        child.once('error', reject);
        child.once('exit', (code) => {
            if (code !== 0) {
                reject(new Error(`claude setup-token exited with status ${code ?? 'unknown'}`));
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
