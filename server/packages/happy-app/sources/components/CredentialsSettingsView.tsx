import { Ionicons } from '@expo/vector-icons';
import type {
    CredentialLoginFlow,
    ManagedCredentialProvider,
    ManagedCredentialType,
    ManagedCredentialUsage,
    ManagedProviderAccountSummary,
    SavedCredentialSummary,
    SavedCredentialUpsertRequest,
} from '@slopus/happy-wire';
import * as React from 'react';
import {
    ActivityIndicator,
    Platform,
    Pressable,
    TextInput,
    View,
} from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { useAuth } from '@/auth/AuthContext';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { layout } from '@/components/layout';
import { ProviderIcon } from '@/components/ProviderIcon';
import { Text } from '@/components/StyledText';
import { Modal } from '@/modal';
import {
    CredentialApiError,
    deleteSavedCredential,
    listSavedCredentials,
    revealSavedCredential,
    saveCredential,
} from '@/sync/apiCredentials';
import {
    cancelManagedCredentialLogin,
    getManagedCredentialLogin,
    listManagedCredentialAccounts,
    removeManagedCredentialAccount,
    renameManagedCredentialAccount,
    startManagedCredentialLogin,
    submitManagedCredentialLoginCode,
    useManagedCredentialAccount,
} from '@/sync/credentialOps';
import { useAllMachines } from '@/sync/storage';
import type { Machine } from '@/sync/storageTypes';
import { t } from '@/text';
import { openExternalUrl } from '@/utils/openExternalUrl';
import { isMachineOnline } from '@/utils/machineUtils';
import { getMachineName } from '@/sync/machineChoices';
import { formatLastSeen } from '@/utils/sessionUtils';

const providers: ManagedCredentialProvider[] = ['claude', 'codex', 'grok'];
const credentialTypes: ManagedCredentialType[] = ['login', 'token', 'connection'];
const usages: ManagedCredentialUsage[] = ['skills', 'browser', 'mcp'];

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type CredentialDraft = {
    id?: string;
    version?: number;
    name: string;
    type: ManagedCredentialType;
    service: string;
    username: string;
    secret: string;
    usage: ManagedCredentialUsage[];
};

const emptyDraft = (): CredentialDraft => ({
    name: '',
    type: 'token',
    service: '',
    username: '',
    secret: '',
    usage: ['skills'],
});

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

function providerName(provider: ManagedCredentialProvider): string {
    if (provider === 'claude') return 'Claude';
    if (provider === 'codex') return 'Codex';
    return 'Grok';
}

function credentialTypeLabel(type: ManagedCredentialType): string {
    if (type === 'login') return t('settingsCredentials.typeLogin');
    if (type === 'connection') return t('settingsCredentials.typeConnection');
    return t('settingsCredentials.typeToken');
}

function usageLabel(usage: ManagedCredentialUsage): string {
    if (usage === 'browser') return t('settingsCredentials.usageBrowser');
    if (usage === 'mcp') return t('settingsCredentials.usageMcp');
    return t('settingsCredentials.usageSkills');
}

function sortedMachines(machines: Machine[]): Machine[] {
    return [...machines].sort((left, right) => (
        Number(isMachineOnline(right)) - Number(isMachineOnline(left))
        || (right.activeAt ?? 0) - (left.activeAt ?? 0)
        || left.id.localeCompare(right.id)
    ));
}

function ActionButton({
    label,
    onPress,
    disabled,
    destructive,
    selected,
}: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    destructive?: boolean;
    selected?: boolean;
}) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: Boolean(disabled), selected: Boolean(selected) }}
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => ({
                minHeight: 44,
                minWidth: 44,
                paddingHorizontal: 14,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: selected ? theme.colors.header.tint : theme.colors.divider,
                backgroundColor: pressed ? theme.colors.surfacePressedOverlay : theme.colors.surface,
                justifyContent: 'center',
                alignItems: 'center',
                opacity: disabled ? 0.5 : 1,
            })}
        >
            <Text style={{
                color: destructive ? theme.colors.textDestructive : theme.colors.text,
                fontSize: 16,
                fontWeight: selected ? '600' : '500',
            }}>
                {label}
            </Text>
        </Pressable>
    );
}

function ButtonRow({ children }: { children: React.ReactNode }) {
    return (
        <View style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            paddingTop: 4,
        }}>
            {children}
        </View>
    );
}

function FormField({
    label,
    value,
    onChangeText,
    placeholder,
    secureTextEntry,
    autoCapitalize = 'none',
    editable = true,
}: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    placeholder?: string;
    secureTextEntry?: boolean;
    autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
    editable?: boolean;
}) {
    const { theme } = useUnistyles();
    return (
        <View style={{ gap: 6 }}>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>{label}</Text>
            <TextInput
                accessibilityLabel={label}
                accessibilityState={{ disabled: !editable }}
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder}
                placeholderTextColor={theme.colors.textSecondary}
                secureTextEntry={secureTextEntry}
                autoCapitalize={autoCapitalize}
                autoCorrect={false}
                editable={editable}
                style={{
                    width: '100%',
                    minWidth: 0,
                    minHeight: 44,
                    borderWidth: 1,
                    borderColor: theme.colors.divider,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    fontSize: 16,
                    color: theme.colors.text,
                    backgroundColor: theme.colors.groupped.background,
                }}
            />
        </View>
    );
}

function InlinePanel({ children }: { children: React.ReactNode }) {
    const { theme } = useUnistyles();
    return (
        <View style={{
            padding: 16,
            gap: 12,
            borderBottomWidth: Platform.OS === 'web' ? 1 : 0.5,
            borderBottomColor: theme.colors.divider,
        }}>
            {children}
        </View>
    );
}

