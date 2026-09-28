import * as React from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { Ionicons, Octicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Text } from '@/components/StyledText';
import { layout } from '@/components/layout';
import { useHerdPhoneLayout } from '@/components/herd/mobile/useHerdPhone';
import { herdWebClasses } from '@/components/herd/motion';
import { Typography } from '@/constants/Typography';
import { useNewSessionDraft } from '@/hooks/useNewSessionDraft';
import { useAllMachines, useProfile, useSocketStatus } from '@/sync/storage';
import { apiSocket } from '@/sync/apiSocket';
import { getServerUrl } from '@/sync/serverConfig';
import { getMachineName } from '@/sync/machineChoices';
import {
    checkDevicePairing, confirmDevicePairing, normalizeDevicePairingCode, verifyDeviceIdentity,
    type PairingFailure, type PairingTarget,
} from '@/sync/devicePairing';
import { formatLastSeen } from '@/utils/sessionUtils';
import { t } from '@/text';

// CLI syntax is executable data and must remain identical in every locale.
const pairingCommand = 'happyherd machine pair';

/** The mock's buttons (UI overhaul): `primary` is the molten action, the default a quiet one. */
function Action({ label, onPress, disabled = false, primary = false }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
    const touch = useHerdPhoneLayout();
    return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} aria-disabled={disabled} disabled={disabled} onPress={onPress}
        style={({ pressed, hovered }: any) => [styles.button, touch && styles.buttonTouch, primary && styles.buttonPrimary,
            (pressed || hovered) && (primary ? styles.buttonPrimaryHover : styles.buttonHover), disabled && styles.buttonDisabled]}>
        <Text numberOfLines={1} style={[styles.buttonText, primary && styles.buttonTextPrimary]}>{label}</Text>
    </Pressable>;
}

/** A group's title with the mock's description line under it. */
function GroupHeader({ title, description }: { title: string; description?: string }) {
    return <View>
        <Text style={styles.groupTitle}>{title}</Text>
        {description ? <Text style={styles.groupDescription}>{description}</Text> : null}
    </View>;
}

/** The mock's selection tag, then the chevron the row would show without it. */
function SelectedTag() {
    const { theme } = useUnistyles();
    return <View style={styles.selectedAccessory}>
        <View style={styles.tag}><Text numberOfLines={1} style={styles.tagText}>{t('devicePairing.selected')}</Text></View>
        <Ionicons name="chevron-forward" size={Platform.OS === 'ios' ? 17 : 24} color={theme.colors.groupped.chevron} style={{ marginLeft: 4 }} />
    </View>;
}

function DeviceIcon({ platform }: { platform?: string }) {
    const { theme } = useUnistyles();
    return <View style={styles.deviceIcon}>
        {platform === 'darwin'
            ? <Ionicons name="laptop-outline" size={16} color={theme.colors.textLink} />
            : <Octicons name="server" size={15} color={theme.colors.textLink} />}
    </View>;
}

function pairingError(failure: PairingFailure): string {
    switch (failure) {
        case 'invalid': return t('devicePairing.invalid');
        case 'not_found': return t('devicePairing.notFound');
        case 'expired': return t('devicePairing.expired');
        case 'cancelled': return t('devicePairing.cancelled');
        case 'used': return t('devicePairing.used');
        case 'collision': return t('devicePairing.collision');
        case 'unavailable': return t('devicePairing.unavailable');
        case 'network': return t('devicePairing.network');
        case 'identity': return t('devicePairing.identityMismatch');
    }
}

