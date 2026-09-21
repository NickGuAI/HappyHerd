import * as React from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useCommanderAvatar } from '@/hooks/useCommanderAvatar';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { identityInitials } from '@/utils/sessionStatusAvatar';

export function CommanderSessionAvatar({
    machineId,
    commanderId,
    commanderName,
    accessible = true,
    size = 16,
}: {
    machineId: string | null;
    commanderId: string;
    commanderName?: string | null;
    accessible?: boolean;
    size?: number;
}) {
    const { theme } = useUnistyles();
    const imageUrl = useCommanderAvatar(machineId, commanderId);
    const [failedImageUrl, setFailedImageUrl] = React.useState<string | null>(null);
    React.useEffect(() => setFailedImageUrl(null), [commanderId, imageUrl, machineId]);
    const renderableImageUrl = imageUrl === failedImageUrl ? null : imageUrl;
    const handleImageError = React.useCallback(() => {
        if (imageUrl) setFailedImageUrl(imageUrl);
    }, [imageUrl]);
    const label = commanderName?.trim() || commanderId;
    const circleStyle = {
        width: size,
        height: size,
        borderRadius: size / 2,
    };

    return renderableImageUrl ? (
        <Image
            accessible={accessible}
            accessibilityLabel={accessible ? label : undefined}
            accessibilityRole={accessible ? 'image' : undefined}
            source={{ uri: renderableImageUrl }}
            cachePolicy={renderableImageUrl.startsWith('data:') ? 'memory' : 'disk'}
            contentFit="cover"
            onError={handleImageError}
            style={circleStyle}
        />
    ) : (
        <View
            accessible={accessible}
            accessibilityLabel={accessible ? label : undefined}
            accessibilityRole={accessible ? 'image' : undefined}
            style={[
                styles.initials,
                circleStyle,
                { backgroundColor: theme.colors.surfaceHighest },
            ]}
        >
            <Text
                allowFontScaling={false}
                style={[
                    styles.initialsText,
                    {
                        color: theme.colors.text,
                        fontSize: Math.max(8, Math.round(size * 0.36)),
                        lineHeight: Math.max(10, Math.round(size * 0.44)),
                    },
                ]}
            >
                {identityInitials(commanderName, commanderId)}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create(() => ({
    initials: {
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    initialsText: {
        textAlign: 'center',
        ...Typography.default('semiBold'),
    },
}));
