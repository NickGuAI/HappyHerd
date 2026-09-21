import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const translatedAttributes = new Set([
    'accessibilityHint',
    'accessibilityLabel',
    'description',
    'detail',
    'buttonLabel',
    'cancelLabel',
    'confirmLabel',
    'emptyDescription',
    'emptyTitle',
    'footer',
    'header',
    'label',
    'message',
    'placeholder',
    'searchPlaceholder',
    'subtitle',
    'title',
    'tooltip',
]);

const uiVariablePattern = /(accessibilityLabel|accessibleLabel|composerPlaceholder|displayLabel|errorMessage|headerText|placeholder|subtitleText|titleText)$/;

const visibleTextElements = new Set([
    'DropdownMenuItem.Text',
    'Text',
    'StyledText',
    'Typography',
]);

const uiCopyCalls = new Set([
    'Alert.alert',
    'Modal.alert',
    'Modal.confirm',
    'Modal.prompt',
    'Toast.show',
    'showAlert',
    'showToast',
]);

const statePattern = /(^|[._-])(disabled|empty|error|failed|loading|missing|offline|pending|unavailable)([._-]|$)/i;

function normalize(value) {
    return value.replace(/\s+/g, ' ').trim();
}

function looksLikeUiCopy(value) {
    const text = normalize(value);
    const staticText = text.replaceAll('{expression}', '');
    return staticText.length > 1 && /[A-Za-zÀ-ž\u3400-\u9fff]/u.test(staticText);
}

async function walk(directory, output = []) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = resolve(directory, entry.name);
        if (entry.isDirectory()) await walk(file, output);
        else output.push(file);
    }
    return output;
}

function isTestOrDevelopment(relativePath) {
    return /(^|\/)(dev|__tests__|__testdata__)(\/|$)/.test(relativePath)
        || /\.(test|spec)\.(ts|tsx)$/.test(relativePath);
}

function isRouteFile(relativePath) {
    if (!relativePath.startsWith('sources/app/')) return false;
    if (!/\.(ts|tsx)$/.test(relativePath) || isTestOrDevelopment(relativePath)) return false;
    const name = basename(relativePath);
    return !name.startsWith('_') && name !== '+html.tsx' && name !== '+not-found.tsx';
}

function routePath(relativePath) {
    const route = relativePath
        .replace(/^sources\/app\//, '')
        .replace(/\.(ts|tsx)$/, '')
        .split('/')
        .filter((segment) => !/^\(.+\)$/.test(segment))
        .filter((segment) => segment !== 'index')
        .join('/');
    return `/${route}`.replace(/\/$/, '') || '/';
}

function hasExportModifier(node) {
    return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function collectExportNames(source) {
    const names = new Set();
    for (const statement of source.statements) {
        if (!hasExportModifier(statement)) continue;
        if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
            names.add(statement.name.text);
        }
        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
            }
        }
        if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
            for (const element of statement.exportClause.elements) names.add(element.name.text);
        }
    }
    return [...names].sort();
}

function renderedTextElementName(node) {
    let cursor = node;
    while (cursor) {
        if (ts.isJsxAttribute(cursor)) return null;
        if (ts.isJsxExpression(cursor) && ts.isJsxElement(cursor.parent)) {
            return cursor.parent.openingElement.tagName.getText();
        }
        const parent = cursor.parent;
        if (!parent) return null;
        if (ts.isConditionalExpression(parent)) {
            if (parent.condition === cursor) return null;
            cursor = parent;
            continue;
        }
        if (ts.isBinaryExpression(parent)) {
            if (parent.operatorToken.kind !== ts.SyntaxKind.PlusToken) return null;
            cursor = parent;
            continue;
        }
        if (
            ts.isParenthesizedExpression(parent)
            || ts.isAsExpression(parent)
            || ts.isNonNullExpression(parent)
            || ts.isSatisfiesExpression(parent)
        ) {
            cursor = parent;
            continue;
        }
        if (ts.isTemplateExpression(parent)) {
            cursor = parent;
            continue;
        }
        if (!ts.isJsxExpression(parent)) return null;
        if (ts.isFunctionLike(cursor) || ts.isSourceFile(cursor)) break;
        cursor = parent;
    }
    return null;
}

