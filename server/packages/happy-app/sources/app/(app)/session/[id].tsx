import * as React from 'react';
import { useRoute } from "@react-navigation/native";
import { SessionView } from '@/-session/SessionView';


export default React.memo(() => {
    const route = useRoute();
    const params = route.params! as { id: string; focusMessageId?: string };
    return (<SessionView id={params.id} focusMessageId={params.focusMessageId} />);
});
