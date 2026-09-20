/**
 * KILV v3 — Warm Sun / Backlit. Unistyles is the runtime authority on every
 * platform; theme.gen.ts exports reference JSON from these same definitions.
 * The void belongs between panes; content belongs on the raised slate/paper.
 */
const kilvBrand = {
    moltenCore: '#FFF9EC',
    molten: '#F0DCB0',
    moltenDeep: '#C9AE85',
    rim: '#8FA3B8',
    steel: '#374756',
    olive: '#5E6B52',
    islandTop: '#241B0E',
    islandBottom: '#1A1309',
    islandInk: '#FBF4E4',
    islandBorder: 'rgba(240, 220, 176, 0.45)',
    islandGlow: 'rgba(240, 220, 176, 0.16)',
    islandDanger: '#FFADA0',
};

const lightPalette = {
    ...kilvBrand,
    bg: '#F7EFDD',
    bgRaised: '#FFF9EC',
    bgSunken: '#EFE5CE',
    stone: '#191307',
    stoneInk: '#FBF4E4',
    ink: '#14100A',
    inkDim: 'rgba(20, 16, 10, 0.76)',
    inkFaint: 'rgba(20, 16, 10, 0.5)',
    hair: 'rgba(20, 16, 10, 0.2)',
    rimLine: 'rgba(94, 77, 45, 0.4)',
    accent: '#8F6E36',
    accentHot: '#6E5222',
    accentInk: '#FFF9EC',
    seamGlow: 'rgba(176, 132, 66, 0.5)',
    scrim: 'rgba(2, 3, 5, 0.55)',
    scrimStrong: 'rgba(2, 3, 5, 0.88)',
};

const darkPalette: typeof lightPalette = {
    ...kilvBrand,
    bg: '#010204',
    bgRaised: '#151B28',
    bgSunken: '#000000',
    stone: '#1B2231',
    stoneInk: '#F7F4EC',
    ink: '#F7F4EC',
    inkDim: 'rgba(247, 244, 236, 0.88)',
    inkFaint: 'rgba(247, 244, 236, 0.62)',
    hair: 'rgba(247, 244, 236, 0.24)',
    rimLine: 'rgba(151, 172, 196, 0.5)',
    accent: '#F0DCB0',
    accentHot: '#FFF6E2',
    accentInk: '#171106',
    seamGlow: 'rgba(255, 241, 214, 0.55)',
    scrim: 'rgba(1, 2, 4, 0.55)',
    scrimStrong: 'rgba(1, 2, 4, 0.9)',
};

const sharedSpacing = {
    margins: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 },
    borderRadius: { sm: 4, md: 4, lg: 4, xl: 6, xxl: 6 },
    iconSize: { small: 12, medium: 16, large: 20, xlarge: 24 },
} as const;

