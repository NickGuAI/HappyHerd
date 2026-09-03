import * as React from 'react';
import type { WorkspaceLiveElementPick } from '@/sync/workspaceLive';

export type LocalhostLiveViewProps = {
    machineId: string;
    url: string;
    pickerEnabled: boolean;
    onPick: (pick: WorkspaceLiveElementPick) => void;
    onError?: (error: Error) => void;
};

/** The live localhost surface is intentionally limited to Web Desktop and Web Mobile. */
export const LocalhostLiveView = React.memo(function LocalhostLiveView(_props: LocalhostLiveViewProps) {
    return null;
});
