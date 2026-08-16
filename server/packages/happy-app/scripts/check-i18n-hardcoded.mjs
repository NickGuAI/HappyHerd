import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeUiSources } from './ui-source-analysis.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const analysis = await analyzeUiSources({ packageRoot });

if (analysis.hardcodedCopy.length > 0) {
    const findings = analysis.hardcodedCopy.map((finding) => (
        `${finding.owner}:${finding.line}:${finding.column} [${finding.context}] ${finding.text}`
    ));
    throw new Error(`Hardcoded product-owned UI copy must move to the locale catalogs:\n${findings.join('\n')}`);
}

console.log(`[i18n] zero production hardcoded-copy exceptions across .ts and .tsx (${analysis.surfaces.length} UI owners)`);
