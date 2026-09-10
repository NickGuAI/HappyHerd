import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Modal } from '@/modal';
import { sync } from '@/sync/sync';
import { getSessionProjectId } from '@/sync/projectTypes';
import { useAllSessions, useProjects } from '@/sync/storage';
import { t } from '@/text';

const projectText = t as (key: string, params?: Record<string, string | number>) => string;

export default function ProjectsScreen() {
    const { theme } = useUnistyles();
    const projectsById = useProjects();
    const sessions = useAllSessions();
    const [busyProjectId, setBusyProjectId] = React.useState<string | null>(null);
    const projects = React.useMemo(() => (
        Object.values(projectsById)
            .filter((project) => project.kind === 'personal')
            .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    ), [projectsById]);
    const sessionCounts = React.useMemo(() => {
        const counts = new Map<string, number>();
        for (const session of sessions) {
            const projectId = getSessionProjectId(session);
            if (projectId) counts.set(projectId, (counts.get(projectId) ?? 0) + 1);
        }
        return counts;
    }, [sessions]);

    const createProject = React.useCallback(async () => {
        const name = await Modal.prompt(
            projectText('projects.createTitle'),
            projectText('projects.createPrompt'),
            { confirmText: projectText('projects.create') },
        );
        if (!name?.trim()) return;
        setBusyProjectId('create');
        try {
            await sync.createProject(name);
        } catch {
            Modal.alert(t('common.error'), t('happyHerd.automations.unknownError'));
        } finally {
            setBusyProjectId(null);
        }
    }, []);

    const renameProject = React.useCallback(async (projectId: string, currentName: string) => {
        const name = await Modal.prompt(
            projectText('projects.renameTitle'),
            projectText('projects.renamePrompt', { name: currentName }),
            { defaultValue: currentName, confirmText: t('common.rename') },
        );
        if (!name?.trim() || name.trim() === currentName) return;
        setBusyProjectId(projectId);
        try {
            await sync.renameProject(projectId, name);
        } catch {
            Modal.alert(t('common.error'), t('happyHerd.automations.unknownError'));
        } finally {
            setBusyProjectId(null);
        }
    }, []);

    return (
        <ItemList>
            <ItemGroup
                footer={projects.length === 0 ? projectText('projects.emptyDescription') : undefined}
            >
                <Item
                    title={projectText('projects.create')}
                    icon={<Ionicons name="add-circle-outline" size={29} color={theme.colors.textLink} />}
                    loading={busyProjectId === 'create'}
                    disabled={busyProjectId !== null}
                    onPress={createProject}
                />
                {projects.map((project) => {
                    const count = sessionCounts.get(project.id) ?? 0;
                    return (
                        <Item
                            key={project.id}
                            title={project.name}
                            subtitle={projectText('projects.sessionCount', { count })}
                            icon={<Ionicons name="folder-outline" size={29} color={theme.colors.textLink} />}
                            loading={busyProjectId === project.id}
                            disabled={busyProjectId !== null}
                            onPress={() => renameProject(project.id, project.name)}
                        />
                    );
                })}
            </ItemGroup>
        </ItemList>
    );
}
