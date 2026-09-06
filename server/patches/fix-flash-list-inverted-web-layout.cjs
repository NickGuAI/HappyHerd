/** Keep FlashList's web origin in layout coordinates when the list is inverted. */
const fs = require('node:fs');
const path = require('node:path');

const roots = [
    path.resolve(__dirname, '..', 'node_modules', '@shopify', 'flash-list'),
    path.resolve(__dirname, '..', 'packages', 'happy-app', 'node_modules', '@shopify', 'flash-list'),
];
let patched = 0;
for (const root of roots) {
    for (const relative of ['src/recyclerview/utils/measureLayout.web.ts', 'dist/recyclerview/utils/measureLayout.web.js']) {
        const file = path.join(root, relative);
        if (!fs.existsSync(file)) continue;
        const source = fs.readFileSync(file, 'utf8');
        if (source.includes('const invertedY = transform.d < 0;')) continue;
        const anchor = 'const parentRect = parentView.getBoundingClientRect();';
        const x = 'x: childRect.left - parentRect.left + scrollOffsets.scrollX,';
        const y = 'y: childRect.top - parentRect.top + scrollOffsets.scrollY,';
        if (!source.includes(anchor) || !source.includes(x) || !source.includes(y)) {
            console.warn(`[fix-flash-list-inverted-web-layout] could not find measurement anchors in ${relative}, skipping`);
            continue;
        }
        const indentation = relative.endsWith('.ts') ? '  ' : '    ';
        const next = source
            .replace(anchor, anchor + '\n' + indentation
                + '// Inverted lists measure from the mirrored edge before adding scroll offsets.\n' + indentation
                + 'const transform = new DOMMatrixReadOnly(getComputedStyle(parentView).transform);\n' + indentation
                + 'const invertedX = transform.a < 0;\n' + indentation
                + 'const invertedY = transform.d < 0;')
            .replace(x, 'x: (invertedX ? parentRect.right - childRect.right : childRect.left - parentRect.left) + scrollOffsets.scrollX,')
            .replace(y, 'y: (invertedY ? parentRect.bottom - childRect.bottom : childRect.top - parentRect.top) + scrollOffsets.scrollY,');
        // pnpm may hardlink these files to its store. Replace the local path so
        // patching this install cannot change another checkout's dependency.
        const temporary = file + `.happyherd-${process.pid}.tmp`;
        fs.writeFileSync(temporary, next, 'utf8');
        fs.renameSync(temporary, file);
        patched++;
    }
}
if (patched > 0) console.log(`[fix-flash-list-inverted-web-layout] patched ${patched} file(s)`);
