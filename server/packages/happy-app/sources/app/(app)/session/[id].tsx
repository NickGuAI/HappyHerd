import React from 'react';
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { SessionView } from '@/-session/SessionView';
import { perfMark } from '@/utils/perfLog';

export default React.memo(() => {
    const route = useRoute();
    const navigation = useNavigation();
    const isFocused = useIsFocused();
    const params = route.params! as { id: string; focusMessageId?: string; openChangesRequestId?: string };
    React.useMemo(() => perfMark(`session-open:${params.id}`), [params.id]);
    const handleOpenChangesRequestConsumed = React.useCallback((requestId: string) => {
        if (params.openChangesRequestId !== requestId) return;
        navigation.setParams({ openChangesRequestId: undefined } as never);
    }, [navigation, params.openChangesRequestId]);
    return (
        <SessionView
            id={params.id}
            focusMessageId={params.focusMessageId}
            openChangesRequestId={isFocused ? params.openChangesRequestId : undefined}
            onOpenChangesRequestConsumed={handleOpenChangesRequestConsumed}
        />
    );
});
