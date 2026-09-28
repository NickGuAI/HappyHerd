import * as React from 'react';
import { Platform } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

/**
 * The approved mock's shell icons (UI overhaul): 24 px grid, 1.7 stroke,
 * round caps and joins. The top bar and the left panel draw these rather
 * than the icon fonts so they match the mock line for line.
 */
export type HerdShellIconName =
    | 'panelLeft'
    | 'focus'
    | 'bell'
    | 'monitor'
    | 'chevronDown'
    | 'search'
    | 'split'
    | 'folders'
    | 'bolt'
    | 'pen'
    | 'archive'
    | 'unarchive'
    | 'gear'
    | 'x'
    | 'plus'
    | 'link';

function glyph(name: HerdShellIconName, color: string): React.ReactNode {
    switch (name) {
        case 'panelLeft':
            return <><Rect x={3.5} y={4.5} width={17} height={15} rx={2} /><Path d="M9.5 4.5v15" /></>;
        case 'focus':
            return <><Circle cx={12} cy={12} r={8.5} /><Path d="M12 3.5A8.5 8.5 0 0 1 20.5 12H12z" fill={color} stroke="none" /></>;
        case 'bell':
            return <><Path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14z" /><Path d="M10 20.5a2 2 0 0 0 4 0" /></>;
        case 'monitor':
            return <><Rect x={3} y={4} width={18} height={12} rx={1.5} /><Path d="M9 20h6M12 16v4" /></>;
        case 'chevronDown':
            return <Path d="M6 9l6 6 6-6" />;
        case 'search':
            return <><Circle cx={11} cy={11} r={6} /><Path d="M16 16l4 4" /></>;
        case 'split':
            return <><Rect x={3.5} y={4.5} width={17} height={15} rx={2} /><Path d="M12 4.5v15M15 9h3M15 12h3M6 9h3" /></>;
        case 'folders':
            return <><Path d="M6 8.5V5.5h5l1.5 1.5H20v9h-2" /><Path d="M3.5 9h5l1.5 1.5h7.5v8.5h-14z" /></>;
        case 'bolt':
            return <Path d="M13 3L5 13h6l-1 8 8-10h-6z" />;
        case 'pen':
            return <><Path d="M4 20h4L19 9l-4-4L4 16z" /><Path d="M13 7l4 4" /></>;
        case 'archive':
            return <><Rect x={3.5} y={4.5} width={17} height={4.5} rx={1} /><Path d="M5 9v10.5h14V9M10 13h4" /></>;
        case 'unarchive':
            return <><Rect x={3.5} y={4.5} width={17} height={4.5} rx={1} /><Path d="M5 9v10.5h14V9M12 18v-5.5M9.5 15l2.5-2.5 2.5 2.5" /></>;
        case 'gear':
            return <><Circle cx={12} cy={12} r={3} /><Path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></>;
        case 'x':
            return <Path d="M6 6l12 12M18 6L6 18" />;
        case 'plus':
            return <Path d="M12 5v14M5 12h14" />;
        case 'link':
            return <><Path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><Path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>;
    }
}

export function HerdShellIcon({ name, size = 18, color, strokeWidth = 1.7, testID }: {
    name: HerdShellIconName;
    size?: number;
    color: string;
    strokeWidth?: number;
    testID?: string;
}) {
    return (
        <Svg
            testID={testID}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            {...(Platform.OS === 'web' ? { 'aria-hidden': true, 'data-herd-icon': name } as object : { accessible: false })}
        >
            {glyph(name, color)}
        </Svg>
    );
}
