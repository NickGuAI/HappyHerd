const { build } = require('esbuild');
const { existsSync, readFileSync } = require('node:fs');
const { resolve, dirname } = require('node:path');

const appRoot = resolve(__dirname, '../../..');
const stubs = {
    '@/sync/storage': `export const storage = { getState: () => ({ sessions: { A: { id: 'A' }, B: { id: 'B' }, C: { id: 'C' } } }) };`,
    '@/sync/sync': `export const sync = { preloadSession() {} };`,
    '@/track': `export const trackSessionSwitched = () => {};`,
    '@/utils/perfLog': `export const perfMark = () => {};`,
    '@/utils/platform': `export const isRunningOnMac = () => false;`,
    '@/components/herd/shell/phoneShell': `export const useHerdPhoneShell = { getState: () => ({ closeDrawer() {} }) };`,
};

exports.buildFixture = () => build({
    stdin: {
        contents: readFileSync(resolve(__dirname, 'sessionRouterFixture.tsx'), 'utf8'),
        resolveDir: appRoot,
        loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    mainFields: ['browser', 'module', 'main'],
    resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'],
    loader: { '.js': 'jsx', '.png': 'dataurl', '.ttf': 'dataurl' },
    define: {
        __DEV__: 'false',
        'process.env.EXPO_OS': '"web"',
        'process.env.NODE_ENV': '"production"',
        'process.env.EXPO_ROUTER_IMPORT_MODE': '"sync"',
        'process.env.EXPO_BASE_URL': '""',
        'process.env.APP_MANIFEST': '{}',
    },
    plugins: [{
        name: 'actual-expo-router',
        setup(builder) {
            builder.onResolve({ filter: /.*/ }, args => {
                if (stubs[args.path]) return { path: args.path, namespace: 'data-fixture' };
                if (args.path === 'react-native') return { path: require.resolve('react-native-web') };
                if (args.path.startsWith('@/')) {
                    const base = resolve(appRoot, 'sources', args.path.slice(2));
                    const path = [base + '.web.tsx', base + '.ts', base + '.tsx'].find(existsSync);
                    if (!path) throw new Error('Missing router fixture source: ' + args.path);
                    return { path };
                }
                if (args.path.startsWith('.') && args.path.endsWith('.js')) {
                    const web = resolve(dirname(args.importer), args.path.slice(0, -3) + '.web.js');
                    if (existsSync(web)) return { path: web };
                }
            });
            builder.onLoad({ filter: /.*/, namespace: 'data-fixture' }, args => ({
                contents: stubs[args.path], loader: 'tsx', resolveDir: appRoot,
            }));
        },
    }],
});
