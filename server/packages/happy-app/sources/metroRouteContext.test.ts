import { expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

it('keeps production routes and excludes colocated tests from actual Metro route contexts', async () => {
    const config = require('../metro.config.js');
    const createFileMap = require('metro/private/node-haste/DependencyGraph/createFileMap').default;
    const cacheDirectory = await mkdtemp(join(tmpdir(), 'happyherd-metro-routes-'));
    const routeRoot = join(appRoot, 'sources', 'app');
    const colocatedTests = (await readdir(routeRoot, { recursive: true }))
        .filter(file => /\.(test|spec)\.[jt]sx?$/.test(file));
    // Use Metro's actual crawler/context matcher, with a private cache and no
    // watcher. Only the crawl roots/dependency extraction are narrowed for cost.
    const { fileMap } = createFileMap({
        ...config,
        watchFolders: [join(appRoot, 'sources')],
        fileMapCacheDirectory: cacheDirectory,
        maxWorkers: 1,
        resetCache: true,
        resolver: { ...config.resolver, useWatchman: false },
    }, { watch: false, extractDependencies: false });

    try {
        const { fileSystem } = await fileMap.build();
        expect(colocatedTests.length).toBeGreaterThan(0);
        for (const platform of ['ios', 'android', 'web']) {
            // Match the installed Expo Router's actual require.context filter.
            const contextSource = await readFile(require.resolve(`expo-router/_ctx.${platform}.js`), 'utf8');
            const literal = contextSource.match(/^\s*\/(.+)\/([a-z]*),\s*$/m);
            if (!literal) throw new Error(`Missing Expo ${platform} context filter`);
            const contextFiles = new Set([...fileSystem.matchFiles({
                rootDir: routeRoot, recursive: true,
                filter: new RegExp(literal[1], literal[2]),
                filterComparePosix: true, follow: true,
            })].map((file: string) => relative(routeRoot, file).replaceAll('\\', '/')));
            expect(contextFiles.has('(app)/new/index.tsx')).toBe(true);
            expect(contextFiles.has('(app)/session/[id]/info.tsx')).toBe(true);
            expect(contextFiles.has('(app)/settings/agents.tsx')).toBe(true);
            for (const file of colocatedTests) {
                expect(contextFiles.has(file.replaceAll('\\', '/'))).toBe(false);
            }
        }
        // This is a route-root exclusion, not a blanket change to test discovery.
        const componentTests = [...fileSystem.matchFiles({
            rootDir: join(appRoot, 'sources', 'components'), recursive: true,
            filter: /\.test\.ts$/, filterComparePosix: true, follow: true,
        })];
        expect(componentTests.some((file: string) => file.endsWith('SidebarNavigationButton.test.ts'))).toBe(true);
    } finally {
        await fileMap.end();
        await rm(cacheDirectory, { recursive: true, force: true });
    }
}, 30_000);
