import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import type { HerdTooltipAlign } from './HerdTooltip';

/**
 * The mock's hover tooltip (UI overhaul): a small raised label 8 px below its
 * control. It replaces the browser's native `title` tooltip, which the
 * browser places wherever the pointer happens to be.
 */
export function HerdTooltip({ label, hint, align = 'center', testID }: { label: string; hint?: string; align?: HerdTooltipAlign; testID?: string }) {
    const { theme } = useUnistyles();
    const horizontal: React.CSSProperties = align === 'start'
        ? { left: 0 }
        : align === 'end'
            ? { right: 0 }
            : { left: '50%', transform: 'translateX(-50%)' };
    return (
        <span
            role="tooltip"
            className="herd-fade"
            data-testid={testID ?? 'herd-tooltip'}
            style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                ...horizontal,
                zIndex: 90,
                padding: '5px 9px',
                borderRadius: 6,
                border: `1px solid ${theme.colors.kilv.rimLine}`,
                background: theme.colors.surface,
                color: theme.colors.text,
                fontFamily: 'SpaceGrotesk-Medium, system-ui, sans-serif',
                fontSize: 12,
                fontWeight: 500,
                lineHeight: '16px',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                boxShadow: theme.kilv.shadow,
            }}
        >
            {label}
            {hint ? (
                <span
                    data-testid="herd-tooltip-hint"
                    style={{ marginLeft: 8, fontFamily: 'JetBrainsMono-Regular, ui-monospace, monospace', fontSize: 11, color: theme.colors.kilv.inkFaint }}
                >
                    {hint}
                </span>
            ) : null}
        </span>
    );
}
