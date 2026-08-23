import * as React from 'react';

import type { WorkspaceLinkRoute } from '@/utils/markdownWorkspaceLink';

export type WorkspaceLinkPressHandler = (route: WorkspaceLinkRoute) => void;

export const WorkspaceLinkPressContext = React.createContext<WorkspaceLinkPressHandler | undefined>(undefined);

export function useWorkspaceLinkPress(): WorkspaceLinkPressHandler | undefined {
    return React.useContext(WorkspaceLinkPressContext);
}