function uiCopyCallName(node) {
    let cursor = node.parent;
    while (cursor && !ts.isSourceFile(cursor)) {
        if (ts.isCallExpression(cursor)) {
            const argument = cursor.arguments.find((candidate) => (
                candidate === node || (candidate.pos <= node.pos && candidate.end >= node.end)
            ));
            if (!argument) return null;
            const argumentIndex = cursor.arguments.indexOf(argument);
            return argumentIndex <= 1 ? cursor.expression.getText() : null;
        }
        if (ts.isFunctionLike(cursor)) return null;
        cursor = cursor.parent;
    }
    return null;
}

function isTranslationArgument(node) {
    let cursor = node.parent;
    while (cursor && !ts.isSourceFile(cursor)) {
        if (ts.isCallExpression(cursor)) {
            const name = cursor.expression.getText();
            const argument = cursor.arguments.find((candidate) => (
                candidate === node || (candidate.pos <= node.pos && candidate.end >= node.end)
            ));
            return Boolean(argument) && (name === 't' || name === 'translate' || name.endsWith('.t'));
        }
        if (ts.isFunctionLike(cursor)) return false;
        cursor = cursor.parent;
    }
    return false;
}

function isInsideStyleDeclaration(node) {
    let cursor = node.parent;
    while (cursor && !ts.isSourceFile(cursor)) {
        if (ts.isCallExpression(cursor) && /(^|\.)StyleSheet\.create$/.test(cursor.expression.getText())) return true;
        if (ts.isPropertyAssignment(cursor)) {
            const property = cursor.name.getText().replace(/["']/g, '');
            if (property === 'style' || property === 'contentStyle') return true;
        }
        cursor = cursor.parent;
    }
    return false;
}

function isControlToken(node) {
    let cursor = node;
    while (cursor.parent && !ts.isSourceFile(cursor.parent) && !ts.isFunctionLike(cursor.parent)) {
        const parent = cursor.parent;
        if (ts.isBinaryExpression(parent)) {
            return [
                ts.SyntaxKind.EqualsEqualsToken,
                ts.SyntaxKind.EqualsEqualsEqualsToken,
                ts.SyntaxKind.ExclamationEqualsToken,
                ts.SyntaxKind.ExclamationEqualsEqualsToken,
            ].includes(parent.operatorToken.kind);
        }
        if (ts.isConditionalExpression(parent) && parent.condition.pos <= node.pos && parent.condition.end >= node.end) return true;
        if (ts.isCaseClause(parent) && parent.expression.pos <= node.pos && parent.expression.end >= node.end) return true;
        if (ts.isJsxAttribute(parent) || ts.isPropertyAssignment(parent) || ts.isVariableDeclaration(parent)) break;
        cursor = parent;
    }
    return false;
}

function staticValue(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) {
        return `${node.head.text}${node.templateSpans.map((span) => `{expression}${span.literal.text}`).join('')}`;
    }
    return null;
}

function uiContext(node, relativePath) {
    if (isTranslationArgument(node) || isInsideStyleDeclaration(node) || isControlToken(node)) return null;
    const parent = node.parent;
    let descriptorCursor = parent;
    while (descriptorCursor && !ts.isSourceFile(descriptorCursor) && !ts.isFunctionLike(descriptorCursor)) {
        if (ts.isCallExpression(descriptorCursor)) break;
        if (ts.isJsxAttribute(descriptorCursor)) {
            const attribute = descriptorCursor.name.getText();
            if (translatedAttributes.has(attribute)) return `jsx-attribute:${attribute}`;
            return null;
        }
        if (ts.isPropertyAssignment(descriptorCursor)) {
            const property = descriptorCursor.name.getText().replace(/["']/g, '');
            const uiDescriptorOwner = /sources\/(app|components|hooks|modal)\//.test(relativePath)
                || relativePath === 'sources/sync/suggestionCommands.ts'
                || relativePath === 'sources/sync/sync.ts';
            if (uiDescriptorOwner && translatedAttributes.has(property)) return `descriptor:${property}`;
        }
        if (ts.isVariableDeclaration(descriptorCursor) && ts.isIdentifier(descriptorCursor.name)) {
            if (uiVariablePattern.test(descriptorCursor.name.text)) return `dynamic:${descriptorCursor.name.text}`;
        }
        descriptorCursor = descriptorCursor.parent;
    }
    const element = renderedTextElementName(node);
    if (element && (visibleTextElements.has(element) || visibleTextElements.has(element.split('.').at(-1)))) {
        return `jsx:${element}`;
    }
    const containingCall = uiCopyCallName(node);
    if (containingCall && (uiCopyCalls.has(containingCall) || /(^|\.)(alert|confirm|prompt)$/.test(containingCall))) {
        return `call:${containingCall}`;
    }
    return null;
}

function lineAndColumn(source, position) {
    const location = source.getLineAndCharacterOfPosition(position);
    return { line: location.line + 1, column: location.character + 1 };
}

function surfaceKind(relativePath, route, sourceText) {
    if (route) return 'route';
    if (/modal/i.test(relativePath)) return 'modal';
    if (/sheet/i.test(relativePath)) return 'sheet';
    if (/sidebar/i.test(relativePath)) return 'sidebar';
    if (/panel/i.test(relativePath)) return 'panel';
    if (/banner/i.test(relativePath)) return 'banner';
    if (/picker|selector/i.test(relativePath)) return 'picker';
    if (/<[A-Z][A-Za-z0-9.]*/.test(sourceText)) return 'component';
    return 'ui-module';
}

function inferStates(translationKeys, copy) {
    const states = new Set();
    for (const candidate of [...translationKeys, ...copy.map((finding) => finding.text)]) {
        const match = candidate.match(statePattern);
        if (match) states.add(match[2].toLowerCase());
    }
    return [...states].sort();
}

function collectTranslationKeys(node, output) {
    if (ts.isStringLiteralLike(node)) {
        output.add(node.text);
        return;
    }
    ts.forEachChild(node, (child) => collectTranslationKeys(child, output));
}

export async function analyzeUiSources({ packageRoot }) {
    const sourcesRoot = resolve(packageRoot, 'sources');
    const candidates = (await walk(sourcesRoot))
        .filter((file) => /\.(ts|tsx)$/.test(file))
        .map((file) => ({ file, relativePath: relative(packageRoot, file).split(sep).join('/') }))
        .filter(({ relativePath }) => !isTestOrDevelopment(relativePath))
        .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

    const modules = [];
    const allCopy = [];
    const fingerprint = createHash('sha256');

    for (const { file, relativePath } of candidates) {
        const sourceText = await readFile(file, 'utf8');
        fingerprint.update(relativePath).update('\0').update(sourceText).update('\0');
        const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
        const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
        const translationKeys = new Set();
        const copy = [];
        let hasJsx = false;

        const recordCopy = (node, value, context) => {
            const text = normalize(value);
            if (!context || !looksLikeUiCopy(text)) return;
            const location = lineAndColumn(source, node.getStart(source));
            copy.push({
                ...location,
                text,
                context,
                start: node.getStart(source),
                end: node.getEnd(),
                syntaxKind: ts.SyntaxKind[node.kind],
            });
        };

        const visit = (node) => {
            if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) hasJsx = true;
            if (ts.isCallExpression(node)) {
                const name = node.expression.getText(source);
                if ((name === 't' || name === 'translate' || name.endsWith('.t')) && node.arguments[0]) {
                    collectTranslationKeys(node.arguments[0], translationKeys);
                }
            }
            if (ts.isJsxText(node)) recordCopy(node, node.text, 'jsx-text');
            if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
                const value = staticValue(node);
                if (value !== null) recordCopy(node, value, uiContext(node, relativePath));
            }
            ts.forEachChild(node, visit);
        };
        visit(source);

        const route = isRouteFile(relativePath) ? routePath(relativePath) : null;
        const exports = collectExportNames(source);
        const isUiOwner = Boolean(route)
            || hasJsx
            || copy.length > 0
            || translationKeys.size > 0;
        if (!isUiOwner) continue;

        const dedupedCopy = [...new Map(copy.map((finding) => [
            `${finding.line}:${finding.column}:${finding.text}`,
            finding,
        ])).values()];
        const keys = [...translationKeys].sort();
        const module = {
            owner: relativePath,
            kind: surfaceKind(relativePath, route, sourceText),
            route,
            exports,
            translationKeys: keys,
            states: inferStates(keys, dedupedCopy),
            hardcodedCopy: dedupedCopy.map(({ start: _start, end: _end, syntaxKind: _syntaxKind, ...finding }) => finding),
        };
        modules.push(module);
        allCopy.push(...dedupedCopy.map((finding) => ({ owner: relativePath, ...finding })));
    }

    return {
        sourceFingerprint: fingerprint.digest('hex'),
        routes: modules.filter((module) => module.route).map((module) => ({
            path: module.route,
            owner: module.owner,
            translationKeys: module.translationKeys,
            states: module.states,
        })),
        surfaces: modules,
        hardcodedCopy: allCopy,
    };
}
