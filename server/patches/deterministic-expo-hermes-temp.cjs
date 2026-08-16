/**
 * Makes Expo's Hermes compiler input path deterministic.
 *
 * @expo/metro-config normally embeds a Math.random()/Date.now()-based temporary
 * source path in every iOS Hermes bytecode payload. Identical source therefore
 * produces different bytes in a clean clone, defeating release provenance.
 * Deriving the temporary directory from the bundle content keeps the compiler
 * input path stable while Expo's existing in-process build serialization avoids
 * concurrent writes.
 */
const fs = require('fs');
const path = require('path');

const candidates = [
    path.resolve(__dirname, '..', 'node_modules/@expo/metro-config/build/serializer/exportHermes.js'),
    path.resolve(__dirname, '..', 'packages/happy-app/node_modules/@expo/metro-config/build/serializer/exportHermes.js'),
];

const randomImportAnchor = 'const path_1 = __importDefault(require("path"));';
const cryptoImport = 'const crypto_1 = require("crypto");';
const randomTemp = 'const tempDir = path_1.default.join(os_1.default.tmpdir(), `expo-bundler-${Math.random()}-${Date.now()}`);';
const deterministicTemp = "const tempDir = path_1.default.join(os_1.default.tmpdir(), `expo-bundler-${(0, crypto_1.createHash)('sha256').update(code).digest('hex').slice(0, 32)}`);";

let found = 0;
let patched = 0;

for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    found++;

    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes(deterministicTemp)) continue;

    if (!content.includes(randomImportAnchor) || !content.includes(randomTemp)) {
        throw new Error(`Unsupported @expo/metro-config exportHermes layout: ${filePath}`);
    }

    content = content.replace(randomImportAnchor, `${randomImportAnchor}\n${cryptoImport}`);
    content = content.replace(randomTemp, deterministicTemp);
    fs.writeFileSync(filePath, content, 'utf8');
    patched++;
}

if (found === 0) {
    throw new Error('Could not find @expo/metro-config exportHermes.js to patch');
}

if (patched > 0) {
    console.log(`[patch] Made Expo Hermes bytecode input deterministic (${patched} file(s))`);
}
