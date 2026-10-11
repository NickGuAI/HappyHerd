import * as React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import type { VoiceFeature, VoiceInstallState } from '@happyherd/wire';
import { Item } from '@/components/Item';
import { Switch } from '@/components/Switch';
import { useLocalVoiceStatus } from '@/hooks/useLocalVoiceStatus';
import { useSettingMutable, useAllMachines } from '@/sync/storage';
import { installLocalVoiceFeature } from '@/sync/localVoice';
import { getMachineName } from '@/sync/machineChoices';
import { isMachineOnline } from '@/utils/machineUtils';
import { t } from '@/text';

type InstallErrors = Record<VoiceFeature, string | null>;

function stateLabel(state: VoiceInstallState | undefined, online: boolean, loading: boolean): string {
    if (!online) return t('happyHerd.localVoice.machineOffline');
    if (loading && !state) return t('happyHerd.localVoice.checking');
    switch (state) {
        case 'installing': return t('happyHerd.localVoice.downloading');
        case 'ready': return t('happyHerd.localVoice.ready');
        case 'failed': return t('happyHerd.localVoice.failed');
        case 'unsupported': return t('happyHerd.localVoice.unsupported');
        default: return t('happyHerd.localVoice.notInstalled');
    }
}

export function LocalVoiceSettings() {
    const { theme } = useUnistyles();
    const machines = useAllMachines({ includeOffline: true });
    const candidates = React.useMemo(() => machines
        .filter((machine) => machine.metadata?.happyCliVersion)
        .sort((left, right) => Number(isMachineOnline(right)) - Number(isMachineOnline(left))
            || left.id.localeCompare(right.id)), [machines]);
    const [machineId, setMachineId] = useSettingMutable('localVoiceMachineId');
    const [sttEnabled, setSttEnabled] = useSettingMutable('localVoiceSttEnabled');
    const [ttsEnabled, setTtsEnabled] = useSettingMutable('localVoiceTtsEnabled');
    const [expanded, setExpanded] = React.useState(false);
    const [installing, setInstalling] = React.useState<VoiceFeature | null>(null);
    const [installErrors, setInstallErrors] = React.useState<InstallErrors>({ stt: null, tts: null });
    const selected = candidates.find((machine) => machine.id === machineId) ?? null;
    const selectedIdRef = React.useRef<string | null>(selected?.id ?? null);
    const installGeneration = React.useRef(0);
    const { status, loading, online, refresh } = useLocalVoiceStatus(selected?.id ?? null);

    React.useEffect(() => {
        selectedIdRef.current = selected?.id ?? null;
        installGeneration.current += 1;
        setInstalling(null);
        setInstallErrors({ stt: null, tts: null });
    }, [selected?.id]);

    React.useEffect(() => {
        if (machineId !== null || !candidates.length) return;
        setMachineId(candidates[0].id);
    }, [candidates, machineId, setMachineId]);

    const install = React.useCallback(async (feature: VoiceFeature) => {
        if (!selected || !isMachineOnline(selected)) {
            setExpanded(true);
            return;
        }
        const requestedMachineId = selected.id;
        const requestGeneration = ++installGeneration.current;
        const stillSelected = () => selectedIdRef.current === requestedMachineId
            && installGeneration.current === requestGeneration;
        setInstalling(feature);
        setInstallErrors((current) => ({ ...current, [feature]: null }));
        try {
            await installLocalVoiceFeature(requestedMachineId, feature);
            if (!stillSelected()) return;
            await refresh();
        } catch (error) {
            if (stillSelected()) {
                setInstallErrors((current) => ({
                    ...current,
                    [feature]: error instanceof Error && error.message ? error.message : t('happyHerd.localVoice.installFailed'),
                }));
                await refresh();
            }
        } finally {
            if (stillSelected()) setInstalling(null);
        }
    }, [refresh, selected]);

    const setFeature = React.useCallback((feature: VoiceFeature, value: boolean) => {
        if (feature === 'stt') setSttEnabled(value);
        else setTtsEnabled(value);
        if (value) void install(feature);
    }, [install, setSttEnabled, setTtsEnabled]);

    const featureItem = (feature: VoiceFeature) => {
        const isStt = feature === 'stt';
        const enabled = isStt ? sttEnabled : ttsEnabled;
        const featureStatus = isStt ? status?.stt : status?.tts;
        const title = t(isStt ? 'happyHerd.localVoice.sttTitle' : 'happyHerd.localVoice.ttsTitle');
        const busy = installing === feature || featureStatus?.state === 'installing';
        const disabled = !enabled && (!selected || !online || busy);
        const requestError = installErrors[feature];
        return (
            <React.Fragment key={feature}>
                <Item
                    title={title}
                    subtitle={stateLabel(featureStatus?.state, online, loading)}
                    icon={<Ionicons name={isStt ? 'mic-outline' : 'volume-high-outline'} size={27} color={theme.colors.textLink} />}
                    rightElement={<Switch accessibilityLabel={title} value={enabled} disabled={disabled} onValueChange={(value) => setFeature(feature, value)} />}
                    showChevron={false}
                />
                {enabled && featureStatus?.state === 'unsupported' ? (
                    <Item
                        title={t('happyHerd.localVoice.unsupportedDetail')}
                        subtitle={featureStatus.error}
                        icon={<Ionicons name="information-circle-outline" size={25} color={theme.colors.textSecondary} />}
                        showChevron={false}
                    />
                ) : null}
                {enabled && (requestError || featureStatus?.state === 'failed') ? (
                    <Item
                        title={t('happyHerd.localVoice.retry')}
                        subtitle={requestError || featureStatus?.error || t('happyHerd.localVoice.installFailed')}
                        icon={<Ionicons name="refresh-outline" size={25} color={theme.colors.textSecondary} />}
                        onPress={() => void install(feature)}
                        showChevron
                    />
                ) : null}
            </React.Fragment>
        );
    };

    const machineSubtitle = selected
        ? `${getMachineName(selected)} · ${online ? t('status.online') : t('happyHerd.localVoice.machineOffline')}`
        : machineId
            ? t('happyHerd.localVoice.selectedMachineUnavailable')
            : t('happyHerd.localVoice.noMachines');

    return (
        <>
            <Item
                title={t('happyHerd.localVoice.title')}
                subtitle={t('happyHerd.localVoice.description')}
                icon={<Ionicons name="mic-circle-outline" size={27} color={theme.colors.textLink} />}
                showChevron={false}
                subtitleLines={0}
            />
            <Item
                title={t('happyHerd.localVoice.voiceMachine')}
                subtitle={machineSubtitle}
                icon={<Ionicons name="hardware-chip-outline" size={27} color={theme.colors.textLink} />}
                onPress={() => setExpanded((value) => !value)}
                detail={selected ? undefined : t('happyHerd.localVoice.chooseMachine')}
            />
            {expanded && candidates.map((machine) => (
                <Item
                    key={machine.id}
                    title={getMachineName(machine)}
                    subtitle={isMachineOnline(machine) ? t('status.online') : t('happyHerd.localVoice.machineOffline')}
                    selected={machine.id === selected?.id}
                    onPress={() => {
                        setMachineId(machine.id);
                        setExpanded(false);
                    }}
                    showChevron={false}
                    rightElement={machine.id === selected?.id ? <Ionicons name="checkmark" size={20} color={theme.colors.header.tint} /> : undefined}
                />
            ))}
            {featureItem('stt')}
            {featureItem('tts')}
        </>
    );
}
