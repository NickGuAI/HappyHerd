import * as React from 'react';

import type { HerdMaskImageProps } from './HerdMaskImage';

/** Expo's web build turns `require('x.png')` into `{ uri, width, height }` or a URL string. */
export function herdMaskImageUri(source: unknown): string | null {
    if (typeof source === 'string') return source;
    if (source && typeof source === 'object' && typeof (source as { uri?: unknown }).uri === 'string') {
        return (source as { uri: string }).uri;
    }
    return null;
}

/**
 * Web: the image's alpha masks a painted fill, as the mock's brand mark does.
 * expo-image tints on the web through an SVG `feFlood` filter referenced by
 * id; where that filter is not applied the black source image shows instead,
 * which is invisible on the dark top bar. A CSS mask has no such dependency.
 */
export function HerdMaskImage({ source, size, tint, fill, testID }: HerdMaskImageProps) {
    const uri = herdMaskImageUri(source);
    const mask = uri ? `url("${uri}") center / contain no-repeat` : undefined;
    return (
        <span
            data-testid={testID}
            data-herd-mask="true"
            aria-hidden="true"
            style={{
                display: 'block',
                flex: 'none',
                width: size,
                height: size,
                background: fill ?? tint,
                WebkitMask: mask,
                mask,
            }}
        />
    );
}
