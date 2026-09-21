import * as React from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useUnistyles } from 'react-native-unistyles';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Text } from '@/components/StyledText';
import { useNewSessionDraft } from '@/hooks/useNewSessionDraft';
import { useAllMachines, useProfile, useSocketStatus } from '@/sync/storage';
import { apiSocket } from '@/sync/apiSocket';
import { getServerUrl } from '@/sync/serverConfig';
import { getMachineName } from '@/sync/machineChoices';
import {
    checkDevicePairing, confirmDevicePairing, normalizeDevicePairingCode, verifyDeviceIdentity,
    type PairingFailure, type PairingTarget,
} from '@/sync/devicePairing';
import { t } from '@/text';

// CLI syntax is executable data and must remain identical in every locale.
const pairingCommand = 'happyherd machine pair';

function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
    const { theme } = useUnistyles();
    return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
        style={({ pressed }) => ({ minHeight: 44, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.divider,
            backgroundColor: pressed ? theme.colors.surfacePressedOverlay : theme.colors.surface, opacity: disabled ? 0.5 : 1,
            justifyContent: 'center', alignItems: 'center' })}>
        <Text style={{ fontSize: 16, color: theme.colors.textLink }}>{label}</Text>
    </Pressable>;
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
    const router = useRouter();
    const machines = useAllMachines({ includeOffline: true });
    const profile = useProfile();
    const { status: socketStatus } = useSocketStatus();
    const serverUrl = getServerUrl();
    const activeServerUrl = apiSocket.getActiveEndpoint();
    const serverChanged = activeServerUrl !== null && serverUrl.replace(/\/$/, '') !== activeServerUrl.replace(/\/$/, '');
    const scope = `${serverUrl}\n${activeServerUrl}\n${profile.id}`;
    const selectedMachineId = useNewSessionDraft((state) => state.selectedMachineId);
    const [adding, setAdding] = React.useState(false);
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
        setCode(''); setTarget(null); setRequestId(null); setError(null); setBusy(false); setAdding(false); setConnected(null);
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
        setCode(''); setTarget(null); setRequestId(null); setError(null); setBusy(false); setAdding(false);
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
    const copyStyle = { color: theme.colors.text, fontSize: 16, lineHeight: 24 };
    return <ItemList>
        <ItemGroup title={t('devicePairing.title')} footer={t('devicePairing.scope')}>
            <View style={{ padding: 16, gap: 12 }}>
                <Text style={copyStyle}>{t('devicePairing.description')}</Text>
                <Text selectable style={copyStyle}>{t('devicePairing.server', { server: serverUrl })}</Text>
                {serverChanged && <Text accessibilityRole="alert" style={{ ...copyStyle, color: theme.colors.textDestructive }}>{t('devicePairing.serverChanged')}</Text>}
                {serverChanged && activeServerUrl && <Text selectable style={copyStyle}>{t('devicePairing.activeServer', { server: activeServerUrl })}</Text>}
                <Text selectable style={copyStyle}>{t('devicePairing.account', { account: profile.id })}</Text>
                {!adding && <Action label={t('devicePairing.addDevice')} disabled={serverChanged} onPress={() => { setConnected(null); setAdding(true); }} />}
            </View>
        </ItemGroup>
        {adding && <ItemGroup title={t('devicePairing.addDevice')}>
            <View style={{ padding: 16, gap: 12 }}>
                <Text style={copyStyle}>{t('devicePairing.instructions')}</Text>
                <Text selectable style={{ ...copyStyle, fontFamily: 'monospace' }}>{pairingCommand}</Text>
                {!target ? <>
                    <Text nativeID="device-pairing-code-label" style={copyStyle}>{t('devicePairing.codeLabel')}</Text>
                    <TextInput accessibilityLabel={t('devicePairing.codeLabel')} aria-labelledby="device-pairing-code-label"
                        value={code} onChangeText={(value) => {
                            generation.current += 1;
                            const digits = /^\d{4}[- ]\d{0,4}$/.test(value) ? value.replace(/[- ]/, '') : value;
                            setCode(/^\d{5,8}$/.test(digits) ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits);
                            setError(null);
                        }} editable={!busy}
                        autoCapitalize="none" autoCorrect={false} keyboardType="number-pad" autoComplete="one-time-code"
                        placeholder={t('devicePairing.codePlaceholder')} onSubmitEditing={() => { if (!busy) void check(); }}
                        style={{ fontSize: 18, minHeight: 48, color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 10, padding: 12 }} />
                    <Action label={busy ? t('devicePairing.checking') : t('devicePairing.checkCode')} disabled={busy || serverChanged} onPress={() => void check()} />
                </> : <>
                    <Text style={copyStyle}>{t('devicePairing.confirmIdentity')}</Text>
                    <Text selectable style={copyStyle}>{t('devicePairing.host', { host: target.host })}</Text>
                    <Text selectable style={copyStyle}>{t('devicePairing.machineId', { machineId: target.machineId })}</Text>
                    <Action label={busy ? t('devicePairing.connecting') : error === 'network' ? t('devicePairing.retryConnect') : t('devicePairing.connect')}
                        disabled={busy || serverChanged} onPress={() => void connect()} />
                    <Action label={t('devicePairing.enterAnotherCode')} disabled={busy} onPress={() => { setTarget(null); setRequestId(null); setCode(''); setError(null); }} />
                </>}
                {error && <Text accessibilityRole="alert" style={{ ...copyStyle, color: theme.colors.textDestructive }}>{pairingError(error)}</Text>}
                <Action label={t('common.cancel')} onPress={clearForm} />
            </View>
        </ItemGroup>}
        {connected && socketStatus === 'connected' && checks[connected.machineId] === true && machines.some((machine) => machine.id === connected.machineId && machine.active) && <ItemGroup title={t('devicePairing.connected')}>
            <View style={{ padding: 16, gap: 12 }}>
                <Text style={copyStyle}>{t('devicePairing.connectedDetail', { host: connected.host })}</Text>
                <Action label={t('devicePairing.openDevice')} onPress={() => router.push(`/machine/${connected.machineId}`)} />
                <Action label={t('devicePairing.newSession')} onPress={() => {
                    if (useNewSessionDraft.getState().selectedMachineId !== connected.machineId) useNewSessionDraft.getState().setMachineId(connected.machineId);
                    router.push('/new');
                }} />
                <Action label={t('workspace.title')} onPress={() => router.push({ pathname: '/workspace', params: { machineId: connected.machineId, path: machines.find((machine) => machine.id === connected.machineId)?.metadata?.homeDir || '~' } })} />
            </View>
        </ItemGroup>}
        <ItemGroup title={t('devicePairing.devices')} footer={t('devicePairing.devicesFooter')}>
            {machines.length === 0 && <Item title={t('devicePairing.noDevices')} showChevron={false} />}
            {machines.map((machine) => {
                const supported = machine.metadata?.devicePairingProtocolVersion === 1;
                const status = !supported ? t('devicePairing.needsUpdate') : socketStatus !== 'connected' || serverChanged || !machine.active || checks[machine.id] === false ? t('status.offline') : checks[machine.id] === true ? t('status.online') : t('devicePairing.checking');
                return <Item key={machine.id} title={getMachineName(machine)}
                    subtitle={`${status}${selectedMachineId === machine.id ? ` · ${t('devicePairing.selected')}` : ''}`}
                    onPress={() => router.push(`/machine/${machine.id}`)} />;
            })}
            <Item title={t('devicePairing.refresh')} onPress={() => setRefresh((value) => value + 1)} showChevron={false} />
        </ItemGroup>
    </ItemList>;
}
