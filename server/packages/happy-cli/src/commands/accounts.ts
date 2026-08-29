import chalk from 'chalk';

import {
  listCredentialAccounts,
  removeCredentialAccount,
  useCredentialAccount,
} from '@/credentialPool/store';
import { CredentialProviderSchema, type CredentialProvider } from '@/credentialPool/types';

function provider(value: string | undefined): CredentialProvider {
  const parsed = CredentialProviderSchema.safeParse(value?.toLowerCase());
  if (!parsed.success) throw new Error('Provider must be claude, codex, or grok.');
  return parsed.data;
}

function showHelp(): void {
  console.log(`
${chalk.bold('happyherd accounts')} - Manage named provider accounts

${chalk.bold('Usage:')}
  happyherd accounts list [claude|codex|grok] [--json]
  happyherd accounts use <nickname>
  happyherd accounts remove <nickname>

If a nickname is shared by multiple providers, disambiguate with:
  happyherd accounts use <provider> <nickname>
  happyherd accounts remove <provider> <nickname>
`);
}

async function accountTarget(args: string[]): Promise<{ provider: CredentialProvider; name: string }> {
  if (!args[1]) throw new Error('Account nickname is required.');
  const explicitProvider = CredentialProviderSchema.safeParse(args[1].toLowerCase());
  if (explicitProvider.success && args[2]) {
    return { provider: explicitProvider.data, name: args[2] };
  }

  const name = args[1];
  const { accounts } = await listCredentialAccounts();
  const matches = accounts.filter((account) => account.name === name);
  if (matches.length === 0) throw new Error(`No account named "${name}".`);
  if (matches.length > 1) {
    throw new Error(`Account nickname "${name}" matches multiple providers; specify the provider.`);
  }
  return { provider: matches[0].provider, name };
}

export async function handleAccountsCommand(args: string[]): Promise<void> {
  const action = args[0];
  if (!action || action === 'help' || action === '--help' || action === '-h') {
    showHelp();
    return;
  }

  if (action === 'list') {
    const json = args.includes('--json');
    const providerArg = args.slice(1).find((arg) => !arg.startsWith('-'));
    const selectedProvider = providerArg ? provider(providerArg) : undefined;
    const { state, accounts } = await listCredentialAccounts(selectedProvider);
    const rows = accounts.map((account) => ({
      provider: account.provider,
      name: account.name,
      current: state.current[account.provider] === account.name,
      limitedUntil: account.limitedUntil,
    }));
    if (json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    if (rows.length === 0) {
      console.log('No named provider accounts connected.');
      return;
    }
    for (const row of rows) {
      const current = row.current ? chalk.green(' current') : '';
      const limited = row.limitedUntil && row.limitedUntil > Date.now()
        ? chalk.yellow(` limited until ${new Date(row.limitedUntil).toISOString()}`)
        : '';
      console.log(`${row.provider}\t${row.name}${current}${limited}`);
    }
    return;
  }

  if (action === 'use') {
    const target = await accountTarget(args);
    const account = await useCredentialAccount(target.provider, target.name);
    console.log(`Using ${account.provider} account "${account.name}".`);
    return;
  }

  if (action === 'remove') {
    const target = await accountTarget(args);
    const account = await removeCredentialAccount(target.provider, target.name);
    console.log(`Removed ${account.provider} account "${account.name}".`);
    return;
  }

  throw new Error(`Unknown accounts action: ${action}`);
}
