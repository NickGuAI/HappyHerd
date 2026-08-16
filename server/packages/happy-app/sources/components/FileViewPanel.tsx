/**
 * File view/edit overlay panel.
 * Shown in the main content area when a file is selected from the "All Files" sidebar tab.
 * Uses Pierre for viewing file content, CodeMirror for editing (web only).
 */
import * as React from 'react';
import { View, ScrollView, ActivityIndicator, Pressable, Platform } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { PierreDiffView } from '@/components/diff/PierreDiffView';
import { sessionReadFile, sessionWriteFile } from '@/sync/ops';
import { Modal } from '@/modal';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { layout } from '@/components/layout';
import { useSession } from '@/sync/storage';
import { rigCanWriteFiles } from '@/sync/rig';
import {
    classifyFilePreview,
    imageDataUri,
    imagePreviewLayout,
    pdfDataUri,
    safeHtmlPreviewDocument,
} from '@/utils/filePreview';
import { FileDocumentPreview } from '@/components/FileDocumentPreview';

interface FileViewPanelProps {
    sessionId: string;
    filePath: string;
    /** Publishes the right-side controls (edit/preview toggle, save button) into the chat header. */
    onHeaderRightSlotChange: (slot: React.ReactNode) => void;
    onDirtyChange?: (dirty: boolean) => void;
}

export type FileContentReadResult = {
    success: boolean;
    content?: string;
    error?: string;
};

export type FileContentWriteResult = {
    success: boolean;
    hash?: string;
    error?: string;
};

export interface FileContentPanelProps {
    /** Changes whenever the backing transport/resource changes. */
    resourceKey: string;
    filePath: string;
    readFile: (filePath: string) => Promise<FileContentReadResult>;
    writeFile?: (
        filePath: string,
        content: string,
        expectedHash?: string | null,
    ) => Promise<FileContentWriteResult>;
    canWrite: boolean;
    markdownSessionId?: string;
    onHeaderRightSlotChange: (slot: React.ReactNode) => void;
    onDirtyChange?: (dirty: boolean) => void;
}

type FileState =
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'image'; uri: string }
    | { kind: 'pdf'; uri: string }
    | { kind: 'unsupported'; message: string }
    | { kind: 'loaded'; content: string; originalHash: string | null };

function getFileLanguage(path: string): string | null {
    const ext = path.split('.').pop()?.toLowerCase();
    const map: Record<string, string> = {
        js: 'javascript', jsx: 'javascript',
        ts: 'typescript', tsx: 'typescript',
        py: 'python',
        html: 'html', htm: 'html',
        css: 'css',
        json: 'json',
        md: 'markdown',
        xml: 'xml',
        yaml: 'yaml', yml: 'yaml',
        sh: 'bash', bash: 'bash',
        sql: 'sql',
        go: 'go',
        rs: 'rust', rust: 'rust',
        java: 'java',
        c: 'c',
        cpp: 'cpp', cc: 'cpp', cxx: 'cpp',
        php: 'php',
        rb: 'ruby',
        swift: 'swift',
        kt: 'kotlin',
        prisma: 'graphql',
        graphql: 'graphql',
        gql: 'graphql',
        toml: 'toml',
        ini: 'ini',
        env: 'bash',
        dockerfile: 'docker',
        tf: 'hcl',
        scss: 'css',
        less: 'css',
        vue: 'markup',
        svelte: 'markup',
    };
    return ext ? (map[ext] ?? null) : null;
}

function decodeBase64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function decodeUtf8Bytes(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes);
}

