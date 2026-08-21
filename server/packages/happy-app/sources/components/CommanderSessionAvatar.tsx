import * as React from 'react';

import { useCommanderAvatar } from '@/hooks/useCommanderAvatar';
import { Avatar } from './Avatar';

export function CommanderSessionAvatar({
    machineId,
    commanderId,
    refreshKey,
    size = 16,
}: {
    machineId: string | null;
    commanderId: string;
    refreshKey?: string;
    size?: number;
}) {
    const imageUrl = useCommanderAvatar(machineId, commanderId, refreshKey);
    const [failedImageUrl, setFailedImageUrl] = React.useState<string | null>(null);
    React.useEffect(() => setFailedImageUrl(null), [commanderId, machineId, refreshKey]);
    const renderableImageUrl = imageUrl === failedImageUrl ? null : imageUrl;
    const handleImageError = React.useCallback(() => {
        if (imageUrl) setFailedImageUrl(imageUrl);
    }, [imageUrl]);
    return (
        <Avatar
            id={`commander:${machineId ?? 'unknown'}:${commanderId}`}
            imageUrl={renderableImageUrl}
            onImageError={renderableImageUrl ? handleImageError : undefined}
            flavor={null}
            size={size}
        />
    );
}
