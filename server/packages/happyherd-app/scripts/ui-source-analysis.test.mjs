import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { analyzeUiSources } from './ui-source-analysis.mjs';

const packageRoot = await mkdtemp(join(tmpdir(), 'happyherd-ui-analysis-'));

try {
    await mkdir(join(packageRoot, 'sources/app/(app)'), { recursive: true });
    await mkdir(join(packageRoot, 'sources/components'), { recursive: true });
    await mkdir(join(packageRoot, 'sources/dev'), { recursive: true });

    await writeFile(join(packageRoot, 'sources/app/(app)/index.tsx'), `
        const t = (key: string) => key;
        export default function Home() {
            return <Text accessibilityLabel={active ? 'Collapse details' : 'Expand details'}>
                {t(active ? 'common.active' : 'common.inactive')}
            </Text>;
        }
    `);
    await writeFile(join(packageRoot, 'sources/components/Widget.ts'), `
        export const widgetDescriptor = {
            title: 'Widget title',
            searchPlaceholder: 'Search widgets…',
            model: 'gpt-5.6-sol',
        };
    `);
    await writeFile(join(packageRoot, 'sources/dev/Debug.tsx'), `
        export default function Debug() { return <Text>Development only</Text>; }
    `);

    const analysis = await analyzeUiSources({ packageRoot });
    assert.equal(analysis.routes.length, 1);
    assert.equal(analysis.routes[0].path, '/');
    assert.equal(analysis.surfaces.some((surface) => surface.owner === 'sources/dev/Debug.tsx'), false);
    assert.deepEqual(
        analysis.hardcodedCopy.map((finding) => finding.text).sort(),
        ['Collapse details', 'Expand details', 'Search widgets…', 'Widget title'],
    );
    assert.equal(analysis.hardcodedCopy.some((finding) => finding.text === 'gpt-5.6-sol'), false);
    assert.deepEqual(analysis.routes[0].translationKeys, ['common.active', 'common.inactive']);
    console.log('[ui-analysis] AST fixture coverage passed');
} finally {
    await rm(packageRoot, { recursive: true, force: true });
}