export function ConnectionsSettingsView() {
    const { theme } = useUnistyles();
    const touch = useHerdPhoneLayout();
    const router = useRouter();
    const machines = useAllMachines({ includeOffline: true });
    const profile = useProfile();
    const { status: socketStatus } = useSocketStatus();
    const serverUrl = getServerUrl();
    const activeServerUrl = apiSocket.getActiveEndpoint();
    const serverChanged = activeServerUrl !== null && serverUrl.replace(/\/$/, '') !== activeServerUrl.replace(/\/$/, '');
    const scope = `${serverUrl}\n${activeServerUrl}\n${profile.id}`;
    const selectedMachineId = useNewSessionDraft((state) => state.selectedMachineId);
    const [code, setCode] = React.useState('');
    const [target, setTarget] = React.useState<PairingTarget | null>(null);
    const [requestId, setRequestId] = React.useState<string | null>(null);
    const [connected, setConnected] = React.useState<PairingTarget | null>(null);
    const [error, setError] = React.useState<PairingFailure | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [checks, setChecks] = React.useState<Record<string, boolean>>({});
    const [refresh, setRefresh] = React.useState(0);
    const generation = React.useRef(0);
    // Only identity and capability affect this request; heartbeat updates must not restart it.
    const supportedIds = machines.filter((machine) => machine.metadata?.devicePairingProtocolVersion === 1 && machine.active).map((machine) => machine.id).sort().join('\n');
    React.useEffect(() => {
        let active = true;
        setChecks({});
        for (const id of socketStatus === 'connected' && !serverChanged ? supportedIds.split('\n').filter(Boolean) : []) {
            void verifyDeviceIdentity(id).then((reachable) => {
                if (active) setChecks((previous) => ({ ...previous, [id]: reachable }));
            });
        }
        return () => { active = false; };
    }, [supportedIds, refresh, scope, socketStatus, serverChanged]);
    React.useEffect(() => {
        generation.current += 1;
        setCode(''); setTarget(null); setRequestId(null); setError(null); setBusy(false); setConnected(null);
    }, [scope]);
    React.useEffect(() => {
        if (socketStatus !== 'connected') {
            generation.current += 1;
            setBusy(false);
            setConnected(null);
        }
    }, [socketStatus]);
    React.useEffect(() => () => { generation.current += 1; }, []);

    const clearForm = () => {
        generation.current += 1;
        setCode(''); setTarget(null); setRequestId(null); setError(null); setBusy(false);
    };
    const check = async () => {
        const current = ++generation.current;
        setError(null); setTarget(null); setRequestId(null);
        if (socketStatus !== 'connected' || serverChanged) { setError('network'); return; }
        const normalized = normalizeDevicePairingCode(code);
        if (!normalized) { setError('invalid'); return; }
        setBusy(true);
        const result = await checkDevicePairing(machines, normalized);
        if (generation.current !== current) return;
        setBusy(false);
        if (result.status === 'pending') {
            setCode(normalized); setTarget(result.target); setRequestId(randomUUID());
        } else setError(result.status);
    };
    const connect = async () => {
        if (!target || !requestId) return;
        if (socketStatus !== 'connected' || serverChanged) { setError('network'); return; }
        const current = ++generation.current;
        setBusy(true); setError(null);
        const result = await confirmDevicePairing(target, code, requestId);
        if (generation.current !== current) return;
        setBusy(false);
        if (result.status === 'connected') {
            // Reuse the account's existing machine and the normal persisted session draft.
            // Keeping an already selected machine also keeps its path and launch options.
            if (useNewSessionDraft.getState().selectedMachineId !== target.machineId) useNewSessionDraft.getState().setMachineId(target.machineId);
            setConnected(target);
            setChecks((previous) => ({ ...previous, [target.machineId]: true }));
            clearForm();
        } else setError(result.status);
    };
    const canCancel = code !== '' || target !== null || error !== null || busy;
    return <ItemList>
        <View style={styles.introWrap}>
            <View style={styles.intro}>
                <Text style={styles.description}>{t('devicePairing.description')}</Text>
                <View style={styles.details}>
                    <Text selectable style={styles.detail}>{t('devicePairing.server', { server: serverUrl })}</Text>
                    {serverChanged && <Text accessibilityRole="alert" style={styles.alert}>{t('devicePairing.serverChanged')}</Text>}
                    {serverChanged && activeServerUrl && <Text selectable style={styles.detail}>{t('devicePairing.activeServer', { server: activeServerUrl })}</Text>}
                    <Text selectable style={styles.detail}>{t('devicePairing.account', { account: profile.id })}</Text>
                </View>
                <Text style={styles.scope}>{t('devicePairing.scope')}</Text>
            </View>
        </View>
        <ItemGroup title={<GroupHeader title={t('devicePairing.addDevice')} description={t('devicePairing.instructions')} />}>
            <View style={styles.addBody} testID="device-pairing-add">
                <View style={styles.command}>
                    <Text style={styles.commandPrompt}>$</Text>
                    <Text selectable style={styles.commandText}>{pairingCommand}</Text>
                </View>
                {!target ? <View style={styles.codeRow}>
                    <TextInput accessibilityLabel={t('devicePairing.codeLabel')} aria-label={t('devicePairing.codeLabel')}
                        value={code} onChangeText={(value) => {
                            generation.current += 1;
                            const digits = /^\d{4}[- ]\d{0,4}$/.test(value) ? value.replace(/[- ]/, '') : value;
                            setCode(/^\d{5,8}$/.test(digits) ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits);
                            setError(null);
                        }} editable={!busy && !serverChanged}
                        autoCapitalize="none" autoCorrect={false} keyboardType="number-pad" autoComplete="one-time-code"
                        placeholder={t('devicePairing.codePlaceholder')} placeholderTextColor={theme.colors.kilv.inkFaint}
                        onSubmitEditing={() => { if (!busy && !serverChanged) void check(); }}
                        style={[styles.codeInput, touch && styles.codeInputTouch]} />
                    <Action primary label={busy ? t('devicePairing.checking') : t('devicePairing.checkCode')} disabled={busy || serverChanged} onPress={() => void check()} />
                </View> : <View style={styles.confirm}>
                    <Text style={styles.confirmText}>{t('devicePairing.confirmIdentity')}</Text>
                    <View style={styles.identity}>
                        <Text selectable style={styles.identityText}>{t('devicePairing.host', { host: target.host })}</Text>
                        <Text style={styles.identityText}> · </Text>
                        <Text selectable style={styles.identityText}>{t('devicePairing.machineId', { machineId: target.machineId })}</Text>
                    </View>
                    <View style={styles.actions}>
                        <Action primary label={busy ? t('devicePairing.connecting') : error === 'network' ? t('devicePairing.retryConnect') : t('devicePairing.connect')}
                            disabled={busy || serverChanged} onPress={() => void connect()} />
                        <Action label={t('devicePairing.enterAnotherCode')} disabled={busy} onPress={() => { setTarget(null); setRequestId(null); setCode(''); setError(null); }} />
                    </View>
                </View>}
                {error && <Text accessibilityRole="alert" style={styles.alert}>{pairingError(error)}</Text>}
                {canCancel && <View style={styles.actions}><Action label={t('common.cancel')} onPress={clearForm} /></View>}
            </View>
        </ItemGroup>
        {connected && socketStatus === 'connected' && checks[connected.machineId] === true && machines.some((machine) => machine.id === connected.machineId && machine.active) && <ItemGroup title={<GroupHeader title={t('devicePairing.connected')} />}>
            <View style={styles.addBody}>
                <Text style={styles.connectedText}>{t('devicePairing.connectedDetail', { host: connected.host })}</Text>
                <View style={styles.actions}>
                    <Action primary label={t('devicePairing.newSession')} onPress={() => {
                        if (useNewSessionDraft.getState().selectedMachineId !== connected.machineId) useNewSessionDraft.getState().setMachineId(connected.machineId);
                        router.push('/new');
                    }} />
                    <Action label={t('devicePairing.openDevice')} onPress={() => router.push(`/machine/${connected.machineId}`)} />
                    <Action label={t('workspace.title')} onPress={() => router.push({ pathname: '/workspace', params: { machineId: connected.machineId, path: machines.find((machine) => machine.id === connected.machineId)?.metadata?.homeDir || '~' } })} />
                </View>
            </View>
        </ItemGroup>}
        <ItemGroup title={<GroupHeader title={t('devicePairing.devices')} description={t('devicePairing.devicesFooter')} />}>
            {machines.length === 0 && <Item title={t('devicePairing.noDevices')} showChevron={false} />}
            {machines.map((machine) => {
                const supported = machine.metadata?.devicePairingProtocolVersion === 1;
                const status = !supported ? t('devicePairing.needsUpdate')
                    : !machine.active ? (machine.activeAt ? t('status.lastSeen', { time: formatLastSeen(machine.activeAt, false) }) : t('status.offline'))
                        : socketStatus !== 'connected' || serverChanged || checks[machine.id] === false ? t('status.offline')
                            : checks[machine.id] === true ? t('status.online') : t('devicePairing.checking');
                const selected = selectedMachineId === machine.id;
                return <Item key={machine.id} title={getMachineName(machine)} titleStyle={styles.deviceName}
                    subtitle={status} icon={<DeviceIcon platform={machine.metadata?.platform} />}
                    rightElement={selected ? <SelectedTag /> : undefined}
                    onPress={() => router.push(`/machine/${machine.id}`)} />;
            })}
            <Item title={t('devicePairing.refresh')} onPress={() => setRefresh((value) => value + 1)} showChevron={false} />
        </ItemGroup>
    </ItemList>;
}

