const CSS_VARIABLE = /^var\(--[\w-]+\)$/;

/**
 * Token-derived translucency: glows, washes and translucent borders reuse
 * theme colors at a lower opacity instead of introducing new literals. On web
 * the Unistyles runtime hands style factories CSS variables
 * (`var(--colors-kilv-ink)`) so themes switch without recomputing styles;
 * those are mixed with `color-mix`. Native styles and the `useUnistyles()`
 * theme carry hex or rgb(a) values, which are converted to rgba.
 */
export function herdAlpha(color: string | null | undefined, opacity: number): string {
    if (typeof color !== 'string') return 'transparent';
    const value = color.trim();
    if (CSS_VARIABLE.test(value)) {
        const percent = Math.round(Math.min(Math.max(opacity, 0), 1) * 1000) / 10;
        return `color-mix(in srgb, ${value} ${percent}%, transparent)`;
    }
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
    if (hex) {
        const digits = hex[1].length === 3
            ? hex[1].split('').map((digit) => digit + digit).join('')
            : hex[1];
        const r = parseInt(digits.slice(0, 2), 16);
        const g = parseInt(digits.slice(2, 4), 16);
        const b = parseInt(digits.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
    const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value);
    if (rgb) {
        const base = rgb[4] === undefined ? 1 : Number(rgb[4]);
        return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${Math.round(base * opacity * 1000) / 1000})`;
    }
    return value;
}
