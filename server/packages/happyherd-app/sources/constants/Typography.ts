import { Platform } from 'react-native';

/** KILV: Space Grotesk for UI/prose, JetBrains Mono for code, paths and status. */
export const FontFamilies = {
  default: {
    regular: 'SpaceGrotesk-Regular',
    italic: 'SpaceGrotesk-Regular',
    semiBold: 'SpaceGrotesk-SemiBold',
  },
  mono: {
    regular: 'JetBrainsMono-Regular',
    italic: 'JetBrainsMono-Regular',
    semiBold: 'JetBrainsMono-SemiBold',
  },
  logo: { bold: 'SpaceGrotesk-Medium' },
  legacy: {
    spaceMono: 'JetBrainsMono-Regular',
    systemMono: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
};

type FontWeight = 'regular' | 'italic' | 'semiBold';

export const getDefaultFont = (weight: FontWeight = 'regular') => FontFamilies.default[weight];
export const getMonoFont = (weight: FontWeight = 'regular') => FontFamilies.mono[weight];
export const getLogoFont = () => FontFamilies.logo.bold;

export const FontWeights = { regular: '400', semiBold: '600', bold: '700' } as const;

// The supplied typefaces have upright faces. Preserve italic content with
// platform obliquing, without substituting a different typeface.
const fontStyle = (weight: FontWeight) => weight === 'italic' ? { fontStyle: 'italic' as const } : {};

export const Typography = {
  default: (weight: FontWeight = 'regular') => ({ fontFamily: getDefaultFont(weight), ...fontStyle(weight) }),
  mono: (weight: FontWeight = 'regular') => ({ fontFamily: getMonoFont(weight), ...fontStyle(weight) }),
  logo: () => ({ fontFamily: getLogoFont() }),
  header: () => ({ fontFamily: getDefaultFont('semiBold') }),
  body: () => ({ fontFamily: getDefaultFont() }),
  tag: () => ({ fontFamily: getMonoFont('semiBold'), fontSize: 11, letterSpacing: 2.42 }),
  legacy: {
    spaceMono: () => ({ fontFamily: FontFamilies.legacy.spaceMono }),
    systemMono: () => ({ fontFamily: FontFamilies.legacy.systemMono }),
  },
};
