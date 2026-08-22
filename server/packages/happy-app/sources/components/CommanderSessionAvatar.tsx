import * as React from 'react';

import { useCommanderAvatar } from '@/hooks/useCommanderAvatar';
import { Avatar } from './Avatar';
import { StatusPulse } from './StatusDot';

export function CommanderSessionAvatar({
    machineId,
    commanderId,
    isPulsing = false,
    size = 16,
}: {
    machineId: string | null;
    commanderId: string;
    isPulsing?: boolean;
    size?: number;
}) {
    const imageUrl = useCommanderAvatar(machineId, commanderId);
    const [failedImageUrl, setFailedImageUrl] = React.useState<string | null>(null);
    React.useEffect(() => setFailedImageUrl(null), [commanderId, imageUrl, machineId]);
    const renderableImageUrl = imageUrl === failedImageUrl ? null : imageUrl;
    const handleImageError = React.useCallback(() => {
        if (imageUrl) setFailedImageUrl(imageUrl);
    }, [imageUrl]);
    return (
        <StatusPulse isPulsing={isPulsing}>
            <Avatar
                id={`commander:${machineId ?? 'unknown'}:${commanderId}`}
                imageUrl={renderableImageUrl}
                onImageError={renderableImageUrl ? handleImageError : undefined}
                flavor={null}
                size={size}
            />
        </StatusPulse>
    );
}