function encodeStringToBase64(str: string): string {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/** Read file and decode to string, returns null on failure */
async function readFileContent(
    readFile: FileContentPanelProps['readFile'],
    filePath: string,
): Promise<string | null> {
    const res = await readFile(filePath);
    if (!res.success || typeof res.content !== 'string') return null;
    try {
        return decodeUtf8Bytes(decodeBase64ToBytes(res.content));
    } catch {
        return null;
    }
}

/** Compute SHA-256 hash of a UTF-8 string (matches server's crypto.createHash('sha256').update(str).digest('hex')) */
async function computeSHA256(content: string): Promise<string> {
    const data = new TextEncoder().encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export const FileContentPanel = React.memo(function FileContentPanel({
    resourceKey,
    filePath,
    readFile,
    writeFile,
    canWrite,
    markdownSessionId,
    onHeaderRightSlotChange,
    onDirtyChange,
}: FileContentPanelProps) {
    const { theme } = useUnistyles();
    const [fileState, setFileState] = React.useState<FileState>({ kind: 'loading' });
    const [editContent, setEditContent] = React.useState('');
    const [isSaving, setIsSaving] = React.useState(false);
    const [displayMode, setDisplayMode] = React.useState<'edit' | 'preview'>('edit');

    // External change detection
    const [externalChange, setExternalChange] = React.useState<string | null>(null); // new content from device
    const [showConflictDiff, setShowConflictDiff] = React.useState(false);

    const fileName = filePath.split('/').pop() || filePath;
    const language = getFileLanguage(filePath);
    const isMarkdown = language === 'markdown';
    const previewKind = classifyFilePreview(filePath);
    const isHtml = previewKind === 'html';
    const hasSourcePreview = isMarkdown || isHtml;

    const hasChanges = fileState.kind === 'loaded' && editContent !== fileState.content;

    React.useEffect(() => {
        onDirtyChange?.(hasChanges);
        return () => onDirtyChange?.(false);
    }, [hasChanges, onDirtyChange]);

    // Load file content
    React.useEffect(() => {
        let cancelled = false;
        setFileState({ kind: 'loading' });
        setExternalChange(null);
        setShowConflictDiff(false);

        if (previewKind === 'unsupported') {
            setFileState({ kind: 'unsupported', message: t('files.cannotDisplayBinary') });
            return;
        }

        (async () => {
            try {
                const fileResponse = await readFile(filePath);

                if (cancelled) return;

                if (!fileResponse.success || typeof fileResponse.content !== 'string') {
                    setFileState({ kind: 'error', message: fileResponse.error || t('files.failedToRead') });
                    return;
                }

                if (previewKind === 'image') {
                    setFileState({ kind: 'image', uri: imageDataUri(filePath, fileResponse.content) });
                    return;
                }
                if (previewKind === 'pdf') {
                    setFileState({ kind: 'pdf', uri: pdfDataUri(fileResponse.content) });
                    return;
                }

                let rawBytes: Uint8Array;
                let decodedContent: string;
                try {
                    rawBytes = decodeBase64ToBytes(fileResponse.content);
                    decodedContent = decodeUtf8Bytes(rawBytes);
                } catch {
                    setFileState({ kind: 'unsupported', message: t('files.cannotDisplayBinary') });
                    return;
                }

                const hasNullBytes = rawBytes.some((byte) => byte === 0);
                const nonPrintableCount = decodedContent.split('').filter(char => {
                    const code = char.charCodeAt(0);
                    return code < 32 && code !== 9 && code !== 10 && code !== 13;
                }).length;
                if (hasNullBytes || (nonPrintableCount / decodedContent.length > 0.1)) {
                    setFileState({ kind: 'unsupported', message: t('files.cannotDisplayBinary') });
                    return;
                }

                const hash = await computeSHA256(decodedContent);
                setFileState({ kind: 'loaded', content: decodedContent, originalHash: hash });
                setEditContent(decodedContent);
            } catch {
                if (!cancelled) {
                    setFileState({ kind: 'error', message: t('files.failedToRead') });
                }
            }
        })();

        return () => { cancelled = true; };
    }, [resourceKey, filePath, previewKind, readFile]);

    React.useEffect(() => {
        setDisplayMode(hasSourcePreview ? 'preview' : 'edit');
    }, [filePath, hasSourcePreview]);

    // Poll for external changes every 5s
    React.useEffect(() => {
        if (fileState.kind !== 'loaded' || !fileState.originalHash) return;
        const originalHash = fileState.originalHash;

        const interval = setInterval(async () => {
            const content = await readFileContent(readFile, filePath);
            if (content === null) return;
            const currentHash = await computeSHA256(content);
            if (currentHash !== originalHash) {
                setExternalChange(content);
            }
        }, 5000);

        return () => clearInterval(interval);
    }, [resourceKey, filePath, fileState, readFile]);

    const handleReload = React.useCallback(() => {
        if (externalChange === null) return;
        const reloaded = externalChange;
        setExternalChange(null);
        setShowConflictDiff(false);
        (async () => {
            const hash = await computeSHA256(reloaded);
            setFileState({ kind: 'loaded', content: reloaded, originalHash: hash });
            setEditContent(reloaded);
        })();
    }, [externalChange]);

    const handleDismissWarning = React.useCallback(() => {
        setExternalChange(null);
    }, []);

    const handleShowDiff = React.useCallback(() => {
        setShowConflictDiff(true);
    }, []);

    const handleSave = React.useCallback(async () => {
        if (!canWrite || !writeFile || fileState.kind !== 'loaded' || !hasChanges) return;
        setIsSaving(true);

        try {
            const base64 = encodeStringToBase64(editContent);
            const response = await writeFile(
                filePath,
                base64,
                fileState.originalHash,
            );

            if (!response.success) {
                if (response.error?.includes('hash') || response.error?.includes('mismatch')) {
                    // Fetch the current server content for diff
                    const serverContent = await readFileContent(readFile, filePath);
                    if (serverContent) {
                        setExternalChange(serverContent);
                        setShowConflictDiff(true);
                    } else {
                        Modal.alert(t('files.fileConflict'), t('files.fileConflictDescription'));
                    }
                } else {
                    Modal.alert(t('common.error'), response.error || t('files.failedToSave'));
                }
                return;
            }

            // Update original content + hash to match saved state
            const savedHash = response.hash ?? await computeSHA256(editContent);
            setFileState({
                kind: 'loaded',
                content: editContent,
                originalHash: savedHash,
            });
            setExternalChange(null);
            setShowConflictDiff(false);
        } finally {
            setIsSaving(false);
        }
    }, [filePath, editContent, fileState, hasChanges, canWrite, readFile, writeFile]);

    const handleForceSave = React.useCallback(async () => {
        if (!canWrite || !writeFile || fileState.kind !== 'loaded') return;
        setIsSaving(true);

        try {
            // Re-read to get current hash, then write
            const serverContent = await readFileContent(readFile, filePath);
            const currentHash = serverContent !== null ? await computeSHA256(serverContent) : undefined;

            const base64 = encodeStringToBase64(editContent);
            const response = await writeFile(filePath, base64, currentHash);

            if (!response.success) {
                Modal.alert(t('common.error'), response.error || t('files.failedToSave'));
                return;
            }

            const savedHash = response.hash ?? await computeSHA256(editContent);
            setFileState({
                kind: 'loaded',
                content: editContent,
                originalHash: savedHash,
            });
            setExternalChange(null);
            setShowConflictDiff(false);
        } finally {
            setIsSaving(false);
        }
    }, [filePath, editContent, fileState, canWrite, readFile, writeFile]);

    // Publish right-slot controls (edit/preview toggle, save button) into the chat header.
    const isLoaded = fileState.kind === 'loaded';
    React.useEffect(() => {
        onHeaderRightSlotChange(
            <FileHeaderRight
                hasSourcePreview={hasSourcePreview}
                isLoaded={isLoaded}
                displayMode={displayMode}
                onDisplayModeChange={setDisplayMode}
                hasChanges={hasChanges}
                isSaving={isSaving}
                onSave={handleSave}
                canWrite={canWrite}
            />
        );
        return () => onHeaderRightSlotChange(null);
    }, [hasSourcePreview, isLoaded, displayMode, hasChanges, isSaving, handleSave, onHeaderRightSlotChange, canWrite]);

    return (
        <View style={styles.outer}>
            {/* External change warning bar */}
            {externalChange && !showConflictDiff && (
                <View style={[styles.warningBar, { backgroundColor: theme.colors.warning + '18', borderBottomColor: theme.colors.divider }]}>
                    <Ionicons name="alert-circle" size={16} color={theme.colors.warning} />
                    <Text style={[styles.warningText, { color: theme.colors.text }]}>
                        {t('files.fileConflict')}
                    </Text>
                    <View style={{ flex: 1 }} />
                    <Pressable onPress={handleShowDiff} style={[styles.warningAction, { borderColor: theme.colors.divider }]}>
                        <Text style={[styles.warningActionText, { color: theme.colors.textLink }]}>{t("files.diff")}</Text>
                    </Pressable>
                    <Pressable onPress={handleReload} style={[styles.warningAction, { borderColor: theme.colors.divider }]}>
                        <Text style={[styles.warningActionText, { color: theme.colors.textLink }]}>{t('files.reload')}</Text>
                    </Pressable>
                    <Pressable onPress={handleDismissWarning} hitSlop={8}>
                        <Ionicons name="close" size={16} color={theme.colors.textSecondary} />
                    </Pressable>
                </View>
            )}

            {/* Conflict diff view */}
            {showConflictDiff && externalChange && fileState.kind === 'loaded' ? (
                <View style={{ flex: 1 }}>
                    <View style={[styles.conflictHeader, { backgroundColor: theme.colors.surfaceHigh, borderBottomColor: theme.colors.divider }]}>
                        <Text style={[styles.conflictTitle, { color: theme.colors.text }]}>
                            {t('files.fileConflictDescription')}
                        </Text>
                        <View style={{ flex: 1 }} />
                        {canWrite && <Pressable
                            onPress={handleForceSave}
                            disabled={isSaving}
                            style={({ pressed }) => [styles.actionButton, { backgroundColor: theme.colors.textDestructive, opacity: isSaving ? 0.6 : pressed ? 0.8 : 1 }]}
                        >
                            <Text style={styles.actionButtonText}>{isSaving ? '...' : t('files.overwrite')}</Text>
                        </Pressable>}
                        <Pressable
                            onPress={handleReload}
                            style={({ pressed }) => [styles.actionButton, { backgroundColor: theme.colors.textLink, opacity: pressed ? 0.8 : 1 }]}
                        >
                            <Text style={styles.actionButtonText}>{t('files.reload')}</Text>
                        </Pressable>
                        <Pressable onPress={() => setShowConflictDiff(false)} hitSlop={8} style={{ padding: 4 }}>
                            <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
                        </Pressable>
                    </View>
                    <ScrollView
                        style={{ flex: 1 }}
                        contentContainerStyle={{ maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }}
                    >
                        <PierreDiffView
                            oldFile={{ name: fileName + ' (your changes)', contents: editContent }}
                            newFile={{ name: fileName + ' (on device)', contents: externalChange }}
                            diffStyle="unified"
                            disableFileHeader={false}
                        />
                    </ScrollView>
                </View>
            ) : fileState.kind === 'loading' ? (
                <View style={styles.centered}>
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                </View>
            ) : fileState.kind === 'error' ? (
                <View style={styles.centered}>
                    <Ionicons name="alert-circle-outline" size={32} color={theme.colors.textDestructive} />
                    <Text style={{ color: theme.colors.textSecondary, marginTop: 8, ...Typography.default() }}>
                        {fileState.message}
                    </Text>
                </View>
            ) : fileState.kind === 'image' ? (
                <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={styles.imagePreviewContent}
                    maximumZoomScale={4}
                    minimumZoomScale={1}
                >
                    <Image
                        source={{ uri: fileState.uri }}
                        style={[imagePreviewLayout, { maxWidth: layout.maxWidth }]}
                        contentFit="contain"
                        accessibilityLabel={t("uiCopy.previewOfValue", { value1: fileName })}
                    />
                </ScrollView>
            ) : fileState.kind === 'pdf' ? (
                <View style={styles.documentPreview}>
                    <FileDocumentPreview kind="pdf" uri={fileState.uri} title={t("uiCopy.previewOfValue", { value1: fileName })} />
                </View>
            ) : fileState.kind === 'unsupported' ? (
                <View style={styles.centered}>
                    <Ionicons name="document-outline" size={32} color={theme.colors.textSecondary} />
                    <Text style={{ color: theme.colors.textSecondary, marginTop: 8, ...Typography.default() }}>
                        {fileState.message}
                    </Text>
                </View>
            ) : isMarkdown && displayMode === 'preview' ? (
                <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={{ padding: 16, maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }}
                >
                    {Platform.OS === 'web' && <EditorPreviewStyles />}
                    <View {...(Platform.OS === 'web' ? { className: 'editor-preview-wrap' } as any : {})}>
                        <MarkdownView markdown={editContent} sessionId={markdownSessionId} />
                    </View>
                </ScrollView>
            ) : isHtml && displayMode === 'preview' ? (
                <View style={styles.documentPreview}>
                    <FileDocumentPreview
                        kind="html"
                        html={safeHtmlPreviewDocument(editContent)}
                        title={t("uiCopy.previewOfValue", { value1: fileName })}
                    />
                </View>
            ) : (
                <View style={{ flex: 1, maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }}>
                    <EditorView
                        value={editContent}
                        onChange={setEditContent}
                        language={language}
                        readOnly={!canWrite}
                    />
                </View>
            )}
        </View>
    );
});

/**
 * Compatibility wrapper for the desktop session All Files overlay. Its public
 * props and rendered component remain unchanged while the renderer itself can
 * also be driven by machine-scoped Workspace RPCs.
 */
export const FileViewPanel = React.memo(function FileViewPanel({
    sessionId,
    filePath,
    onHeaderRightSlotChange,
    onDirtyChange,
}: FileViewPanelProps) {
    const session = useSession(sessionId);
    const readFile = React.useCallback(
        (path: string) => sessionReadFile(sessionId, path),
        [sessionId],
    );
    const writeFile = React.useCallback(
        (path: string, content: string, expectedHash?: string | null) => (
            sessionWriteFile(sessionId, path, content, expectedHash)
        ),
        [sessionId],
    );

    return (
        <FileContentPanel
            resourceKey={`session:${sessionId}`}
            filePath={filePath}
            readFile={readFile}
            writeFile={writeFile}
            canWrite={rigCanWriteFiles(session?.metadata)}
            markdownSessionId={sessionId}
            onHeaderRightSlotChange={onHeaderRightSlotChange}
            onDirtyChange={onDirtyChange}
        />
    );
});

/** Right-side header controls for the file-view overlay. */
const FileHeaderRight = React.memo(function FileHeaderRight({
    hasSourcePreview,
    isLoaded,
    displayMode,
    onDisplayModeChange,
    hasChanges,
    isSaving,
    onSave,
    canWrite,
}: {
    hasSourcePreview: boolean;
    isLoaded: boolean;
    displayMode: 'edit' | 'preview';
    onDisplayModeChange: (mode: 'edit' | 'preview') => void;
    hasChanges: boolean;
    isSaving: boolean;
    onSave: () => void;
    canWrite: boolean;
}) {
    const { theme } = useUnistyles();
    return (
        <>
            {hasSourcePreview && isLoaded && (
                <View style={[styles.toggleRow, { backgroundColor: theme.colors.groupped.background, borderColor: theme.colors.divider }]}>
                    <Pressable
                        onPress={() => onDisplayModeChange('edit')}
                        style={[
                            styles.toggleButton,
                            displayMode === 'edit' && { backgroundColor: theme.colors.surface },
                        ]}
                    >
                        <Text style={[
                            styles.toggleText,
                            { color: theme.colors.textSecondary },
                            displayMode === 'edit' && styles.toggleTextActive,
                            displayMode === 'edit' && { color: theme.colors.text },
                        ]}>
                            {canWrite ? t('files.editFile') : t("uiCopy.source")}
                        </Text>
                    </Pressable>
                    <Pressable
                        onPress={() => onDisplayModeChange('preview')}
                        style={[
                            styles.toggleButton,
                            displayMode === 'preview' && { backgroundColor: theme.colors.surface },
                        ]}
                    >
                        <Text style={[
                            styles.toggleText,
                            { color: theme.colors.textSecondary },
                            displayMode === 'preview' && styles.toggleTextActive,
                            displayMode === 'preview' && { color: theme.colors.text },
                        ]}>
                            {t("uiCopy.preview")}
                        </Text>
                    </Pressable>
                </View>
            )}
            {canWrite && isLoaded && (
                <Pressable
                    onPress={onSave}
                    disabled={!hasChanges || isSaving}
                    style={({ pressed }) => [
                        styles.actionButton,
                        {
                            backgroundColor: hasChanges ? theme.colors.textLink : theme.colors.input.background,
                            opacity: !hasChanges ? 0.4 : isSaving ? 0.6 : pressed ? 0.8 : 1,
                        },
                    ]}
                >
                    {isSaving ? (
                        <ActivityIndicator size="small" color="white" />
                    ) : (
                        <Text style={[
                            hasChanges ? styles.actionButtonText : styles.actionButtonTextSecondary,
                            !hasChanges && { color: theme.colors.textSecondary },
                        ]}>
                            {t('files.saveFile')}
                        </Text>
                    )}
                </Pressable>
            )}
        </>
    );
});

/** CSS overrides to make MarkdownView match the editor look (web only) */
const EditorPreviewStyles = React.memo(function EditorPreviewStyles() {
    React.useEffect(() => {
        const id = 'editor-preview-styles';
        let el = document.getElementById(id);
        if (!el) {
            el = document.createElement('style');
            el.id = id;
            document.head.appendChild(el);
        }
        el.textContent = `
.editor-preview-wrap div[dir] {
    font-family: ui-monospace, "SF Mono", "Cascadia Code", "Segoe UI Mono", Menlo, Monaco, Consolas, monospace !important;
    font-size: 14px !important;
    line-height: 1.5 !important;
}
.editor-preview-wrap div[dir] div[style*="background"] {
    border-radius: 6px;
}
`;
        return () => {
            // Don't remove — other instances might still be mounted
        };
    }, []);
    return null;
});

/**
 * Lazy-loads the CodeEditor (web-only CodeMirror wrapper).
 * On native this renders the fallback stub.
 */
const EditorView = React.memo(function EditorView({
    value,
    onChange,
    language,
    readOnly,
}: {
    value: string;
    onChange: (v: string) => void;
    language: string | null;
    readOnly: boolean;
}) {
    const { theme } = useUnistyles();
    const [EditorComponent, setEditorComponent] = React.useState<React.ComponentType<any> | null>(null);

    React.useEffect(() => {
        if (Platform.OS !== 'web') return;
        // Dynamic import to keep native bundle clean
        import('@/components/CodeEditor').then((mod) => {
            setEditorComponent(() => mod.CodeEditor);
        });
    }, []);

    if (!EditorComponent) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            </View>
        );
    }

    return (
        <View style={{ flex: 1 }}>
            <EditorComponent
                value={value}
                onChange={onChange}
                language={language}
                darkMode={theme.dark}
                readOnly={readOnly}
            />
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    outer: {
        flex: 1,
    },
    imagePreviewContent: {
        flexGrow: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
    },
    documentPreview: {
        flex: 1,
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        backgroundColor: 'white',
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
    },
    actionButtonText: {
        fontSize: 13,
        fontWeight: '600',
        color: 'white',
        ...Typography.default('semiBold'),
    },
    actionButtonTextSecondary: {
        fontSize: 13,
        fontWeight: '600',
        ...Typography.default('semiBold'),
    },
    toggleRow: {
        flexDirection: 'row',
        gap: 2,
        padding: 2,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        marginRight: 4,
    },
    toggleButton: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
    },
    toggleText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    toggleTextActive: {
        fontWeight: '600',
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    warningBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderBottomWidth: 1,
    },
    warningText: {
        fontSize: 13,
        ...Typography.default('semiBold'),
    },
    warningAction: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
        borderWidth: 1,
        marginLeft: 4,
    },
    warningActionText: {
        fontSize: 12,
        ...Typography.default('semiBold'),
    },
    conflictHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
    },
    conflictTitle: {
        fontSize: 13,
        ...Typography.default(),
        flexShrink: 1,
    },
    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
}));
