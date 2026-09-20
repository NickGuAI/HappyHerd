import { Typography } from '@/constants/Typography';
/**
 * Web-only code editor with syntax highlighting.
 * Uses react-simple-code-editor + Prism.js.
 * Theme colors match the app's syntax highlighting (Pierre-consistent).
 */
import * as React from 'react';
import Editor from 'react-simple-code-editor';
import { darkTheme, lightTheme } from '@/theme';
import Prism from 'prismjs';

// Load Prism languages (order matters — dependencies first)
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-ini';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-graphql';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-hcl';

interface CodeEditorProps {
    value: string;
    onChange: (value: string) => void;
    language: string | null;
    darkMode: boolean;
    readOnly?: boolean;
}

const LANG_MAP: Record<string, string> = {
    javascript: 'javascript',
    typescript: 'typescript',
    jsx: 'jsx',
    tsx: 'tsx',
    python: 'python',
    html: 'markup',
    css: 'css',
    json: 'json',
    markdown: 'markdown',
    xml: 'markup',
    yaml: 'yaml',
    toml: 'toml',
    ini: 'ini',
    bash: 'bash',
    shell: 'bash',
    docker: 'docker',
    graphql: 'graphql',
    sql: 'sql',
    go: 'go',
    rust: 'rust',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    ruby: 'ruby',
    swift: 'swift',
    kotlin: 'kotlin',
    hcl: 'hcl',
};

export const CodeEditor = React.memo(function CodeEditor({
    value,
    onChange,
    language,
    darkMode,
    readOnly = false,
}: CodeEditorProps) {
    const highlight = React.useCallback((code: string) => {
        const prismLang = language ? (LANG_MAP[language] ?? null) : null;
        const grammar = prismLang ? Prism.languages[prismLang] : null;
        if (!grammar || !prismLang) return escapeHtml(code);
        try {
            return Prism.highlight(code, grammar, prismLang);
        } catch {
            return escapeHtml(code);
        }
    }, [language]);

    // Inject theme CSS into document head
    React.useEffect(() => {
        const id = 'prism-editor-theme';
        let el = document.getElementById(id);
        if (!el) {
            el = document.createElement('style');
            el.id = id;
            document.head.appendChild(el);
        }
        el.textContent = darkMode ? DARK_THEME_CSS : LIGHT_THEME_CSS;
    }, [darkMode]);

    return (
        <div
            style={{
                flex: 1,
                overflow: 'auto',
                backgroundColor: 'transparent',
            }}
        >
            <Editor
                value={value}
                onValueChange={readOnly ? () => {} : onChange}
                highlight={highlight}
                padding={16}
                readOnly={readOnly}
                style={{
                    fontFamily: Typography.mono().fontFamily,
                    fontSize: 16,
                    lineHeight: 1.5,
                    minHeight: '100%',
                    color: (darkMode ? darkTheme : lightTheme).colors.syntaxDefault,
                    backgroundColor: 'transparent',
                }}
                textareaClassName="code-editor-textarea"
            />
        </div>
    );
});

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Colors from theme.ts dark mode (matches Pierre github-dark-default)
const DARK_THEME_CSS = `
.code-editor-textarea {
    outline: none !important;
    caret-color: ${darkTheme.colors.text} !important;
}
.token.comment, .token.prolog, .token.doctype, .token.cdata { color: ${darkTheme.colors.syntaxComment}; font-style: italic; }
.token.punctuation { color: ${darkTheme.colors.syntaxDefault}; }
.token.property, .token.tag, .token.boolean, .token.number, .token.constant, .token.symbol { color: ${darkTheme.colors.syntaxNumber}; }
.token.selector, .token.attr-name, .token.string, .token.char, .token.builtin, .token.inserted { color: ${darkTheme.colors.syntaxString}; }
.token.operator, .token.entity, .token.url { color: ${darkTheme.colors.syntaxDefault}; }
.token.atrule, .token.attr-value, .token.keyword, .token.class-name { color: ${darkTheme.colors.syntaxKeyword}; }
.token.function { color: ${darkTheme.colors.syntaxFunction}; }
.token.regex, .token.important, .token.variable { color: ${darkTheme.colors.textDestructive}; }
.token.deleted { color: ${darkTheme.colors.syntaxString}; text-decoration: line-through; }
.token.namespace { color: ${darkTheme.colors.syntaxFunction}; }
.token.tag .token.punctuation { color: ${darkTheme.colors.textSecondary}; }
.token.tag .token.attr-name { color: ${darkTheme.colors.syntaxDefault}; }
.token.tag .token.attr-value { color: ${darkTheme.colors.syntaxString}; }
`;

// Colors from theme.ts light mode
const LIGHT_THEME_CSS = `
.code-editor-textarea {
    outline: none !important;
    caret-color: ${lightTheme.colors.text} !important;
}
.token.comment, .token.prolog, .token.doctype, .token.cdata { color: ${lightTheme.colors.syntaxComment}; font-style: italic; }
.token.punctuation { color: ${lightTheme.colors.syntaxDefault}; }
.token.property, .token.tag, .token.boolean, .token.number, .token.constant, .token.symbol { color: ${lightTheme.colors.syntaxNumber}; }
.token.selector, .token.attr-name, .token.string, .token.char, .token.builtin, .token.inserted { color: ${lightTheme.colors.syntaxString}; }
.token.operator, .token.entity, .token.url { color: ${lightTheme.colors.syntaxDefault}; }
.token.atrule, .token.attr-value, .token.keyword, .token.class-name { color: ${lightTheme.colors.syntaxKeyword}; }
.token.function { color: ${lightTheme.colors.syntaxFunction}; }
.token.regex, .token.important, .token.variable { color: ${lightTheme.colors.textDestructive}; }
.token.deleted { color: ${lightTheme.colors.textDestructive}; text-decoration: line-through; }
.token.namespace { color: ${lightTheme.colors.syntaxFunction}; }
.token.tag .token.punctuation { color: ${lightTheme.colors.syntaxComment}; }
.token.tag .token.attr-name { color: ${lightTheme.colors.syntaxKeyword}; }
.token.tag .token.attr-value { color: ${lightTheme.colors.syntaxString}; }
`;
