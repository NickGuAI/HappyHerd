import React from 'react';
import { useRoute } from '@react-navigation/native';
import { SessionView } from '@/-session/SessionView';
import { perfMark } from '@/utils/perfLog';

export default React.memo(() => {
    const route = useRoute();
    const params = route.params! as { id: string; focusMessageId?: string };
    React.useMemo(() => perfMark(`session-open:${params.id}`), [params.id]);
    return (<SessionView id={params.id} focusMessageId={params.focusMessageId} />);
});
