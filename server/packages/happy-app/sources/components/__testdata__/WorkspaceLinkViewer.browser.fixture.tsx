import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspaceLinkViewer } from '@/components/WorkspaceLinkViewer';

const reference = {
    mode: 'link' as const,
    originSessionId: 'linked-session',
    machineId: 'linked-machine',
    absolutePath: '/workspace/review.md',
    line: '3',
    column: '7',
};

createRoot(document.getElementById('root')!).render(
    <div style={{ display: 'flex', height: '100dvh' }}>
        <WorkspaceLinkViewer reference={reference} onFeedbackSent={() => {}} />
    </div>,
);