export const CredentialsSettingsView = React.memo(function CredentialsSettingsView() {
    const { theme } = useUnistyles();
    const auth = useAuth();
    const machines = useAllMachines({ includeOffline: true });
    const orderedMachines = React.useMemo(() => sortedMachines(machines), [machines]);
    const [machineId, setMachineId] = React.useState<string | null>(null);
    const [machinePickerExpanded, setMachinePickerExpanded] = React.useState(false);
    const selectedMachine = machines.find((machine) => machine.id === machineId) ?? null;
    const selectedMachineId = selectedMachine?.id ?? null;
    const machineOnline = Boolean(selectedMachine && isMachineOnline(selectedMachine));
    const machineSupported = (selectedMachine?.metadata?.credentialManagementProtocolVersion ?? 0) >= 1;

    const [accounts, setAccounts] = React.useState<ManagedProviderAccountSummary[]>([]);
    const [accountLoadState, setAccountLoadState] = React.useState<LoadState>('idle');
    const [accountError, setAccountError] = React.useState<string | null>(null);
    const [accountRowError, setAccountRowError] = React.useState<{
        id: string;
        message: string;
        canReload: boolean;
    } | null>(null);
    const [expandedAccount, setExpandedAccount] = React.useState<string | null>(null);
    const [accountBusy, setAccountBusy] = React.useState<string | null>(null);
    const [renameValue, setRenameValue] = React.useState('');
    const [renamingAccount, setRenamingAccount] = React.useState<string | null>(null);
    const [addingAccount, setAddingAccount] = React.useState(false);
    const [newProvider, setNewProvider] = React.useState<ManagedCredentialProvider>('claude');
    const [newAccountName, setNewAccountName] = React.useState('');
    const [login, setLogin] = React.useState<CredentialLoginFlow | null>(null);
    const [loginMachineId, setLoginMachineId] = React.useState<string | null>(null);
    const [loginAccountIdentity, setLoginAccountIdentity] = React.useState<{
        id: string;
        credentialVersion: number;
    } | null>(null);
    const [loginCode, setLoginCode] = React.useState('');
    const [loginPollError, setLoginPollError] = React.useState<string | null>(null);

    const [credentials, setCredentials] = React.useState<SavedCredentialSummary[]>([]);
    const [credentialLoadState, setCredentialLoadState] = React.useState<LoadState>('loading');
    const [credentialError, setCredentialError] = React.useState<string | null>(null);
    const [credentialDraft, setCredentialDraft] = React.useState<CredentialDraft | null>(null);
    const [credentialBusy, setCredentialBusy] = React.useState(false);
    const [credentialConflict, setCredentialConflict] = React.useState(false);
    const [revealBusyId, setRevealBusyId] = React.useState<string | null>(null);
    const [expandedCredential, setExpandedCredential] = React.useState<string | null>(null);
    const [revealedSecret, setRevealedSecret] = React.useState<{ id: string; value: string } | null>(null);
    const [credentialRowError, setCredentialRowError] = React.useState<{ id: string; message: string } | null>(null);

    const accountGeneration = React.useRef(0);
    const accountBusyGeneration = React.useRef(0);
    const credentialGeneration = React.useRef(0);
    const credentialMutationGeneration = React.useRef(0);
    const loginGeneration = React.useRef(0);
    const revealGeneration = React.useRef(0);
    const activeLogin = React.useRef<{ machineId: string; flow: CredentialLoginFlow } | null>(null);
    const selectedMachineIdRef = React.useRef<string | null>(selectedMachineId);
    selectedMachineIdRef.current = selectedMachineId;

    React.useEffect(() => {
        activeLogin.current = login && loginMachineId ? { machineId: loginMachineId, flow: login } : null;
    }, [login, loginMachineId]);

    const cancelActiveLoginBestEffort = React.useCallback(() => {
        loginGeneration.current += 1;
        const active = activeLogin.current;
        activeLogin.current = null;
        if (active && ['starting', 'waiting-user'].includes(active.flow.state)) {
            void cancelManagedCredentialLogin(active.machineId, active.flow.id).catch(() => {});
        }
    }, []);

    const chooseMachine = React.useCallback((nextId: string | null) => {
        if (nextId === selectedMachineIdRef.current) {
            setMachinePickerExpanded(false);
            return;
        }
        cancelActiveLoginBestEffort();
        accountGeneration.current += 1;
        accountBusyGeneration.current += 1;
        setMachineId(nextId);
        setMachinePickerExpanded(false);
        setAccounts([]);
        setAccountLoadState('loading');
        setExpandedAccount(null);
        setRenamingAccount(null);
        setAddingAccount(false);
        setAccountBusy(null);
        setAccountError(null);
        setAccountRowError(null);
        setLogin(null);
        setLoginMachineId(null);
        setLoginAccountIdentity(null);
        setLoginCode('');
        setLoginPollError(null);
        revealGeneration.current += 1;
        setRevealBusyId(null);
        setRevealedSecret(null);
        setCredentialRowError(null);
        setExpandedCredential(null);
    }, [cancelActiveLoginBestEffort]);

    React.useEffect(() => {
        if (machineId && machines.some((machine) => machine.id === machineId)) return;
        const fallbackId = orderedMachines[0]?.id ?? null;
        if (fallbackId === machineId) return;
        chooseMachine(fallbackId);
    }, [chooseMachine, machineId, machines, orderedMachines]);

    const loadAccounts = React.useCallback(async () => {
        const targetMachineId = selectedMachineId;
        const generation = ++accountGeneration.current;
        setAccountError(null);
        setAccountRowError(null);
        if (!targetMachineId || !machineOnline || !machineSupported) {
            accountBusyGeneration.current += 1;
            setAccountBusy(null);
            setAccounts([]);
            setAccountLoadState('ready');
            return;
        }
        setAccountLoadState('loading');
        try {
            const next = await listManagedCredentialAccounts(targetMachineId);
            if (generation !== accountGeneration.current) return;
            setAccounts(next);
            setAccountLoadState('ready');
        } catch (error) {
            if (generation !== accountGeneration.current) return;
            setAccountError(errorMessage(error, t('settingsCredentials.loadFailed')));
            setAccountLoadState('error');
        }
    }, [machineOnline, machineSupported, selectedMachineId]);

    React.useEffect(() => {
        void loadAccounts();
    }, [loadAccounts]);

    const loadCredentials = React.useCallback(async () => {
        const generation = ++credentialGeneration.current;
        setCredentialError(null);
        if (!auth.credentials) {
            setCredentialLoadState('error');
            setCredentialError(t('settingsCredentials.loadFailed'));
            return;
        }
        setCredentialLoadState('loading');
        try {
            const next = await listSavedCredentials(auth.credentials);
            if (generation !== credentialGeneration.current) return;
            setCredentials(next);
            setCredentialLoadState('ready');
        } catch (error) {
            if (generation !== credentialGeneration.current) return;
            setCredentialError(errorMessage(error, t('settingsCredentials.loadFailed')));
            setCredentialLoadState('error');
        }
    }, [auth.credentials]);

    React.useEffect(() => {
        void loadCredentials();
        return () => {
            cancelActiveLoginBestEffort();
            accountGeneration.current += 1;
            accountBusyGeneration.current += 1;
            credentialGeneration.current += 1;
            credentialMutationGeneration.current += 1;
            loginGeneration.current += 1;
            revealGeneration.current += 1;
        };
    }, [cancelActiveLoginBestEffort, loadCredentials]);

    React.useEffect(() => {
        if (!login || !loginMachineId || !['starting', 'waiting-user'].includes(login.state)) return;
        const generation = loginGeneration.current;
        const timer = setTimeout(async () => {
            try {
                const next = await getManagedCredentialLogin(loginMachineId, login.id);
                if (generation !== loginGeneration.current) return;
                setLoginPollError(null);
                setLogin(next);
                if (next.state === 'succeeded') {
                    setAddingAccount(false);
                    setLoginCode('');
                    await loadAccounts();
                }
            } catch (error) {
                if (generation !== loginGeneration.current) return;
                setLoginPollError(errorMessage(error, t('settingsCredentials.loginFailed')));
                setLogin((current) => current ? { ...current } : current);
            }
        }, 1_500);
        return () => clearTimeout(timer);
    }, [login, loginMachineId, loadAccounts]);

    const applyAccountMutation = React.useCallback(async (
        key: string,
        operation: () => Promise<ManagedProviderAccountSummary[]>,
        onSuccess?: () => void,
    ) => {
        const targetMachineId = selectedMachineIdRef.current;
        const generation = ++accountGeneration.current;
        const busyGeneration = ++accountBusyGeneration.current;
        setAccountBusy(key);
        setAccountError(null);
        setAccountRowError(null);
        try {
            const next = await operation();
            if (generation !== accountGeneration.current || selectedMachineIdRef.current !== targetMachineId) return;
            setAccounts(next);
            onSuccess?.();
        } catch (error) {
            if (generation !== accountGeneration.current || selectedMachineIdRef.current !== targetMachineId) return;
            setAccountRowError({
                id: key,
                message: errorMessage(error, t('settingsCredentials.saveFailed')),
                canReload: true,
            });
        } finally {
            if (
                busyGeneration === accountBusyGeneration.current
                && selectedMachineIdRef.current === targetMachineId
            ) {
                setAccountBusy(null);
            }
        }
    }, []);

    const beginLogin = React.useCallback(async (
        provider: ManagedCredentialProvider,
        name: string,
        account?: Pick<ManagedProviderAccountSummary, 'id' | 'credentialVersion'> | null,
    ) => {
        if (!selectedMachine || !name.trim()) return;
        cancelActiveLoginBestEffort();
        setLogin(null);
        setLoginMachineId(null);
        setLoginCode('');
        setLoginAccountIdentity(account ? {
            id: account.id,
            credentialVersion: account.credentialVersion,
        } : null);
        setLoginPollError(null);
        const targetMachine = selectedMachine;
        const generation = loginGeneration.current;
        const busyGeneration = ++accountBusyGeneration.current;
        setAccountBusy(`login:${provider}:${name}`);
        setAccountError(null);
        setAccountRowError(null);
        try {
            const flow = await startManagedCredentialLogin(targetMachine.id, {
                provider,
                name: name.trim(),
                ...(account ? {
                    id: account.id,
                    expectedCredentialVersion: account.credentialVersion,
                } : {}),
            });
            if (generation !== loginGeneration.current || selectedMachineIdRef.current !== targetMachine.id) {
                void cancelManagedCredentialLogin(targetMachine.id, flow.id).catch(() => {});
                return;
            }
            activeLogin.current = { machineId: targetMachine.id, flow };
            setLoginPollError(null);
            setLogin(flow);
            setLoginMachineId(targetMachine.id);
        } catch (error) {
            if (generation !== loginGeneration.current || selectedMachineIdRef.current !== targetMachine.id) return;
            const message = errorMessage(error, t('settingsCredentials.loginFailed'));
            if (account) {
                setAccountRowError({ id: account.id, message, canReload: true });
            } else {
                setAccountError(message);
            }
        } finally {
            if (
                busyGeneration === accountBusyGeneration.current
                && selectedMachineIdRef.current === targetMachine.id
            ) {
                setAccountBusy(null);
            }
        }
    }, [cancelActiveLoginBestEffort, selectedMachine]);

    const cancelLogin = React.useCallback(async () => {
        if (!login || !loginMachineId) return;
        const generation = ++loginGeneration.current;
        const targetMachineId = loginMachineId;
        setAccountError(null);
        setLoginCode('');
        try {
            const next = await cancelManagedCredentialLogin(targetMachineId, login.id);
            if (generation !== loginGeneration.current || selectedMachineIdRef.current !== targetMachineId) return;
            activeLogin.current = { machineId: targetMachineId, flow: next };
            setLoginPollError(null);
            setLogin(next);
        } catch (error) {
            if (generation !== loginGeneration.current || selectedMachineIdRef.current !== targetMachineId) return;
            setAccountError(errorMessage(error, t('settingsCredentials.loginFailed')));
        }
    }, [login, loginMachineId]);

    const submitLoginCode = React.useCallback(async () => {
        if (!login || !loginMachineId || !loginCode.trim()) return;
        const generation = loginGeneration.current;
        const busyGeneration = ++accountBusyGeneration.current;
        const targetMachineId = loginMachineId;
        setAccountBusy(`auth:${login.id}`);
        setAccountError(null);
        try {
            const next = await submitManagedCredentialLoginCode(targetMachineId, login.id, loginCode.trim());
            if (generation !== loginGeneration.current || selectedMachineIdRef.current !== targetMachineId) return;
            activeLogin.current = { machineId: targetMachineId, flow: next };
            setLoginPollError(null);
            setLogin(next);
            setLoginCode('');
        } catch (error) {
            if (generation !== loginGeneration.current || selectedMachineIdRef.current !== targetMachineId) return;
            setAccountError(errorMessage(error, t('settingsCredentials.loginFailed')));
        } finally {
            if (
                busyGeneration === accountBusyGeneration.current
                && selectedMachineIdRef.current === targetMachineId
            ) {
                setAccountBusy(null);
            }
        }
    }, [login, loginCode, loginMachineId]);

    const beginEditCredential = React.useCallback((credential: SavedCredentialSummary) => {
        credentialMutationGeneration.current += 1;
        revealGeneration.current += 1;
        setRevealBusyId(null);
        setRevealedSecret(null);
        setCredentialRowError(null);
        setCredentialConflict(false);
        setCredentialError(null);
        setCredentialDraft({
            id: credential.id,
            version: credential.version,
            name: credential.name,
            type: credential.type,
            service: credential.service,
            username: credential.username ?? '',
            secret: '',
            usage: credential.usage,
        });
    }, []);

    const persistCredential = React.useCallback(async () => {
        if (!credentialDraft || !auth.credentials) return;
        const name = credentialDraft.name.trim();
        if (!name || (!credentialDraft.id && !credentialDraft.secret)) {
            setCredentialError(t('settingsCredentials.required'));
            return;
        }
        const request: SavedCredentialUpsertRequest = credentialDraft.id
            ? {
                id: credentialDraft.id,
                expectedVersion: credentialDraft.version ?? 0,
                name,
                type: credentialDraft.type,
                service: credentialDraft.service.trim(),
                username: credentialDraft.username.trim() || null,
                usage: credentialDraft.usage,
                ...(credentialDraft.secret ? { secret: credentialDraft.secret } : {}),
            }
            : {
                name,
                type: credentialDraft.type,
                service: credentialDraft.service.trim(),
                username: credentialDraft.username.trim() || null,
                usage: credentialDraft.usage,
                secret: credentialDraft.secret,
            };
        const generation = ++credentialMutationGeneration.current;
        setCredentialBusy(true);
        setCredentialConflict(false);
        setCredentialError(null);
        setCredentialRowError(null);
        try {
            await saveCredential(auth.credentials, request);
            if (generation !== credentialMutationGeneration.current) return;
            setCredentialDraft(null);
            await loadCredentials();
        } catch (error) {
            if (generation !== credentialMutationGeneration.current) return;
            if (
                error instanceof CredentialApiError
                && error.code === 'saved-credential-version-conflict'
            ) {
                setCredentialConflict(true);
                setCredentialError(t('settingsCredentials.credentialChanged'));
            } else {
                setCredentialError(errorMessage(error, t('settingsCredentials.saveFailed')));
            }
        } finally {
            if (generation === credentialMutationGeneration.current) setCredentialBusy(false);
        }
    }, [auth.credentials, credentialDraft, loadCredentials]);

    const removeCredential = React.useCallback(async (credential: SavedCredentialSummary) => {
        if (!auth.credentials) return;
        const confirmed = await Modal.confirm(
            t('settingsCredentials.deleteCredentialTitle'),
            t('settingsCredentials.deleteCredentialMessage', { name: credential.name }),
            { confirmText: t('settingsCredentials.deleteCredential'), destructive: true },
        );
        if (!confirmed) return;
        const generation = ++credentialMutationGeneration.current;
        setCredentialBusy(true);
        setCredentialConflict(false);
        setCredentialError(null);
        setCredentialRowError(null);
        try {
            await deleteSavedCredential(auth.credentials, credential.id);
            if (generation !== credentialMutationGeneration.current) return;
            if (expandedCredential === credential.id) setExpandedCredential(null);
            if (revealedSecret?.id === credential.id) setRevealedSecret(null);
            setCredentialRowError(null);
            await loadCredentials();
        } catch (error) {
            if (generation === credentialMutationGeneration.current) {
                setCredentialRowError({
                    id: credential.id,
                    message: errorMessage(error, t('settingsCredentials.saveFailed')),
                });
            }
        } finally {
            if (generation === credentialMutationGeneration.current) setCredentialBusy(false);
        }
    }, [auth.credentials, expandedCredential, loadCredentials, revealedSecret]);

    const reloadAfterCredentialConflict = React.useCallback(async () => {
        credentialMutationGeneration.current += 1;
        revealGeneration.current += 1;
        setCredentialBusy(false);
        setCredentialConflict(false);
        setCredentialError(null);
        setCredentialDraft(null);
        setRevealBusyId(null);
        setRevealedSecret(null);
        setCredentialRowError(null);
        setExpandedCredential(null);
        await loadCredentials();
    }, [loadCredentials]);

    const toggleReveal = React.useCallback(async (credential: SavedCredentialSummary) => {
        if (revealedSecret?.id === credential.id) {
            revealGeneration.current += 1;
            setRevealBusyId(null);
            setRevealedSecret(null);
            return;
        }
        if (!auth.credentials) return;
        const generation = ++revealGeneration.current;
        setRevealBusyId(credential.id);
        setCredentialRowError(null);
        try {
            const result = await revealSavedCredential(auth.credentials, credential.id);
            if (generation === revealGeneration.current) {
                setRevealedSecret({ id: result.id, value: result.secret });
                setCredentialRowError(null);
            }
        } catch (error) {
            if (generation === revealGeneration.current) {
                setCredentialRowError({
                    id: credential.id,
                    message: errorMessage(error, t('settingsCredentials.loadFailed')),
                });
            }
        } finally {
            if (generation === revealGeneration.current) setRevealBusyId(null);
        }
    }, [auth.credentials, revealedSecret]);

    const machineSubtitle = selectedMachine
        ? `${selectedMachine.id} · ${machineOnline
            ? t('status.online')
            : t('status.lastSeen', { time: formatLastSeen(selectedMachine.activeAt, false) })}`
        : t('settingsCredentials.noMachines');
    const accountActionsDisabled = Boolean(accountBusy) || Boolean(
        login && ['starting', 'waiting-user'].includes(login.state),
    );
    const credentialInteractionDisabled = credentialBusy || credentialConflict;

    return (
        <ItemList
            style={{ paddingTop: 0 }}
            containerStyle={{ paddingBottom: 32 }}
            keyboardShouldPersistTaps="handled"
        >
            <ItemGroup title={t('settingsCredentials.machine')} footer={t('settingsCredentials.machineScope')}>
                <Item
                    title={selectedMachine ? getMachineName(selectedMachine) : t('settingsCredentials.selectMachine')}
                    subtitle={machineSubtitle}
                    subtitleLines={0}
                    icon={<Ionicons name="desktop-outline" size={29} color="#5856D6" />}
                    onPress={orderedMachines.length ? () => setMachinePickerExpanded((value) => !value) : undefined}
                    showChevron={orderedMachines.length > 0}
                    accessibilityRole={orderedMachines.length ? 'button' : undefined}
                    accessibilityState={orderedMachines.length ? { expanded: machinePickerExpanded } : undefined}
                />
                {machinePickerExpanded && orderedMachines.map((machine) => (
                    <Item
                        key={machine.id}
                        title={getMachineName(machine)}
                        subtitle={`${machine.id} · ${isMachineOnline(machine)
                            ? t('status.online')
                            : t('status.lastSeen', { time: formatLastSeen(machine.activeAt, false) })}`}
                        subtitleLines={0}
                        onPress={() => chooseMachine(machine.id)}
                        showChevron={false}
                        accessibilityRole="button"
                        accessibilityState={{ selected: machine.id === machineId }}
                        rightElement={machine.id === machineId
                            ? <Ionicons name="checkmark" size={20} color={theme.colors.header.tint} />
                            : undefined}
                    />
                ))}
            </ItemGroup>

            <ItemGroup title={t('settingsCredentials.providerAccounts')} footer={t('settingsCredentials.accountHelp')}>
                {!selectedMachine ? (
                    <Item title={t('settingsCredentials.noMachines')} showChevron={false} />
                ) : !machineOnline ? (
                    <Item title={t('settingsCredentials.machineOffline')} showChevron={false} />
                ) : !machineSupported ? (
                    <Item title={t('settingsCredentials.machineUnsupported')} showChevron={false} />
                ) : (
                    <>
                        <Item
                            title={t('settingsCredentials.addAccount')}
                            icon={<Ionicons name="add-circle-outline" size={29} color="#34C759" />}
                            onPress={() => {
                                cancelActiveLoginBestEffort();
                                setAccountError(null);
                                setAccountRowError(null);
                                setAddingAccount((value) => !value);
                                setLogin(null);
                                setNewAccountName('');
                            }}
                            showChevron={false}
                            accessibilityRole="button"
                            accessibilityState={{ expanded: addingAccount }}
                        />
                        {addingAccount && (
                            <InlinePanel>
                                <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>
                                    {t('settingsCredentials.provider')}
                                </Text>
                                <ButtonRow>
                                    {providers.map((provider) => (
                                        <ActionButton
                                            key={provider}
                                            label={providerName(provider)}
                                            selected={newProvider === provider}
                                            onPress={() => setNewProvider(provider)}
                                        />
                                    ))}
                                </ButtonRow>
                                <FormField
                                    label={t('settingsCredentials.accountNickname')}
                                    value={newAccountName}
                                    onChangeText={setNewAccountName}
                                    placeholder={t('settingsCredentials.accountNicknamePlaceholder')}
                                />
                                {!login && (
                                    <ButtonRow>
                                        <ActionButton
                                            label={t('settingsCredentials.login')}
                                            disabled={!newAccountName.trim() || Boolean(accountBusy)}
                                            onPress={() => void beginLogin(newProvider, newAccountName)}
                                        />
                                        <ActionButton
                                            label={t('settingsCredentials.cancel')}
                                            onPress={() => {
                                                cancelActiveLoginBestEffort();
                                                setAccountError(null);
                                                setAccountRowError(null);
                                                setAddingAccount(false);
                                                setLogin(null);
                                                setNewAccountName('');
                                            }}
                                        />
                                    </ButtonRow>
                                )}
                            </InlinePanel>
                        )}
                        {accountError && accountLoadState !== 'error' && !login && (
                            <Item title={accountError} showChevron={false} destructive />
                        )}

                        {accountLoadState === 'loading' && (
                            <Item title={t('settingsCredentials.loading')} leftElement={<ActivityIndicator />} showChevron={false} />
                        )}
                        {accountLoadState === 'error' && (
                            <Item
                                title={accountError ?? t('settingsCredentials.loadFailed')}
                                detail={t('settingsCredentials.retry')}
                                onPress={() => void loadAccounts()}
                                showChevron={false}
                                destructive
                                accessibilityRole="button"
                            />
                        )}
                        {accountLoadState === 'ready' && accounts.length === 0 && !addingAccount && (
                            <Item title={t('settingsCredentials.emptyAccounts')} showChevron={false} />
                        )}
                        {accounts.map((account) => {
                            const key = account.id;
                            const expanded = expandedAccount === key;
                            const status = account.status === 'limited' && account.limitedUntil
                                ? t('settingsCredentials.limitedUntil', { time: new Date(account.limitedUntil).toLocaleString() })
                                : t('settingsCredentials.stored');
                            return (
                                <React.Fragment key={key}>
                                    <Item
                                        title={account.name}
                                        subtitle={`${providerName(account.provider)} · ${status}`}
                                        detail={account.current ? t('settingsCredentials.default') : undefined}
                                        icon={<ProviderIcon kind={account.provider} size={29} />}
                                        loading={accountBusy === key}
                                        onPress={() => {
                                            setExpandedAccount(expanded ? null : key);
                                            setRenamingAccount(null);
                                            setRenameValue(account.name);
                                            setAccountRowError((current) => current?.id === key ? current : null);
                                        }}
                                        accessibilityRole="button"
                                        accessibilityState={{ expanded, selected: account.current }}
                                    />
                                    {expanded && (
                                        <InlinePanel>
                                            {renamingAccount === key ? (
                                                <>
                                                    <FormField
                                                        label={t('settingsCredentials.accountNickname')}
                                                        value={renameValue}
                                                        onChangeText={setRenameValue}
                                                    />
                                                    <ButtonRow>
                                                        <ActionButton
                                                            label={t('settingsCredentials.save')}
                                                            disabled={!renameValue.trim() || accountActionsDisabled}
                                                            onPress={() => void applyAccountMutation(key, () => (
                                                                renameManagedCredentialAccount(selectedMachine.id, {
                                                                    id: account.id,
                                                                    provider: account.provider,
                                                                    name: account.name,
                                                                    expectedCredentialVersion: account.credentialVersion,
                                                                    newName: renameValue.trim(),
                                                                })
                                                            ), () => {
                                                                setRenamingAccount(null);
                                                                setExpandedAccount(account.id);
                                                            })}
                                                        />
                                                        <ActionButton label={t('settingsCredentials.cancel')} onPress={() => setRenamingAccount(null)} />
                                                    </ButtonRow>
                                                </>
                                            ) : (
                                                <ButtonRow>
                                                    {!account.current && (
                                                        <ActionButton
                                                            label={t('settingsCredentials.setDefault')}
                                                            disabled={accountActionsDisabled}
                                                            onPress={() => void applyAccountMutation(key, () => (
                                                                useManagedCredentialAccount(selectedMachine.id, {
                                                                    id: account.id,
                                                                    provider: account.provider,
                                                                    name: account.name,
                                                                    expectedCredentialVersion: account.credentialVersion,
                                                                })
                                                            ))}
                                                        />
                                                    )}
                                                    <ActionButton
                                                        label={t('settingsCredentials.rename')}
                                                        disabled={accountActionsDisabled}
                                                        onPress={() => setRenamingAccount(key)}
                                                    />
                                                    <ActionButton
                                                        label={t('settingsCredentials.relogin')}
                                                        disabled={accountActionsDisabled}
                                                        onPress={() => void beginLogin(account.provider, account.name, account)}
                                                    />
                                                    <ActionButton
                                                        label={t('settingsCredentials.removeLocal')}
                                                        destructive
                                                        disabled={accountActionsDisabled}
                                                        onPress={() => void (async () => {
                                                            const confirmed = await Modal.confirm(
                                                                t('settingsCredentials.removeLocalTitle'),
                                                                t('settingsCredentials.removeLocalMessage', {
                                                                    name: account.name,
                                                                    provider: providerName(account.provider),
                                                                }),
                                                                { confirmText: t('settingsCredentials.removeLocal'), destructive: true },
                                                            );
                                                            if (!confirmed) return;
                                                            await applyAccountMutation(key, () => (
                                                                removeManagedCredentialAccount(selectedMachine.id, {
                                                                    id: account.id,
                                                                    provider: account.provider,
                                                                    name: account.name,
                                                                    expectedCredentialVersion: account.credentialVersion,
                                                                })
                                                            ), () => {
                                                                setExpandedAccount(null);
                                                            });
                                                        })()}
                                                    />
                                                </ButtonRow>
                                            )}
                                            {accountRowError?.id === account.id && (
                                                <>
                                                    <Text
                                                        accessibilityLiveRegion="polite"
                                                        style={{ color: theme.colors.textDestructive, fontSize: 15 }}
                                                    >
                                                        {accountRowError.message}
                                                    </Text>
                                                    {accountRowError.canReload && (
                                                        <ActionButton
                                                            label={t('settingsCredentials.reload')}
                                                            onPress={() => {
                                                                setAccountRowError(null);
                                                                void loadAccounts();
                                                            }}
                                                        />
                                                    )}
                                                </>
                                            )}
                                        </InlinePanel>
                                    )}
                                </React.Fragment>
                            );
                        })}

                        {login && loginMachineId === selectedMachine.id && (
                            <InlinePanel>
                                <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '600' }}>
                                    {providerName(login.provider)} · {login.name}
                                </Text>
                                <Text
                                    accessibilityLiveRegion="polite"
                                    style={{ color: ['failed', 'expired'].includes(login.state) ? theme.colors.textDestructive : theme.colors.textSecondary, fontSize: 15 }}
                                >
                                    {login.state === 'succeeded'
                                        ? t('settingsCredentials.loginSuccess')
                                        : login.state === 'failed'
                                            ? login.error ?? t('settingsCredentials.loginFailed')
                                            : login.state === 'canceled'
                                                ? t('settingsCredentials.loginCanceled')
                                                : login.state === 'expired'
                                                    ? t('settingsCredentials.loginExpired')
                                                    : t('settingsCredentials.loginPending')}
                                </Text>
                                {loginPollError && (
                                    <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.textDestructive, fontSize: 15 }}>
                                        {loginPollError}
                                    </Text>
                                )}
                                {accountError && (
                                    <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.textDestructive, fontSize: 15 }}>
                                        {accountError}
                                    </Text>
                                )}
                                {login.userCode && (
                                    <Text selectable style={{ color: theme.colors.text, fontSize: 20, fontWeight: '700', letterSpacing: 1 }}>
                                        {login.userCode}
                                    </Text>
                                )}
                                {login.verificationUrl && (
                                    <ActionButton
                                        label={t('settingsCredentials.openProvider', { provider: providerName(login.provider) })}
                                        onPress={() => void openExternalUrl(login.verificationUrl!)}
                                    />
                                )}
                                {login.requiresCodeEntry && login.state === 'waiting-user' && (
                                    <>
                                        <FormField
                                            label={t('settingsCredentials.verificationCode')}
                                            value={loginCode}
                                            onChangeText={setLoginCode}
                                            autoCapitalize="none"
                                        />
                                        <ActionButton
                                            label={t('settingsCredentials.submitCode')}
                                            disabled={!loginCode.trim() || Boolean(accountBusy)}
                                            onPress={() => void submitLoginCode()}
                                        />
                                    </>
                                )}
                                {['starting', 'waiting-user'].includes(login.state) && (
                                    <ActionButton label={t('settingsCredentials.cancelLogin')} onPress={() => void cancelLogin()} />
                                )}
                                {['failed', 'canceled', 'expired'].includes(login.state) && (
                                    <ActionButton
                                        label={t('settingsCredentials.retry')}
                                        disabled={Boolean(accountBusy)}
                                        onPress={() => void beginLogin(login.provider, login.name, loginAccountIdentity)}
                                    />
                                )}
                            </InlinePanel>
                        )}
                    </>
                )}
            </ItemGroup>

            <ItemGroup title={t('settingsCredentials.savedCredentials')} footer={t('settingsCredentials.credentialHelp')}>
                <Item
                    title={t('settingsCredentials.addCredential')}
                    icon={<Ionicons name="key-outline" size={29} color="#FF9500" />}
                    onPress={() => {
                        credentialMutationGeneration.current += 1;
                        revealGeneration.current += 1;
                        setRevealBusyId(null);
                        setRevealedSecret(null);
                        setCredentialRowError(null);
                        setCredentialConflict(false);
                        setCredentialError(null);
                        setCredentialDraft(emptyDraft());
                    }}
                    disabled={credentialInteractionDisabled}
                    showChevron={false}
                    accessibilityRole="button"
                    accessibilityState={{
                        disabled: credentialInteractionDisabled,
                        expanded: Boolean(credentialDraft && !credentialDraft.id),
                    }}
                />
                {credentialDraft && (
                    <InlinePanel>
                        <FormField
                            label={t('settingsCredentials.credentialName')}
                            value={credentialDraft.name}
                            onChangeText={(name) => setCredentialDraft({ ...credentialDraft, name })}
                            editable={!credentialInteractionDisabled}
                        />
                        <FormField
                            label={t('settingsCredentials.service')}
                            value={credentialDraft.service}
                            onChangeText={(service) => setCredentialDraft({ ...credentialDraft, service })}
                            placeholder={t('settingsCredentials.servicePlaceholder')}
                            editable={!credentialInteractionDisabled}
                        />
                        <FormField
                            label={t('settingsCredentials.username')}
                            value={credentialDraft.username}
                            onChangeText={(username) => setCredentialDraft({ ...credentialDraft, username })}
                            editable={!credentialInteractionDisabled}
                        />
                        <FormField
                            label={t('settingsCredentials.secret')}
                            value={credentialDraft.secret}
                            onChangeText={(secret) => setCredentialDraft({ ...credentialDraft, secret })}
                            placeholder={credentialDraft.id ? t('settingsCredentials.keepExistingSecret') : undefined}
                            secureTextEntry
                            editable={!credentialInteractionDisabled}
                        />
                        <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>
                            {t('settingsCredentials.credentialType')}
                        </Text>
                        <ButtonRow>
                            {credentialTypes.map((type) => (
                                <ActionButton
                                    key={type}
                                    label={credentialTypeLabel(type)}
                                    selected={credentialDraft.type === type}
                                    disabled={credentialInteractionDisabled}
                                    onPress={() => setCredentialDraft({ ...credentialDraft, type })}
                                />
                            ))}
                        </ButtonRow>
                        <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>
                            {t('settingsCredentials.usage')}
                        </Text>
                        <ButtonRow>
                            {usages.map((usage) => (
                                <ActionButton
                                    key={usage}
                                    label={usageLabel(usage)}
                                    selected={credentialDraft.usage.includes(usage)}
                                    disabled={credentialInteractionDisabled}
                                    onPress={() => setCredentialDraft({
                                        ...credentialDraft,
                                        usage: credentialDraft.usage.includes(usage)
                                            ? credentialDraft.usage.filter((value) => value !== usage)
                                            : [...credentialDraft.usage, usage],
                                    })}
                                />
                            ))}
                        </ButtonRow>
                        <ButtonRow>
                            <ActionButton
                                label={t('settingsCredentials.save')}
                                onPress={() => void persistCredential()}
                                disabled={credentialInteractionDisabled}
                            />
                            <ActionButton
                                label={t('settingsCredentials.cancel')}
                                onPress={() => {
                                    credentialMutationGeneration.current += 1;
                                    setCredentialDraft(null);
                                    setCredentialError(null);
                                }}
                                disabled={credentialInteractionDisabled}
                            />
                        </ButtonRow>
                    </InlinePanel>
                )}
                {credentialConflict && (
                    <Item
                        title={credentialError ?? t('settingsCredentials.credentialChanged')}
                        detail={t('settingsCredentials.reload')}
                        onPress={() => void reloadAfterCredentialConflict()}
                        showChevron={false}
                        destructive
                        accessibilityRole="button"
                    />
                )}
                {credentialError && credentialLoadState !== 'error' && !credentialConflict && (
                    <Item title={credentialError} showChevron={false} destructive />
                )}
                {credentialLoadState === 'loading' && (
                    <Item title={t('settingsCredentials.loading')} leftElement={<ActivityIndicator />} showChevron={false} />
                )}
                {credentialLoadState === 'error' && (
                    <Item
                        title={credentialError ?? t('settingsCredentials.loadFailed')}
                        detail={t('settingsCredentials.retry')}
                        onPress={() => void loadCredentials()}
                        showChevron={false}
                        destructive
                        accessibilityRole="button"
                    />
                )}
                {credentialLoadState === 'ready' && credentials.length === 0 && !credentialDraft && (
                    <Item title={t('settingsCredentials.emptyCredentials')} showChevron={false} />
                )}
                {credentials.map((credential) => {
                    const expanded = expandedCredential === credential.id;
                    const revealed = revealedSecret?.id === credential.id ? revealedSecret.value : null;
                    return (
                        <React.Fragment key={credential.id}>
                            <Item
                                title={credential.name}
                                subtitle={[credential.service, credential.username].filter(Boolean).join(' · ') || credentialTypeLabel(credential.type)}
                                detail={credential.usage.map(usageLabel).join(', ')}
                                icon={<Ionicons name="key-outline" size={29} color="#FF9500" />}
                                onPress={() => {
                                    revealGeneration.current += 1;
                                    setRevealBusyId(null);
                                    setRevealedSecret(null);
                                    setCredentialRowError(null);
                                    setExpandedCredential(expanded ? null : credential.id);
                                }}
                                disabled={credentialInteractionDisabled}
                                accessibilityRole="button"
                                accessibilityState={{ disabled: credentialInteractionDisabled, expanded }}
                            />
                            {expanded && (
                                <InlinePanel>
                                    <Text style={{
                                        minHeight: 44,
                                        color: theme.colors.text,
                                        fontSize: 16,
                                        fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
                                        padding: 12,
                                        borderWidth: 1,
                                        borderColor: theme.colors.divider,
                                        borderRadius: 10,
                                    }}>
                                        {revealed ?? '••••••••••••'}
                                    </Text>
                                    <ButtonRow>
                                        <ActionButton
                                            label={revealed
                                                ? t('settingsCredentials.hideSecret')
                                                : t('settingsCredentials.showSecret')}
                                            onPress={() => void toggleReveal(credential)}
                                            disabled={credentialInteractionDisabled || revealBusyId === credential.id}
                                        />
                                        <ActionButton
                                            label={t('settingsCredentials.editCredential')}
                                            onPress={() => beginEditCredential(credential)}
                                            disabled={credentialInteractionDisabled || revealBusyId === credential.id}
                                        />
                                        <ActionButton
                                            label={t('settingsCredentials.deleteCredential')}
                                            onPress={() => void removeCredential(credential)}
                                            disabled={credentialInteractionDisabled || revealBusyId === credential.id}
                                            destructive
                                        />
                                    </ButtonRow>
                                    {credentialRowError?.id === credential.id && (
                                        <Text
                                            accessibilityLiveRegion="polite"
                                            style={{ color: theme.colors.textDestructive, fontSize: 15 }}
                                        >
                                            {credentialRowError.message}
                                        </Text>
                                    )}
                                </InlinePanel>
                            )}
                        </React.Fragment>
                    );
                })}
            </ItemGroup>
        </ItemList>
    );
});
