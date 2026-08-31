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
import { sessionDeleteFile, sessionReadFile, sessionWriteFile } from '@/sync/ops';
import { Modal } from '@/modal';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { layout } from '@/components/layout';
import { useMachine, useSession } from '@/sync/storage';
import { rigCanWriteFiles, sessionCanDeleteFiles } from '@/sync/rig';
import {
    classifyFilePreview,
    decodeEditableText,
    encodeEditableText,
    imageDataUri,
    imageMimeType,
    imagePreviewLayout,
    isSvgDocument,
    matchesRichPreviewContent,
    pdfDataUri,
    safeHtmlPreviewDocument,
} from '@/utils/filePreview';
import { FileDocumentPreview } from '@/components/FileDocumentPreview';

interface FileViewPanelProps {
    sessionId: string;
    filePath: string;
    active?: boolean;
    headerVariant?: 'standard' | 'desktop-workspace';
    /** Publishes the right-side file controls into the host header. */
    onHeaderRightSlotChange: (slot: React.ReactNode) => void;
    onDirtyChange?: (dirty: boolean) => void;
    onDeleted?: (filePath: string) => void;
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

export type FileContentDeleteResult = {
    success: boolean;
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
    deleteFile?: (filePath: string) => Promise<FileContentDeleteResult>;
    canWrite: boolean;
    markdownSessionId?: string;
    active?: boolean;
    onHeaderRightSlotChange: (slot: React.ReactNode) => void;
    onDirtyChange?: (dirty: boolean) => void;
    onDeleted?: () => void;
    headerVariant?: 'standard' | 'desktop-workspace';
}

type FileState =
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'image'; uri: string }
    | { kind: 'pdf'; uri: string }
    | { kind: 'unsupported'; message: string }
    | { kind: 'loaded'; content: string; originalHash: string | null; hasUtf8Bom: boolean };

type EditableFileSnapshot = {
    content: string;
    hash: string;
    hasUtf8Bom: boolean;
};

type FileDisplayMode = 'source' | 'preview' | 'edit';
type FileSaveStatus = 'idle' | 'saved';

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

function encodeBytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/** Read a byte-safe editable text snapshot, or null for failures and binary content. */
async function readFileContent(
    readFile: FileContentPanelProps['readFile'],
    filePath: string,
): Promise<EditableFileSnapshot | null> {
    const res = await readFile(filePath);
    if (!res.success || typeof res.content !== 'string') return null;
    try {
        const bytes = decodeBase64ToBytes(res.content);
        const decoded = decodeEditableText(bytes);
        if (!decoded) return null;
        return {
            ...decoded,
            hash: await computeSHA256Bytes(bytes),
        };
    } catch {
        return null;
    }
}

