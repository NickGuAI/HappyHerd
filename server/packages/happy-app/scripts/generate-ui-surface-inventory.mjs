import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeUiSources } from './ui-source-analysis.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const textRoot = resolve(packageRoot, 'sources/text');
const inventoryPath = resolve(textRoot, 'ui-surface-inventory.json');
const treePath = resolve(textRoot, 'ui-tree.html');
const catalogs = Object.fromEntries(await Promise.all(['en', 'cn', 'de'].map(async (locale) => [
    locale,
    JSON.parse(await readFile(resolve(textRoot, `locales/${locale}.json`), 'utf8')),
])));
const analysis = await analyzeUiSources({ packageRoot });

const criticalSurfaces = [
    { id: 'new-session', route: '/new', keys: ['newSession.title', 'uiCopy.whatWouldYouLikeToWorkOn'] },
    { id: 'session', route: '/session/[id]', keys: ['session.inputPlaceholder', 'status.online'] },
    { id: 'workspace', route: '/workspace', keys: ['workspace.title', 'workspace.searchPlaceholder'] },
    { id: 'automations', route: '/automations', keys: ['happyHerd.automations.title', 'happyHerd.automations.subtitle'] },
    { id: 'account', route: '/settings/account', keys: ['settingsAccount.accountInformation', 'settingsAccount.analytics'] },
    { id: 'composer', owner: 'sources/components/AgentInput.tsx', keys: ['session.inputPlaceholder', 'happyHerd.composer.queueMessage'] },
];

function lookup(catalog, key) {
    let value = catalog;
    for (const segment of key.split('.')) value = value?.[segment];
    if (typeof value === 'string') return value;
    if (value?.select?.cases) return value.select.cases.other ?? Object.values(value.select.cases)[0];
    throw new Error(`Critical smoke key is missing or invalid: ${key}`);
}

const smokeMatrix = criticalSurfaces.flatMap((surface) => (
    ['en', 'cn', 'de'].flatMap((locale) => (
        ['mobile', 'desktop'].flatMap((viewport) => (
            ['light', 'dark'].map((theme) => ({
                surface: surface.id,
                owner: surface.owner ?? analysis.routes.find((route) => route.path === surface.route)?.owner,
                route: surface.route ?? null,
                locale,
                viewport,
                theme,
                copy: Object.fromEntries(surface.keys.map((key) => [key, lookup(catalogs[locale], key)])),
            }))
        ))
    ))
));

for (const surface of criticalSurfaces) {
    if (surface.route && !analysis.routes.some((route) => route.path === surface.route)) {
        throw new Error(`Critical smoke route is not present in the source inventory: ${surface.route}`);
    }
}

const inventory = {
    schemaVersion: 1,
    generatedBy: 'scripts/generate-ui-surface-inventory.mjs',
    sourceFingerprint: analysis.sourceFingerprint,
    routeCount: analysis.routes.length,
    surfaceCount: analysis.surfaces.length,
    hardcodedCopyCount: analysis.hardcodedCopy.length,
    routes: analysis.routes,
    surfaces: analysis.surfaces,
    smokeMatrix,
};
const inventoryJson = `${JSON.stringify(inventory, null, 2)}\n`;

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

const routeRows = analysis.routes.map((route) => `
    <tr>
      <td><code>${escapeHtml(route.path)}</code></td>
      <td><code>${escapeHtml(route.owner)}</code></td>
      <td>${route.translationKeys.length}</td>
      <td>${escapeHtml(route.states.join(', ') || '—')}</td>
    </tr>`).join('');
const surfaceRows = analysis.surfaces.map((surface) => `
    <tr>
      <td>${escapeHtml(surface.kind)}</td>
      <td><code>${escapeHtml(surface.owner)}</code></td>
      <td>${escapeHtml(surface.exports.join(', ') || 'module')}</td>
      <td>${surface.translationKeys.length}</td>
      <td>${escapeHtml(surface.states.join(', ') || '—')}</td>
    </tr>`).join('');
