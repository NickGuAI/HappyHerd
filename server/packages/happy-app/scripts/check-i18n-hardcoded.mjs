import { readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcesRoot = resolve(packageRoot, 'sources');
const allowlistPath = resolve(packageRoot, 'sources/text/hardcoded-allowlist.json');
const translatedAttributes = new Set([
    'accessibilityHint', 'accessibilityLabel', 'description', 'footer', 'header',
    'label', 'placeholder', 'subtitle', 'title',
]);

function normalize(value) {
    return value.replace(/\s+/g, ' ').trim();
}

function looksLikeUiCopy(value) {
    const text = normalize(value);
    return text.length > 1 && /[A-Za-zÀ-ž\u3400-\u9fff]/u.test(text);
}

function jsxElementName(node) {
    let cursor = node.parent;
    while (cursor) {
        if (ts.isJsxElement(cursor)) return cursor.openingElement.tagName.getText();
        if (ts.isJsxSelfClosingElement(cursor)) return cursor.tagName.getText();
        if (ts.isFunctionLike(cursor) || ts.isSourceFile(cursor)) break;
        cursor = cursor.parent;
    }
    return null;
}

function isModalCopy(node) {
    let cursor = node.parent;
    while (cursor && !ts.isSourceFile(cursor)) {
        if (ts.isCallExpression(cursor)) {
            const callee = cursor.expression.getText();
            return callee === 'Modal.alert' || callee === 'Modal.confirm';
        }
        if (ts.isFunctionLike(cursor)) return false;
        cursor = cursor.parent;
    }
    return false;
}

function isTranslatedProperty(node) {
    const parent = node.parent;
    if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
        return translatedAttributes.has(parent.name.getText().replace(/["']/g, ''));
    }
    return false;
}

const files = ts.sys.readDirectory(sourcesRoot, ['.tsx'], undefined, ['**/*']);
const findings = new Set();
for (const file of files) {
    if (/\.(test|spec)\.tsx$/.test(file)) continue;
    const sourceText = await readFile(file, 'utf8');
    const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const record = (value) => {
        const text = normalize(value);
        if (looksLikeUiCopy(text)) findings.add(`${relative(packageRoot, file)}::${text}`);
    };
    const visit = (node) => {
        if (ts.isJsxText(node)) record(node.text);
        if (ts.isJsxAttribute(node) && translatedAttributes.has(node.name.getText())) {
            if (node.initializer && ts.isStringLiteral(node.initializer)) record(node.initializer.text);
        }
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            const element = jsxElementName(node);
            if (element === 'Text' || element === 'StyledText' || isModalCopy(node) || isTranslatedProperty(node)) {
                record(node.text);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
}

const current = [...findings].sort();
if (process.argv.includes('--write')) {
    await writeFile(allowlistPath, `${JSON.stringify(current, null, 2)}\n`);
    console.log(`[i18n] wrote ${current.length} explicit legacy UI-copy exceptions`);
} else {
    const allowlist = JSON.parse(await readFile(allowlistPath, 'utf8'));
    const allowed = new Set(allowlist);
    const violations = current.filter((finding) => !allowed.has(finding));
    const stale = allowlist.filter((finding) => !findings.has(finding));
    if (violations.length > 0) {
        throw new Error(`Hardcoded UI copy must move to locales/en.json, cn.json, and de.json:\n${violations.join('\n')}`);
    }
    if (stale.length > 0) {
        throw new Error(`Hardcoded UI-copy allowlist has stale entries; remove only these reviewed exceptions:\n${stale.join('\n')}`);
    }
    console.log(`[i18n] no new hardcoded UI copy (${allowlist.length} explicit legacy exceptions)`);
}
