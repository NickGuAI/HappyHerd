import { darkTheme, lightTheme } from '@/theme';

export const USER_MESSAGE_BUBBLE_COLORS = ['gray', 'blue', 'green', 'purple', 'rose', 'sand'] as const;

export type UserMessageBubbleColor = typeof USER_MESSAGE_BUBBLE_COLORS[number];

export type UserMessageBubblePalette = {
    background: string;
    border: string;
    indicator: string;
};

export type UserMessageBubbleGlassPalette = {
    background: string;
    border: string;
    tint: string;
};

// The default follows the app palette; explicit user color choices remain available.
export const DEFAULT_USER_MESSAGE_BUBBLE_COLOR: UserMessageBubbleColor = 'gray';

const lightPalettes: Record<UserMessageBubbleColor, UserMessageBubblePalette> = {
    blue: {
        background: '#E8F2FF',
        border: '#9CC9FF',
        indicator: '#0A84FF',
    },
    green: {
        background: '#E9F7EF',
        border: '#96D6AE',
        indicator: '#34C759',
    },
    purple: {
        background: '#F0EBFF',
        border: '#B7A2FF',
        indicator: '#7D68CF',
    },
    rose: {
        background: '#FFF0F5',
        border: '#F3A4BF',
        indicator: '#D85D85',
    },
    sand: {
        background: '#F1E7D0',
        border: '#D9C292',
        indicator: '#B28B3D',
    },
    // KILV warm-paper well.
    gray: {
        background: lightTheme.colors.userMessageBackground,
        border: lightTheme.colors.divider,
        indicator: lightTheme.colors.kilv.steel,
    },
};

const darkPalettes: Record<UserMessageBubbleColor, UserMessageBubblePalette> = {
    blue: {
        background: '#17324D',
        border: '#2F6EA8',
        indicator: '#64B5FF',
    },
    green: {
        background: '#173A27',
        border: '#3D8B58',
        indicator: '#65D385',
    },
    purple: {
        background: '#2B214A',
        border: '#7D68CF',
        indicator: '#B8A8FF',
    },
    rose: {
        background: '#462232',
        border: '#C85E82',
        indicator: '#FF9DBB',
    },
    sand: {
        background: '#3A3326',
        border: '#8D7A55',
        indicator: '#E8C878',
    },
    // KILV lifted slate pane.
    gray: {
        background: darkTheme.colors.userMessageBackground,
        border: darkTheme.colors.divider,
        indicator: darkTheme.colors.kilv.rim,
    },
};

export function isUserMessageBubbleColor(value: unknown): value is UserMessageBubbleColor {
    return typeof value === 'string' && USER_MESSAGE_BUBBLE_COLORS.includes(value as UserMessageBubbleColor);
}

export function normalizeUserMessageBubbleColor(value: unknown): UserMessageBubbleColor {
    return isUserMessageBubbleColor(value) ? value : DEFAULT_USER_MESSAGE_BUBBLE_COLOR;
}

export function getNextUserMessageBubbleColor(value: unknown): UserMessageBubbleColor {
    const color = normalizeUserMessageBubbleColor(value);
    const currentIndex = USER_MESSAGE_BUBBLE_COLORS.indexOf(color);
    return USER_MESSAGE_BUBBLE_COLORS[(currentIndex + 1) % USER_MESSAGE_BUBBLE_COLORS.length];
}

export function resolveUserMessageBubbleColor(value: unknown, isDark: boolean): UserMessageBubblePalette {
    const color = normalizeUserMessageBubbleColor(value);
    return (isDark ? darkPalettes : lightPalettes)[color];
}

function withAlpha(hex: string, alpha: number): string {
    const normalized = hex.replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
        return hex;
    }

    const red = Number.parseInt(normalized.slice(0, 2), 16);
    const green = Number.parseInt(normalized.slice(2, 4), 16);
    const blue = Number.parseInt(normalized.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/**
 * Keeps the selected preset recognizable while turning it into a tint for a
 * translucent native glass surface instead of an opaque replacement fill.
 */
export function resolveUserMessageBubbleGlassColor(value: unknown, isDark: boolean): UserMessageBubbleGlassPalette {
    const color = normalizeUserMessageBubbleColor(value);
    const palette = resolveUserMessageBubbleColor(color, isDark);

    if (color === 'gray') {
        return {
            background: withAlpha(palette.background, isDark ? 0.34 : 0.48),
            border: isDark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.76)',
            tint: withAlpha(palette.indicator, isDark ? 0.08 : 0.10),
        };
    }

    return {
        background: withAlpha(palette.background, isDark ? 0.46 : 0.54),
        border: withAlpha(palette.border, isDark ? 0.56 : 0.70),
        tint: withAlpha(palette.indicator, isDark ? 0.18 : 0.14),
    };
}
