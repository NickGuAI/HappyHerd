import type {
  CredentialAccountRenameRequest,
  CredentialAccountTarget,
  CredentialLoginFlow,
  CredentialLoginStartRequest,
  ManagedProviderAccountSummary,
} from '@slopus/happy-wire';

import {
  defaultCredentialPoolPaths,
  listCredentialAccounts,
  removeCredentialAccount,
  renameCredentialAccount,
  useCredentialAccount,
  type CredentialPoolPaths,
} from './store';
import { CredentialLoginManager } from './loginManager';

export class CredentialAccountManager {
  readonly login: CredentialLoginManager;
  private readonly paths: CredentialPoolPaths;
  private readonly isLegacyAccountInUse: (target: {
    provider: CredentialAccountTarget['provider'];
    name: string;
    id?: string;
  }) => boolean;

  constructor(options: {
    paths?: CredentialPoolPaths;
    login?: CredentialLoginManager;
    isLegacyAccountInUse?: (target: {
      provider: CredentialAccountTarget['provider'];
      name: string;
      id?: string;
    }) => boolean;
  } = {}) {
    this.paths = options.paths ?? defaultCredentialPoolPaths();
    this.login = options.login ?? new CredentialLoginManager({ paths: this.paths });
    this.isLegacyAccountInUse = options.isLegacyAccountInUse ?? (() => false);
  }

  async listAccounts(): Promise<ManagedProviderAccountSummary[]> {
    const { state, accounts } = await listCredentialAccounts(undefined, this.paths);
    const now = Date.now();
    return accounts.map((account) => ({
      id: account.id,
      provider: account.provider,
      name: account.name,
      status: account.limitedUntil !== null && account.limitedUntil > now ? 'limited' as const : 'stored' as const,
      current: state.current[account.provider] === account.name,
      limitedUntil: account.limitedUntil,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      credentialVersion: account.credentialVersion,
    }));
  }

  async use(target: CredentialAccountTarget): Promise<ManagedProviderAccountSummary[]> {
    return this.login.withTargetReservations([target], async () => {
      await useCredentialAccount(target.provider, target.name, this.paths, {
        id: target.id,
        credentialVersion: target.expectedCredentialVersion,
      });
      return this.listAccounts();
    });
  }

  async rename(request: CredentialAccountRenameRequest): Promise<ManagedProviderAccountSummary[]> {
    return this.login.withTargetReservations([
      { provider: request.provider, name: request.name },
      { provider: request.provider, name: request.newName },
    ], async () => {
      await this.assertMutationAllowed(request);
      await renameCredentialAccount(request.provider, request.name, request.newName, this.paths, {
        id: request.id,
        credentialVersion: request.expectedCredentialVersion,
      });
      return this.listAccounts();
    });
  }

  async remove(target: CredentialAccountTarget): Promise<ManagedProviderAccountSummary[]> {
    return this.login.withTargetReservations([target], async () => {
      await this.assertMutationAllowed(target);
      await removeCredentialAccount(target.provider, target.name, this.paths, {
        id: target.id,
        credentialVersion: target.expectedCredentialVersion,
      });
      return this.listAccounts();
    });
  }

  async startLogin(target: CredentialLoginStartRequest): Promise<CredentialLoginFlow> {
    await this.assertMutationAllowed(target);
    return this.login.start(target.provider, target.name, target.id ? {
      type: 'existing',
      id: target.id,
      credentialVersion: target.expectedCredentialVersion!,
    } : { type: 'new' });
  }

  async assertMutationAllowed(target: CredentialLoginStartRequest): Promise<void> {
    const { accounts } = await listCredentialAccounts(target.provider, this.paths);
    const account = target.id
      ? accounts.find((candidate) => candidate.id === target.id)
      : accounts.find((candidate) => candidate.name === target.name);
    if (target.id && (
      !account
      || account.name !== target.name
      || account.credentialVersion !== target.expectedCredentialVersion
    )) {
      throw new Error('This provider account changed. Refresh accounts and retry.');
    }
    if (!target.id && account) {
      throw new Error(`A ${target.provider} account named "${target.name}" already exists. Refresh accounts and retry.`);
    }
    if (this.isLegacyAccountInUse({
      provider: target.provider,
      name: target.name,
      ...(account ? { id: account.id } : {}),
    })) {
      throw new Error(
        'This account is used by a session started before credential management was installed. Finish that session before changing the account.',
      );
    }
  }

  async assertNamedMutationAllowed(target: {
    provider: CredentialAccountTarget['provider'];
    name: string;
  }): Promise<void> {
    const { accounts } = await listCredentialAccounts(target.provider, this.paths);
    const account = accounts.find((candidate) => candidate.name === target.name);
    if (this.isLegacyAccountInUse({
      provider: target.provider,
      name: target.name,
      ...(account ? { id: account.id } : {}),
    })) {
      throw new Error(
        'This account is used by a session started before credential management was installed. Finish that session before changing the account.',
      );
    }
  }

  async dispose(): Promise<void> {
    await this.login.dispose();
  }

}