const smokeCards = smokeMatrix.map((entry) => `
    <article class="smoke ${entry.viewport} ${entry.theme}" lang="${entry.locale}">
      <small>${escapeHtml(entry.surface)} · ${entry.locale} · ${entry.viewport} · ${entry.theme}</small>
      ${Object.entries(entry.copy).map(([key, value]) => `<p><b>${escapeHtml(key)}</b><br>${escapeHtml(value)}</p>`).join('')}
    </article>`).join('');

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>HappyHerd UI Surface Inventory</title>
  <style>
    :root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#f5f3ee;color:#171714}body{margin:0;padding:32px}main{max-width:1320px;margin:auto}h1{font-size:clamp(2rem,5vw,4rem);margin:.2em 0}h2{margin-top:48px}.meta{color:#666;margin-bottom:28px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}table{width:100%;border-collapse:collapse;background:white}th,td{text-align:left;padding:10px;border:1px solid #dedbd3;vertical-align:top}code{font-size:.86em}.smoke{border:1px solid #d8d4ca;border-radius:16px;padding:16px;background:#fff;color:#171714;overflow-wrap:anywhere}.smoke.dark{background:#202020;color:#f5f5f5;border-color:#3b3b3b}.smoke.mobile{max-width:360px}.smoke small{letter-spacing:.08em;text-transform:uppercase;color:#777}.smoke p{line-height:1.45}@media(max-width:700px){body{padding:18px}.table-wrap{overflow:auto}}
  </style>
</head>
<body><main>
  <p>HappyHerd · generated artifact</p>
  <h1>UI Surface Inventory</h1>
  <p class="meta">Schema 1 · source ${analysis.sourceFingerprint.slice(0, 16)} · ${analysis.routes.length} routes · ${analysis.surfaces.length} UI owners · ${analysis.hardcodedCopy.length} hardcoded findings</p>
  <h2>Production routes</h2><div class="table-wrap"><table><thead><tr><th>Route</th><th>Source owner</th><th>Keys</th><th>States</th></tr></thead><tbody>${routeRows}</tbody></table></div>
  <h2>UI-owning modules</h2><div class="table-wrap"><table><thead><tr><th>Kind</th><th>Source owner</th><th>Exports</th><th>Keys</th><th>States</th></tr></thead><tbody>${surfaceRows}</tbody></table></div>
  <h2>Critical locale × viewport × theme smoke matrix</h2><p>Generated from the same catalogs and source owners enforced by CI.</p><div class="grid">${smokeCards}</div>
</main></body></html>\n`;

async function verify(path, expected, label) {
    const current = await readFile(path, 'utf8').catch(() => '');
    if (current !== expected) throw new Error(`${label} is stale. Run: pnpm ui:inventory:generate`);
}

if (process.argv.includes('--write')) {
    await writeFile(inventoryPath, inventoryJson);
    await writeFile(treePath, html);
    console.log(`[ui-inventory] wrote ${analysis.routes.length} routes, ${analysis.surfaces.length} surfaces, and ${smokeMatrix.length} smoke cases`);
} else {
    await verify(inventoryPath, inventoryJson, 'ui-surface-inventory.json');
    await verify(treePath, html, 'ui-tree.html');
    console.log(`[ui-inventory] verified ${analysis.routes.length} routes, ${analysis.surfaces.length} surfaces, and ${smokeMatrix.length} smoke cases`);
}

if (analysis.routes.length !== 36) throw new Error(`Expected 36 production routes, found ${analysis.routes.length}`);
if (analysis.hardcodedCopy.length > 0) {
    const details = analysis.hardcodedCopy.slice(0, 80).map((finding) => (
        `${finding.owner}:${finding.line}:${finding.column} [${finding.context}] ${finding.text}`
    ));
    throw new Error(`Production UI contains ${analysis.hardcodedCopy.length} hardcoded copy findings:\n${details.join('\n')}`);
}

const fingerprint = createHash('sha256').update(inventoryJson).update(html).digest('hex');
console.log(`[ui-inventory] artifact fingerprint ${fingerprint}`);
