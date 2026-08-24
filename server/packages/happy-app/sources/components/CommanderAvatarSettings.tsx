import * as DocumentPicker from 'expo-document-picker';
import * as React from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
    MAX_HAPPYHERD_COMMANDER_AVATAR_BYTES,
    type HappyHerdCommanderSummary,
} from '@slopus/happy-wire';

import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { Modal } from '@/modal';
import { machineListCommanders } from '@/sync/ops';
import { useAllMachines } from '@/sync/storage';
import type { Machine } from '@/sync/storageTypes';
import { t } from '@/text';
import {
    CommanderAvatarUploadError,
    uploadCommanderAvatar,
} from '@/utils/commanderAvatarUpload';
import { isMachineOnline } from '@/utils/machineUtils';
import { readFileBytes } from '@/utils/readFileBytes';
import { CommanderSessionAvatar } from './CommanderSessionAvatar';

type CommanderMachineState = {
    commanders: HappyHerdCommanderSummary[];
    error: boolean;
    loading: boolean;
};

function machineName(machine: Machine): string {
    return machine.metadata?.displayName || machine.metadata?.host || machine.id;
}

function uploadErrorMessage(error: unknown): string {
    if (!(error instanceof CommanderAvatarUploadError)) {
        return t('happyHerd.commanderAvatars.uploadFailed');
    }
    switch (error.code) {
        case 'empty':
            return t('happyHerd.commanderAvatars.empty');
        case 'too-large':
            return t('happyHerd.commanderAvatars.tooLarge');
        case 'invalid-format':
            return t('happyHerd.commanderAvatars.invalidFormat');
        case 'stale':
            return t('happyHerd.commanderAvatars.stale');
        case 'runtime-unsupported':
            return t('happyHerd.commanderAvatars.runtimeUnsupported');
        case 'invalid-target':
        case 'upload-failed':
            return t('happyHerd.commanderAvatars.uploadFailed');
    }
}

export function CommanderAvatarSettings() {
    const machines = useAllMachines({ includeOffline: true });
    const [machineStates, setMachineStates] = React.useState<Record<string, CommanderMachineState>>({});
    const [uploading, setUploading] = React.useState<string | null>(null);
    const machineKey = machines
        .map((machine) => `${machine.id}:${isMachineOnline(machine) ? 'online' : 'offline'}`)
        .sort()
        .join('|');

    React.useEffect(() => {
        let active = true;
        const onlineMachines = machines.filter(isMachineOnline);
        setMachineStates((current) => {
            const next = { ...current };
            for (const machine of onlineMachines) {
                next[machine.id] = { commanders: current[machine.id]?.commanders ?? [], error: false, loading: true };
            }
            return next;
        });
        void Promise.allSettled(onlineMachines.map(async (machine) => ({
            machineId: machine.id,
            response: await machineListCommanders(machine.id),
        }))).then((results) => {
            if (!active) return;
            setMachineStates((current) => {
                const next = { ...current };
                results.forEach((result, index) => {
                    const machineId = onlineMachines[index].id;
                    next[machineId] = result.status === 'fulfilled'
                        ? { commanders: result.value.response.commanders, error: false, loading: false }
                        : { commanders: [], error: true, loading: false };
                });
                return next;
            });
        });
        return () => {
            active = false;
        };
        // machineKey deliberately excludes heartbeat timestamps so routine
        // presence updates do not reload every Commander's profile descriptor.
    }, [machineKey]);

    const choosePicture = React.useCallback(async (
        machine: Machine,
        commander: HappyHerdCommanderSummary,
    ) => {
        const selection = await DocumentPicker.getDocumentAsync({
            type: ['image/png', 'image/jpeg', 'image/webp'],
            multiple: false,
            copyToCacheDirectory: true,
        });
        if (selection.canceled || !selection.assets[0]) return;
        const asset = selection.assets[0];
        if (typeof asset.size === 'number' && asset.size > MAX_HAPPYHERD_COMMANDER_AVATAR_BYTES) {
            Modal.alert(t('common.error'), t('happyHerd.commanderAvatars.tooLarge'));
            return;
        }

        const identity = `${machine.id}\u0000${commander.id}`;
        setUploading(identity);
        try {
            const content = await readFileBytes(asset.uri);
            const updated = await uploadCommanderAvatar(machine.id, commander, content);
            setMachineStates((current) => ({
                ...current,
                [machine.id]: {
                    ...(current[machine.id] ?? { error: false, loading: false }),
                    commanders: (current[machine.id]?.commanders ?? []).map((candidate) => (
                        candidate.id === updated.id ? updated : candidate
                    )),
                },
            }));
            Modal.alert(
                t('common.success'),
                t('happyHerd.commanderAvatars.updated', { name: commander.name }),
            );
        } catch (error) {
            Modal.alert(t('common.error'), uploadErrorMessage(error));
        } finally {
            setUploading(null);
        }
    }, []);

    if (machines.length === 0) {
        return (
            <ItemGroup
                title={t('happyHerd.commanderAvatars.title')}
                footer={t('happyHerd.commanderAvatars.description')}
            >
                <Item
                    title={t('happyHerd.commanderAvatars.noMachines')}
                    icon={<Ionicons name="desktop-outline" size={29} color="#999999" />}
                    disabled
                    showChevron={false}
                />
            </ItemGroup>
        );
    }

    return (
        <>
            {machines.map((machine, machineIndex) => {
                const online = isMachineOnline(machine);
                const state = machineStates[machine.id];
                const rows = !online
                    ? [(
                        <Item
                            key="offline"
                            title={t('happyHerd.commanderAvatars.machineOffline')}
                            icon={<Ionicons name="cloud-offline-outline" size={29} color="#999999" />}
                            disabled
                            showChevron={false}
                        />
                    )]
                    : state?.loading || !state
                        ? [(
                            <Item
                                key="loading"
                                title={t('happyHerd.commanderAvatars.loading')}
                                loading
                                disabled
                                showChevron={false}
                            />
                        )]
                        : state.error
                            ? [(
                                <Item
                                    key="error"
                                    title={t('happyHerd.commanderAvatars.loadFailed')}
                                    icon={<Ionicons name="warning-outline" size={29} color="#FF9500" />}
                                    disabled
                                    showChevron={false}
                                />
                            )]
                            : state.commanders.length === 0
                                ? [(
                                    <Item
                                        key="empty"
                                        title={t('happyHerd.commanderAvatars.noCommanders')}
                                        disabled
                                        showChevron={false}
                                    />
                                )]
                                : state.commanders.map((commander) => {
                                    const identity = `${machine.id}\u0000${commander.id}`;
                                    return (
                                        <Item
                                            key={commander.id}
                                            title={commander.name}
                                            subtitle={commander.role ?? commander.id}
                                            leftElement={(
                                                <CommanderSessionAvatar
                                                    machineId={machine.id}
                                                    commanderId={commander.id}
                                                    commanderName={commander.name}
                                                    size={29}
                                                />
                                            )}
                                            rightElement={(
                                                <Ionicons name="camera-outline" size={22} color="#007AFF" />
                                            )}
                                            loading={uploading === identity}
                                            disabled={uploading !== null}
                                            onPress={() => void choosePicture(machine, commander)}
                                            showChevron={false}
                                        />
                                    );
                                });
                return (
                    <ItemGroup
                        key={machine.id}
                        title={machineName(machine)}
                        footer={machineIndex === machines.length - 1
                            ? t('happyHerd.commanderAvatars.description')
                            : undefined}
                    >
                        {rows}
                    </ItemGroup>
                );
            })}
        </>
    );
}
