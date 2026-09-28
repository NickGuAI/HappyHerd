/** The mock's brand mark: molten on the dark bar, bronze on paper. */
export function herdBrandMarkFill(theme: { dark: boolean; colors: { kilv: { moltenCore: string; molten: string; moltenDeep: string; accent: string; accentHot: string } } }): string {
    const k = theme.colors.kilv;
    return theme.dark
        ? `linear-gradient(160deg, ${k.moltenCore} 5%, ${k.molten} 45%, ${k.moltenDeep} 92%)`
        : `linear-gradient(160deg, ${k.accent}, ${k.accentHot})`;
}
