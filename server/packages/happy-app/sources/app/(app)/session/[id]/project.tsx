import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Modal } from '@/modal';
import { sync } from '@/sync/sync';
import { useProjects, useSession } from '@/sync/storage';
import { t } from '@/text';

const projectText = t as (key: string, params?: Record<string, string | number>) => string;

export default function SessionProjectScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { theme } = useUnistyles();
    const session = useSession(id);
    const projectsById = useProjects();
    const [busy, setBusy] = React.useState(false);
    const projects = React.useMemo(() => (
        Object.values(projectsById)
            .filter((project) => project.kind === 'personal')
            .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    ), [projectsById]);
    const selectedProjectId = session?.projectId ?? null;

    const assign = React.useCallback(async (projectId: string | null) => {
        if (!session || busy || selectedProjectId === projectId) return;
        setBusy(true);
        try {
            await sync.assignSessionProject(session.id, projectId);
            router.back();
        } catch {
            Modal.alert(t('common.error'), t('happyHerd.automations.unknownError'));
        } finally {
            setBusy(false);
        }
    }, [busy, router, selectedProjectId, session]);

    const createAndAssign = React.useCallback(async () => {
        if (!session || busy) return;
        const name = await Modal.prompt(
            projectText('projects.createTitle'),
            projectText('projects.createPrompt'),
            { confirmText: projectText('projects.create') },
        );
        if (!name?.trim()) return;
        setBusy(true);
        try {
            const project = await sync.createProject(name);
            await sync.assignSessionProject(session.id, project.id);
            router.back();
        } catch {
            Modal.alert(t('common.error'), t('happyHerd.automations.unknownError'));
        } finally {
            setBusy(false);
        }
    }, [busy, router, session]);

    if (!session) return <View style={{ flex: 1, backgroundColor: theme.colors.groupped.background }} />;

    const checkmark = <Ionicons name="checkmark" size={22} color={theme.colors.textLink} />;
    return (
        <ItemList>
            <ItemGroup title={projectText('projects.project')}>
                <Item
                    title={projectText('projects.noProject')}
                    icon={<Ionicons name="folder-open-outline" size={29} color={theme.colors.textSecondary} />}
                    rightElement={selectedProjectId === null ? checkmark : undefined}
                    showChevron={false}
                    disabled={busy}
                    onPress={() => assign(null)}
                />
                {projects.map((project) => (
                    <Item
                        key={project.id}
                        title={project.name}
                        icon={<Ionicons name="folder-outline" size={29} color={theme.colors.textLink} />}
                        rightElement={selectedProjectId === project.id ? checkmark : undefined}
                        showChevron={false}
                        disabled={busy}
                        onPress={() => assign(project.id)}
                    />
                ))}
            </ItemGroup>
            <ItemGroup>
                <Item
                    title={projectText('projects.create')}
                    icon={<Ionicons name="add-circle-outline" size={29} color={theme.colors.textLink} />}
                    loading={busy}
                    disabled={busy}
                    onPress={createAndAssign}
                />
            </ItemGroup>
        </ItemList>
    );
}
