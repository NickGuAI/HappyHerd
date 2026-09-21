import { createRequire } from 'node:module';
import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packagePath = require.resolve('pdfjs-dist/package.json');
const { version } = require(packagePath);
const source = dirname(packagePath);
const target = resolve(dirname(fileURLToPath(import.meta.url)), '../public/pdfjs', version);
await mkdir(target, { recursive: true });
for (const name of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
    await cp(resolve(source, 'legacy/build', name), resolve(target, name.replace(/\.mjs$/, ".js")));
}
for (const name of ['cmaps', 'standard_fonts', 'wasm', 'LICENSE']) {
    await cp(resolve(source, name), resolve(target, name), { recursive: true });
}
