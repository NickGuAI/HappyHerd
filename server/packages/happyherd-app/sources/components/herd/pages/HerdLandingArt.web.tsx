import * as React from 'react';
import { Asset } from 'expo-asset';
import { useUnistyles } from 'react-native-unistyles';
import { herdAlpha } from '@/components/herd/session/color';

const LOGO = require('@/assets/images/logo-black.png');

/** Mixes `color` into `base` by `percent`, keeping theme tokens in the CSS. */
function mix(color: string, percent: number, base: string): string {
    return `color-mix(in srgb, ${color} ${percent}%, ${base})`;
}

/**
 * The landing's horizon (UI overhaul, from the approved mock): a planet-sized
 * ellipse rising 160 px above the bottom edge, its dark body fading into the
 * page, lit by a molten rim that is masked to the middle of the arc and a soft
 * rim-blue glow above it. Decorative and inert.
 */
export function HerdHorizon() {
    const { theme } = useUnistyles();
    const k = theme.colors.kilv;
    const body = theme.dark
        ? `radial-gradient(ellipse 55% 30% at 50% 0%, ${mix(k.bgRaised, 55, k.bg)} 0%, ${mix(k.bgRaised, 17, k.bg)} 45%, ${k.bg} 75%)`
        : `radial-gradient(ellipse 55% 30% at 50% 0%, ${k.bgSunken} 0%, ${mix(k.bgSunken, 50, k.bg)} 45%, ${k.bg} 75%)`;
    const rim = theme.dark
        ? [
            `0 -1.5px 0 0 ${herdAlpha(k.moltenCore, 0.9)}`,
            `0 -5px 14px ${herdAlpha(k.molten, 0.5)}`,
            `0 -24px 64px ${herdAlpha(k.molten, 0.2)}`,
            `0 -80px 190px ${herdAlpha(k.rim, 0.28)}`,
        ].join(', ')
        : [
            `0 -1.5px 0 0 ${herdAlpha(k.accent, 0.7)}`,
            `0 -6px 18px ${herdAlpha(k.seamGlow, 0.6)}`,
            `0 -40px 90px ${herdAlpha(k.seamGlow, 0.32)}`,
        ].join(', ');
    const arcMask = 'linear-gradient(90deg, transparent 25%, #000 41%, #000 59%, transparent 75%)';
    return (
        <div
            aria-hidden
            data-testid="herd-landing-horizon"
            style={{ position: 'absolute', left: '50%', bottom: -1400, width: 2600, height: 1560, marginLeft: -1300, pointerEvents: 'none' }}
        >
            <div
                data-testid="herd-landing-horizon-atmosphere"
                style={{
                    position: 'absolute', left: '20%', right: '20%', top: -300, height: 600,
                    background: `radial-gradient(ellipse 50% 46% at 50% 56%, ${herdAlpha(k.rim, 0.2)}, ${herdAlpha(k.rim, 0)} 72%)`,
                }}
            />
            <div data-testid="herd-landing-horizon-body" style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: body }} />
            <div
                data-testid="herd-landing-horizon-rim"
                className="herd-fade"
                style={{
                    position: 'absolute', inset: 0, borderRadius: '50%', boxShadow: rim,
                    WebkitMaskImage: arcMask, maskImage: arcMask, animationDuration: '1.2s',
                }}
            />
        </div>
    );
}

/** The brush mark, filled with the molten gradient through the logo's alpha. */
export function HerdBrandMark({ size }: { size: number }) {
    const { theme } = useUnistyles();
    const k = theme.colors.kilv;
    const uri = React.useMemo(() => Asset.fromModule(LOGO).uri, []);
    const fill = theme.dark
        ? `linear-gradient(160deg, ${k.moltenCore} 5%, ${k.molten} 45%, ${k.moltenDeep} 92%)`
        : `linear-gradient(160deg, ${k.accent}, ${k.accentHot})`;
    const mask = `url("${uri}") center / contain no-repeat`;
    return (
        <div
            aria-hidden
            data-testid="herd-landing-mark"
            style={{ width: size, height: size, flex: 'none', background: fill, WebkitMask: mask, mask }}
        />
    );
}