/** Compute the exact byte hash expected by the daemon's optimistic write guard. */
async function computeSHA256Bytes(bytes: Uint8Array): Promise<string> {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const hashBuffer = await crypto.subtle.digest('SHA-256', copy.buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export const FileContentPanel = React.memo(function FileContentPanel({
    resourceKey,
    filePath,
    readFile,
    writeFile,
    deleteFile,
    canWrite,
    markdownSessionId,
    active = true,
    headerVariant = 'standard',
    onHeaderRightSlotChange,
    onDirtyChange,
    onDeleted,
}: FileContentPanelProps) {
    const { theme } = useUnistyles();
    const [fileState, setFileState] = React.useState<FileState>({ kind: 'loading' });
    const [editContent, setEditContent] = React.useState('');
    const [isSaving, setIsSaving] = React.useState(false);
    const [isDeleting, setIsDeleting] = React.useState(false);
    const [displayMode, setDisplayMode] = React.useState<FileDisplayMode>('source');
    const [saveStatus, setSaveStatus] = React.useState<FileSaveStatus>('idle');
    const [reloadRevision, setReloadRevision] = React.useState(0);
    const previousViewModeRef = React.useRef<Exclude<FileDisplayMode, 'edit'>>('source');

    // External change detection
    const [externalChange, setExternalChange] = React.useState<EditableFileSnapshot | null>(null);
    const [showConflictDiff, setShowConflictDiff] = React.useState(false);

    const fileName = filePath.split('/').pop() || filePath;
    const language = getFileLanguage(filePath);
    const isMarkdown = language === 'markdown';
    const previewKind = classifyFilePreview(filePath);
    const isHtml = previewKind === 'html';
    const hasSvgPreview = previewKind === 'image'
        && imageMimeType(filePath) === 'image/svg+xml'
        && fileState.kind === 'loaded'
        && isSvgDocument(fileState.content);
    const hasSourcePreview = isMarkdown || isHtml || hasSvgPreview;

    const hasChanges = fileState.kind === 'loaded' && editContent !== fileState.content;

    React.useEffect(() => {
        onDirtyChange?.(hasChanges);
        return () => onDirtyChange?.(false);
    }, [hasChanges, onDirtyChange]);

    // Load file content
    React.useEffect(() => {
        let cancelled = false;
        setFileState({ kind: 'loading' });
        setSaveStatus('idle');
        setExternalChange(null);
        setShowConflictDiff(false);

        (async () => {
            try {
                const fileResponse = await readFile(filePath);

                if (cancelled) return;

                if (!fileResponse.success || typeof fileResponse.content !== 'string') {
                    setFileState({ kind: 'error', message: fileResponse.error || t('files.failedToRead') });
                    return;
                }

                let rawBytes: Uint8Array;
                let decodedContent;
                try {
                    rawBytes = decodeBase64ToBytes(fileResponse.content);
                    decodedContent = decodeEditableText(rawBytes);
                } catch {
                    setFileState({ kind: 'unsupported', message: t('files.cannotDisplayBinary') });
                    return;
                }

                if (
                    previewKind === 'image'
                    && imageMimeType(filePath) !== 'image/svg+xml'
                    && matchesRichPreviewContent(filePath, rawBytes)
                ) {
                    setFileState({ kind: 'image', uri: imageDataUri(filePath, fileResponse.content) });
                    return;
                }
                if (previewKind === 'pdf' && matchesRichPreviewContent(filePath, rawBytes)) {
                    setFileState({ kind: 'pdf', uri: pdfDataUri(fileResponse.content) });
                    return;
                }

                if (!decodedContent) {
                    setFileState({ kind: 'unsupported', message: t('files.cannotDisplayBinary') });
                    return;
                }

                const hash = await computeSHA256Bytes(rawBytes);
                setFileState({
                    kind: 'loaded',
                    content: decodedContent.content,
                    originalHash: hash,
                    hasUtf8Bom: decodedContent.hasUtf8Bom,
                });
                setEditContent(decodedContent.content);
            } catch {
                if (!cancelled) {
                    setFileState({ kind: 'error', message: t('files.failedToRead') });
                }
            }
        })();

        return () => { cancelled = true; };
    }, [resourceKey, filePath, previewKind, readFile, reloadRevision]);

    React.useEffect(() => {
        const defaultMode = hasSourcePreview ? 'preview' : 'source';
        previousViewModeRef.current = defaultMode;
        setDisplayMode(defaultMode);
    }, [filePath, hasSourcePreview]);

    const handleDisplayModeChange = React.useCallback((mode: FileDisplayMode) => {
        if (mode === 'edit') {
            if (displayMode !== 'edit') {
                previousViewModeRef.current = displayMode;
            }
            setSaveStatus('idle');
        } else {
            previousViewModeRef.current = mode;
        }
        setDisplayMode(mode);
    }, [displayMode]);

    const handleEditContentChange = React.useCallback((content: string) => {
        setEditContent(content);
        setSaveStatus('idle');
    }, []);

    const handleCancel = React.useCallback(() => {
        if (fileState.kind !== 'loaded' || isSaving) return;
        setEditContent(fileState.content);
        setSaveStatus('idle');
        setShowConflictDiff(false);
        setDisplayMode(previousViewModeRef.current);
    }, [fileState, isSaving]);

    // Poll for external changes every 5s
    React.useEffect(() => {
        if (!active || fileState.kind !== 'loaded' || !fileState.originalHash) return;
        const originalHash = fileState.originalHash;

        const interval = setInterval(async () => {
            const snapshot = await readFileContent(readFile, filePath);
            if (snapshot && snapshot.hash !== originalHash) {
                setExternalChange(snapshot);
            }
        }, 5000);

        return () => clearInterval(interval);
    }, [active, resourceKey, filePath, fileState, readFile]);

    const handleReload = React.useCallback(() => {
        if (externalChange === null) return;
        setExternalChange(null);
        setShowConflictDiff(false);
        // Re-enter the complete load path so an externally replaced image,
        // PDF, or binary file cannot inherit the old editable-text state.
        setReloadRevision((revision) => revision + 1);
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
            const savedBytes = encodeEditableText(editContent, fileState.hasUtf8Bom);
            const base64 = encodeBytesToBase64(savedBytes);
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
            const savedHash = response.hash ?? await computeSHA256Bytes(savedBytes);
            setFileState({
                kind: 'loaded',
                content: editContent,
                originalHash: savedHash,
                hasUtf8Bom: fileState.hasUtf8Bom,
            });
            setSaveStatus('saved');
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
            const currentHash = serverContent?.hash;

            const savedBytes = encodeEditableText(editContent, fileState.hasUtf8Bom);
            const base64 = encodeBytesToBase64(savedBytes);
            const response = await writeFile(filePath, base64, currentHash);

            if (!response.success) {
                Modal.alert(t('common.error'), response.error || t('files.failedToSave'));
                return;
            }

            const savedHash = response.hash ?? await computeSHA256Bytes(savedBytes);
            setFileState({
                kind: 'loaded',
                content: editContent,
                originalHash: savedHash,
                hasUtf8Bom: fileState.hasUtf8Bom,
            });
            setSaveStatus('saved');
            setExternalChange(null);
            setShowConflictDiff(false);
        } finally {
            setIsSaving(false);
        }
    }, [filePath, editContent, fileState, canWrite, readFile, writeFile]);

    const handleDelete = React.useCallback(async () => {
        if (!canWrite || !deleteFile || isDeleting) return;
        const confirmed = await Modal.confirm(
            t('files.deleteFileTitle'),
            t('files.deleteFileDescription'),
            {
                cancelText: t('common.cancel'),
                confirmText: t('files.deleteFile'),
                destructive: true,
            },
        );
        if (!confirmed) return;

        setIsDeleting(true);
        try {
            const response = await deleteFile(filePath);
            if (!response.success) {
                Modal.alert(t('common.error'), response.error || t('files.failedToDelete'));
                return;
            }
            onDeleted?.();
        } finally {
            setIsDeleting(false);
        }
    }, [canWrite, deleteFile, filePath, isDeleting, onDeleted]);

    // Publish the focused Preview/Edit controls and the separate Delete action
    // into the host header. Internally, plain text still uses the read-only
    // source renderer for Preview; the user-facing mode remains Preview.
    const isLoaded = fileState.kind === 'loaded';
    React.useEffect(() => {
        if (!active) {
            onHeaderRightSlotChange(null);
            return;
        }
        onHeaderRightSlotChange(
            <FileHeaderRight
                hasSourcePreview={hasSourcePreview}
                isLoaded={isLoaded}
                displayMode={displayMode}
                onDisplayModeChange={handleDisplayModeChange}
                canWrite={canWrite}
                canDelete={headerVariant === 'desktop-workspace' && canWrite && Boolean(deleteFile)}
                deleting={isDeleting}
                onDelete={handleDelete}
            />
        );
        return () => onHeaderRightSlotChange(null);
    }, [active, canWrite, deleteFile, displayMode, handleDelete, handleDisplayModeChange, hasSourcePreview, headerVariant, isDeleting, isLoaded, onHeaderRightSlotChange]);

    const saveStatusLabel = isSaving
        ? t('uiCopy.saving')
        : hasChanges
            ? t('uiCopy.unsaved')
            : saveStatus === 'saved'
                ? t('uiCopy.saved')
                : null;
    const showEditActions = canWrite
        && isLoaded
        && (displayMode === 'edit' || hasChanges || saveStatus === 'saved');

    return (
        <View style={styles.outer}>
            {showEditActions && (
                <View style={[styles.editorActionBar, { borderBottomColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}>
                    {saveStatusLabel ? (
                        <Text
                            accessibilityLiveRegion="polite"
                            style={[
                                styles.saveStatus,
                                { color: hasChanges ? theme.colors.warning : theme.colors.textSecondary },
                            ]}
                        >
                            {saveStatusLabel}
                        </Text>
                    ) : null}
                    <View style={{ flex: 1 }} />
                    <Pressable
                        accessibilityRole="button"
                        disabled={isSaving}
                        onPress={handleCancel}
                        style={({ pressed }) => [
                            styles.secondaryActionButton,
                            { borderColor: theme.colors.divider, opacity: isSaving ? 0.5 : pressed ? 0.75 : 1 },
                        ]}
                    >
                        <Text style={[styles.actionButtonTextSecondary, { color: theme.colors.text }]}>
                            {t('common.cancel')}
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        disabled={!hasChanges || isSaving}
                        onPress={handleSave}
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
                </View>
            )}
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
                            newFile={{ name: fileName + ' (on device)', contents: externalChange.content }}
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
            ) : hasSvgPreview && displayMode === 'preview' ? (
                <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={styles.imagePreviewContent}
                    maximumZoomScale={4}
                    minimumZoomScale={1}
                >
                    <Image
                        source={{
                            uri: imageDataUri(
                                filePath,
                                encodeBytesToBase64(encodeEditableText(editContent, fileState.hasUtf8Bom)),
                            ),
                        }}
                        style={[imagePreviewLayout, { maxWidth: layout.maxWidth }]}
                        contentFit="contain"
                        accessibilityLabel={t("uiCopy.previewOfValue", { value1: fileName })}
                    />
                </ScrollView>
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
                        onChange={handleEditContentChange}
                        language={language}
                        readOnly={!canWrite || displayMode !== 'edit'}
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
    active = true,
    headerVariant = 'standard',
    onHeaderRightSlotChange,
    onDirtyChange,
    onDeleted,
}: FileViewPanelProps) {
    const session = useSession(sessionId);
    const machine = useMachine(session?.metadata?.machineId ?? '');
    const canWrite = rigCanWriteFiles(session?.metadata);
    const canDelete = sessionCanDeleteFiles(session?.metadata, machine?.metadata);
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
    const deleteFile = React.useCallback(
        (path: string) => sessionDeleteFile(sessionId, path),
        [sessionId],
    );

    return (
        <FileContentPanel
            resourceKey={`session:${sessionId}`}
            filePath={filePath}
            readFile={readFile}
            writeFile={writeFile}
            deleteFile={canDelete && headerVariant === 'desktop-workspace' ? deleteFile : undefined}
            canWrite={canWrite}
            markdownSessionId={sessionId}
            active={active}
            headerVariant={headerVariant}
            onHeaderRightSlotChange={onHeaderRightSlotChange}
            onDirtyChange={onDirtyChange}
            onDeleted={() => onDeleted?.(filePath)}
        />
    );
});

/** Right-side header controls for the file-view overlay. */
const FileHeaderRight = React.memo(function FileHeaderRight({
    hasSourcePreview,
    isLoaded,
    displayMode,
    onDisplayModeChange,
    canWrite,
    canDelete,
    deleting,
    onDelete,
}: {
    hasSourcePreview: boolean;
    isLoaded: boolean;
    displayMode: FileDisplayMode;
    onDisplayModeChange: (mode: FileDisplayMode) => void;
    canWrite: boolean;
    canDelete: boolean;
    deleting: boolean;
    onDelete: () => void;
}) {
    const { theme } = useUnistyles();
    const showControls = (isLoaded && (hasSourcePreview || canWrite)) || canDelete;
    const previewMode: Exclude<FileDisplayMode, 'edit'> = hasSourcePreview ? 'preview' : 'source';
    const previewSelected = isLoaded && displayMode !== 'edit';
    return (
        <>
            {showControls && (
                <View style={[styles.toggleRow, { backgroundColor: theme.colors.groupped.background, borderColor: theme.colors.divider }]}>
                    {isLoaded && <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: previewSelected }}
                        onPress={() => onDisplayModeChange(previewMode)}
                        style={[
                            styles.toggleButton,
                            previewSelected && { backgroundColor: theme.colors.surface },
                        ]}
                    >
                        <Text style={[
                            styles.toggleText,
                            { color: theme.colors.textSecondary },
                            previewSelected && styles.toggleTextActive,
                            previewSelected && { color: theme.colors.text },
                        ]}>
                            {t('uiCopy.preview')}
                        </Text>
                    </Pressable>}
                    {canWrite && isLoaded && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityState={{ selected: displayMode === 'edit' }}
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
                                {t('files.editFile')}
                            </Text>
                        </Pressable>
                    )}
                    {canDelete && (
                        <Pressable
                            accessibilityRole="button"
                            disabled={deleting}
                            onPress={onDelete}
                            style={[
                                styles.toggleButton,
                                deleting && { opacity: 0.5 },
                            ]}
                        >
                            <Text style={[
                                styles.toggleText,
                                { color: theme.colors.textDestructive },
                            ]}>
                                {t('files.deleteFile')}
                            </Text>
                        </Pressable>
                    )}
                </View>
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
 * Lazy-loads the platform editor implementation without pulling CodeMirror
 * into the native bundle.
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
        // Metro/Webpack resolves the native or web implementation here.
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
    secondaryActionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
        borderWidth: StyleSheet.hairlineWidth,
    },
    editorActionBar: {
        minHeight: 46,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    saveStatus: {
        fontSize: 12,
        ...Typography.default('semiBold'),
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
