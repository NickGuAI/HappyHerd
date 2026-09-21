import { writeFileSync } from 'node:fs';
import { darkTheme, lightTheme } from './theme';

/** Reference exports only. Runtime consumers import theme.ts via Unistyles. */
export function generateTheme() {
    writeFileSync('./sources/theme.light.json', `${JSON.stringify(lightTheme, null, 2)}\n`);
    writeFileSync('./sources/theme.dark.json', `${JSON.stringify(darkTheme, null, 2)}\n`);
}

generateTheme();