function createTheme(dark: boolean, p: typeof lightPalette) {
    // Status and diff colors remain semantically distinguishable. These are
    // readable foregrounds on KILV surfaces, not a second decorative palette.
    // Exact light accent on paper is below 4.5:1 for small type. The v3
    // hot amber supplies the accessible text/filled-action treatment.
    const action = dark ? p.accent : p.accentHot;
    const danger = dark ? '#FFADA0' : '#A53225';
    const dangerSurface = dark ? '#462721' : '#F7DED4';
    const warning = dark ? '#FFD79D' : '#775519';
    const warningSurface = dark ? '#392C17' : '#F5E4BF';
    const info = dark ? '#AAC5DD' : '#405A72';
    const added = dark ? '#9ED4AE' : '#2F693E';
    const addedSurface = dark ? '#193629' : '#DEEADB';
    const addedStrong = dark ? '#284A37' : '#BAD8B6';
    const removedStrong = dark ? '#62382F' : '#EEC1B3';
    const syntax = {
        plain: p.ink,
        keyword: action,
        string: dark ? '#D8CEAA' : '#65582F',
        comment: p.inkDim,
        number: info,
        function: dark ? '#E3BC8F' : '#85572D',
        operator: info,
        punctuation: p.ink,
        type: dark ? '#DAC49C' : '#79592F',
        variable: p.ink,
        tag: action,
        attr: info,
    };

    return {
        dark,
        colors: {
            kilv: p,
            text: p.ink,
            textDestructive: danger,
            textSecondary: p.inkDim,
            textLink: action,
            deleteAction: danger,
            warningCritical: danger,
            warning,
            success: action,
            surface: p.bgRaised,
            surfaceRipple: dark ? 'rgba(240, 220, 176, 0.12)' : 'rgba(143, 110, 54, 0.1)',
            surfacePressed: dark ? p.stone : p.bgSunken,
            surfaceSelected: dark ? '#34332D' : '#E7D8B9',
            surfacePressedOverlay: dark ? 'rgba(240, 220, 176, 0.1)' : 'rgba(143, 110, 54, 0.08)',
            surfaceHigh: p.bgRaised,
            surfaceHighest: dark ? p.stone : p.bgSunken,
            divider: p.hair,
            shadow: { color: dark ? '#000000' : '#3A2A12', opacity: dark ? 0.7 : 0.16 },
            glass: {
                background: dark ? 'rgba(21, 27, 40, 0.94)' : 'rgba(255, 249, 236, 0.94)',
                backgroundStrong: p.bgRaised,
                backgroundSubtle: dark ? 'rgba(247, 244, 236, 0.06)' : 'rgba(20, 16, 10, 0.04)',
                // These are content materials (popovers, sheets, autocomplete).
                // Artwork/backdrop scrims use colors.kilv.scrim explicitly.
                overlay: dark ? 'rgba(21, 27, 40, 0.94)' : 'rgba(255, 249, 236, 0.94)',
                overlayTint: dark ? 'rgba(21, 27, 40, 0.68)' : 'rgba(255, 249, 236, 0.68)',
                border: p.rimLine,
                divider: p.hair,
                highlight: dark ? 'rgba(143, 163, 184, 0.3)' : 'rgba(255, 249, 236, 0.7)',
                shadow: dark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(58, 42, 18, 0.16)',
                tint: dark ? 'rgba(143, 163, 184, 0.05)' : 'rgba(143, 110, 54, 0.04)',
                backdrop: [p.bg, p.bg, p.bg] as readonly [string, string, string],
                glowPrimary: 'transparent',
                glowSecondary: 'transparent',
            },
            groupped: { background: p.bg, chevron: p.inkDim, sectionTitle: action },
            header: { background: p.bgRaised, tint: p.ink },
            switch: {
                track: { active: p.accent, inactive: p.hair },
                thumb: { active: p.accentInk, inactive: p.inkDim },
            },
            fab: { background: p.accent, backgroundPressed: p.accentHot, icon: p.accentInk },
            radio: { active: p.accent, inactive: p.rimLine, dot: p.accent },
            modal: { border: p.rimLine },
            button: {
                primary: { background: action, tint: p.accentInk, disabled: dark ? '#626159' : '#B5A581' },
                secondary: { tint: p.inkDim },
            },
            input: { background: p.bgSunken, text: p.ink, placeholder: p.inkDim },
            box: {
                warning: { background: warningSurface, border: warning, text: warning },
                error: { background: dangerSurface, border: danger, text: danger },
            },
            status: {
                connected: action,
                connecting: info,
                disconnected: p.inkDim,
                error: danger,
                default: p.inkDim,
            },
            permission: {
                default: p.inkDim,
                acceptEdits: info,
                bypass: warning,
                plan: action,
                readOnly: p.inkDim,
                safeYolo: warning,
                yolo: danger,
            },
            permissionButton: {
                allow: { background: action, text: p.accentInk },
                deny: { background: danger, text: dark ? p.bgSunken : p.bgRaised },
                allowAll: { background: info, text: dark ? p.bgSunken : p.bgRaised },
                inactive: { background: p.bgRaised, border: p.rimLine, text: p.inkDim },
                selected: { background: p.bgSunken, border: p.accent, text: p.ink },
            },
            diff: {
                outline: p.rimLine,
                success: added,
                error: danger,
                addedBg: addedSurface,
                addedBorder: added,
                addedText: p.ink,
                removedBg: dangerSurface,
                removedBorder: danger,
                removedText: p.ink,
                contextBg: p.bgRaised,
                contextText: p.inkDim,
                lineNumberBg: p.bgRaised,
                lineNumberText: p.inkDim,
                hunkHeaderBg: p.bgSunken,
                hunkHeaderText: action,
                leadingSpaceDot: p.hair,
                inlineAddedBg: addedStrong,
                inlineAddedText: p.ink,
                inlineRemovedBg: removedStrong,
                inlineRemovedText: p.ink,
                rowAddedBg: addedSurface,
                rowRemovedBg: dangerSurface,
                rowContextBg: 'transparent',
                gutterAddedBg: addedStrong,
                gutterRemovedBg: removedStrong,
                gutterContextBg: 'transparent',
                gutterBorder: p.hair,
                markerAdded: added,
                markerRemoved: danger,
                wordAddedBg: addedStrong,
                wordRemovedBg: removedStrong,
                sectionText: p.inkDim,
                syntax,
            },
            userMessageBackground: dark ? p.stone : p.bgSunken,
            userMessageText: p.ink,
            agentMessageText: p.ink,
            agentEventText: p.inkDim,
            syntaxKeyword: syntax.keyword,
            syntaxString: syntax.string,
            syntaxComment: syntax.comment,
            syntaxNumber: syntax.number,
            syntaxFunction: syntax.function,
            syntaxBracket1: action,
            syntaxBracket2: info,
            syntaxBracket3: syntax.string,
            syntaxBracket4: syntax.function,
            syntaxBracket5: syntax.type,
            syntaxDefault: syntax.plain,
            gitBranchText: p.inkDim,
            gitFileCountText: p.inkDim,
            gitAddedText: added,
            gitRemovedText: danger,
            terminal: {
                background: p.bgSunken,
                prompt: action,
                command: p.ink,
                stdout: p.ink,
                stderr: warning,
                error: danger,
                emptyOutput: p.inkDim,
            },
        },
        kilv: {
            radius: 4,
            radiusCard: 6,
            gutter: 24,
            rail: 1180,
            tick: 26,
            tickInset: 10,
            focusRing: 2,
            focusOffset: 2,
            focusHalo: 3,
            disabledOpacity: 0.45,
            motion: 150,
            glowMolten: '0 0 10px rgba(255, 246, 226, 0.65), 0 0 34px rgba(240, 220, 176, 0.32)',
            glowMoltenSoft: '0 0 22px rgba(240, 220, 176, 0.22)',
            glowRim: '0 0 14px rgba(143, 163, 184, 0.22)',
            shadow: dark ? '0 22px 70px rgba(0, 0, 0, 0.7)' : '0 12px 34px rgba(58, 42, 18, 0.16)',
        },
        ...sharedSpacing,
    };
}

export const lightTheme = createTheme(false, lightPalette);
export const darkTheme = createTheme(true, darkPalette);
export type Theme = typeof lightTheme;
