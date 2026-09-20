import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { appRoot, repoRoot } from './kilv-capture/common.mjs';

const require = createRequire(resolve(appRoot, 'package.json'));
const { PNG } = require('pngjs');
const { default: pixelmatch } = await import(require.resolve('pixelmatch'));
const { chromium } = require('playwright-core');
const mode = process.argv[2] ?? 'compare';
if (!['compare', 'regenerate', 'one-pixel'].includes(mode)) throw new Error(`Unknown mode: ${mode}`);
const output = resolve(repoRoot, '.artifacts/kilv-golden');
const baseline = resolve(repoRoot, 'docs/acceptance/issue-287/golden');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const env = { ...process.env, KILV_OUTPUT_DIR: output, KILV_GOLDEN: '1', HAPPYHERD_BROWSER_EXECUTABLE: chromium.executablePath() };
// Five actual production-export panels plus two named fixture panels, each in
// desktop/mobile and light/dark. Review-gallery PNGs are never read or written.
execFileSync(process.execPath, ['scripts/kilv-capture/production.mjs'], { cwd: repoRoot, env, stdio: 'inherit' });
execFileSync(process.execPath, ['scripts/kilv-capture/routes.mjs', 'appearance,terminal'], { cwd: repoRoot, env, stdio: 'inherit' });
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
// Historical review capture scripts carry their original provenance. New CI
// artifacts must describe this run, without editing any historical records.
for (const file of ['production/manifest.json', 'routes/manifest.json', 'routes/environment-routes.json']) {
    const path = resolve(output, file);
    const data = JSON.parse(readFileSync(path));
    for (const record of Array.isArray(data) ? data : [data]) record.sourceRevision = sourceRevision;
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}
const rows = ['production', 'routes'].flatMap(group => JSON.parse(readFileSync(resolve(output, group, 'manifest.json'))).map(row => ({ group, filename: row.filename })));
if (rows.length !== 28) throw new Error(`Incomplete capture: expected 28 named variants, got ${rows.length}`);
let failed = 0;
const results = [];
for (const [index, row] of rows.entries()) {
    const name = `${row.group}-${row.filename}`;
    const actualPath = resolve(output, row.group, row.filename);
    const expectedPath = resolve(baseline, name);
    if (mode === 'regenerate') {
        mkdirSync(baseline, { recursive: true });
        copyFileSync(actualPath, expectedPath);
        continue;
    }
    if (!existsSync(expectedPath)) {
        failed++;
        results.push({ name, error: 'Missing committed baseline' });
        continue;
    }
    const actual = PNG.sync.read(readFileSync(actualPath));
    const expected = PNG.sync.read(readFileSync(expectedPath));
    if (mode === 'one-pixel' && index === 0) {
        // Mutate exactly one rendered screenshot pixel. This exercises the same
        // comparator and nonzero process exit as an ordinary visual regression.
        for (let channel = 0; channel < 3; channel++) actual.data[channel] = 255 - actual.data[channel];
        writeFileSync(actualPath, PNG.sync.write(actual));
    }
    const width = Math.max(actual.width, expected.width);
    const height = Math.max(actual.height, expected.height);
    const pad = image => {
        const canvas = new PNG({ width, height });
        PNG.bitblt(image, canvas, 0, 0, image.width, image.height, 0, 0);
        return canvas;
    };
    const diff = new PNG({ width, height });
    const pixels = pixelmatch(pad(expected).data, pad(actual).data, diff.data, width, height, { threshold: 0, includeAA: true });
    const dimensionsChanged = actual.width !== expected.width || actual.height !== expected.height;
    if (pixels || dimensionsChanged) {
        failed++;
        copyFileSync(expectedPath, resolve(output, `${name}-expected.png`));
        copyFileSync(actualPath, resolve(output, `${name}-actual.png`));
        writeFileSync(resolve(output, `${name}-diff.png`), PNG.sync.write(diff));
    }
    results.push({ name, pixels, dimensionsChanged });
}
const summary = { mode, sourceRevision, browser: require('playwright-core/package.json').version, variants: rows.length, failed, results };
writeFileSync(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
writeFileSync(resolve(output, 'index.html'), `<!doctype html><meta charset="utf-8"><title>KILV golden comparison</title><style>body{font:16px system-ui;margin:24px}section{margin:24px 0}img{max-width:32%;vertical-align:top;border:1px solid #aaa}pre{white-space:pre-wrap}</style><h1>KILV: ${failed} failures / ${rows.length} variants</h1><p>${summary.sourceRevision} · ${mode} · strict pixelmatch (zero differing pixels allowed)</p>` + results.filter(row => row.error || row.pixels || row.dimensionsChanged).map(row => `<section><h2>${row.name}</h2><p>${row.error ?? `${row.pixels} differing pixels; dimensions changed: ${row.dimensionsChanged}`}</p>${row.error ? '' : ['expected', 'actual', 'diff'].map(kind => `<a href="${row.name}-${kind}.png"><img alt="${kind}" src="${row.name}-${kind}.png"></a>`).join('')}</section>`).join(''));
console.log(JSON.stringify(summary, null, 2));
if (failed) process.exitCode = 1;