const styles = StyleSheet.create((theme) => ({
    // The intro sits on the cards' left edge, under the page title.
    introWrap: {
        alignItems: 'center',
    },
    intro: {
        width: '100%',
        maxWidth: layout.maxWidth,
        paddingHorizontal: 16,
        paddingTop: 12,
        gap: 10,
    },
    description: {
        ...Typography.default(),
        maxWidth: 720,
        fontSize: 14.5,
        lineHeight: 22,
        color: theme.colors.kilv.inkDim,
    },
    details: {
        gap: 2,
    },
    detail: {
        ...Typography.mono(),
        fontSize: 12.5,
        lineHeight: 18,
        color: theme.colors.kilv.inkFaint,
    },
    scope: {
        ...Typography.default(),
        fontSize: 13,
        lineHeight: 19,
        color: theme.colors.kilv.inkFaint,
    },
    alert: {
        ...Typography.default(),
        fontSize: 13,
        lineHeight: 19,
        color: theme.colors.textDestructive,
    },
    groupTitle: {
        ...Typography.mono('semiBold'),
        fontSize: 14,
        lineHeight: 20,
        letterSpacing: 0.1,
        textTransform: 'uppercase',
        color: theme.colors.groupped.sectionTitle,
        ...Platform.select({ web: { fontWeight: '500' as const }, default: {} }),
    },
    groupDescription: {
        ...Typography.default(),
        marginTop: 4,
        fontSize: 13,
        lineHeight: 19,
        color: theme.colors.kilv.inkFaint,
        textTransform: 'none',
    },
    addBody: {
        padding: 14,
        gap: 12,
    },
    // The mock's `tool-cmd`: the command in a sunken mono block with a molten prompt.
    command: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.kilv.bgSunken,
    },
    commandPrompt: {
        ...Typography.mono(),
        marginRight: 8,
        fontSize: 13.5,
        color: theme.colors.kilv.accent,
    },
    commandText: {
        ...Typography.mono(),
        flexShrink: 1,
        fontSize: 13.5,
        color: theme.colors.text,
    },
    codeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    codeInput: {
        ...Typography.mono(),
        flex: 1,
        minWidth: 0,
        height: 40,
        paddingHorizontal: 13,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.kilv.bgSunken,
        color: theme.colors.text,
        fontSize: 14,
    },
    // Phones: a 44 px target and 16 px text, which iOS Safari will not zoom.
    codeInputTouch: {
        height: 44,
        fontSize: 16,
    },
    confirm: {
        gap: 10,
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: theme.kilv.radiusCard,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        _web: { _classNames: herdWebClasses('herd-rise') },
    },
    confirmText: {
        ...Typography.default(),
        fontSize: 15,
        lineHeight: 22,
        color: theme.colors.text,
    },
    identity: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
    },
    identityText: {
        ...Typography.mono(),
        fontSize: 12.5,
        lineHeight: 18,
        color: theme.colors.kilv.inkFaint,
    },
    actions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    button: {
        height: 40,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 7,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        _web: { _classNames: herdWebClasses('herd-transition', 'herd-press'), cursor: 'pointer' },
    },
    buttonTouch: {
        height: 44,
    },
    buttonHover: {
        borderColor: theme.colors.kilv.rimLine,
    },
    buttonPrimary: {
        borderColor: theme.colors.kilv.accent,
        backgroundColor: theme.colors.kilv.accent,
    },
    buttonPrimaryHover: {
        borderColor: theme.colors.kilv.accentHot,
        backgroundColor: theme.colors.kilv.accentHot,
    },
    buttonDisabled: {
        opacity: 0.45,
    },
    buttonText: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.kilv.inkDim,
    },
    buttonTextPrimary: {
        color: theme.colors.kilv.accentInk,
    },
    connectedText: {
        ...Typography.default(),
        fontSize: 15,
        lineHeight: 22,
        color: theme.colors.text,
    },
    // The mock's device icon: a stone tile with a molten glyph.
    deviceIcon: {
        width: 30,
        height: 30,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceHighest,
    },
    deviceName: {
        ...Typography.mono(),
    },
    selectedAccessory: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    tag: {
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: theme.colors.kilv.accent,
        maxWidth: 220,
    },
    tagText: {
        ...Typography.mono(),
        fontSize: 11,
        lineHeight: 16,
        color: theme.colors.kilv.accent,
    },
}));
