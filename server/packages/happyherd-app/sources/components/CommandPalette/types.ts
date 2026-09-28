import type { HerdShellIconName } from '@/components/herd/shell/HerdShellIcon';

export interface Command {
    id: string;
    title: string;
    subtitle?: string;
    icon?: string;
    /** One of the shell's own glyphs, drawn in place of `icon`. */
    glyph?: HerdShellIconName;
    shortcut?: string;
    category?: string;
    action: () => void | Promise<void>;
}

export interface CommandCategory {
    id: string;
    title: string;
    commands: Command[];
}