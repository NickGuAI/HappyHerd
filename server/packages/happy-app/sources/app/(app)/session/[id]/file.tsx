import * as React from 'react';
import { View, ScrollView, ActivityIndicator, Platform, Pressable, TextInput } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { Text } from '@/components/StyledText';
import { SimpleSyntaxHighlighter } from '@/components/SimpleSyntaxHighlighter';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { Typography } from '@/constants/Typography';
import { sessionReadFile, sessionWriteFile, sessionBash } from '@/sync/ops';
import { storage, useSessionFileCache } from '@/sync/storage';
import { Modal } from '@/modal';
import { useUnistyles, StyleSheet } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import { t } from '@/text';
import { FileIcon } from '@/components/FileIcon';
import { resolveSessionFilePath } from '@/utils/sessionFileLinks';
import { MobileGlassSurface } from '@/components/MobileGlass';
import {
    classifyFilePreview,
    imageDataUri,
    pdfDataUri,
    safeHtmlPreviewDocument,
    type FilePreviewKind,
} from '@/utils/filePreview';
import { FileDocumentPreview } from '@/components/FileDocumentPreview';
import { rigCanWriteFiles } from '@/sync/rig';

interface FileContent {
    content: string;
    encoding: 'utf8' | 'base64';
    isBinary: boolean;
    previewKind: FilePreviewKind;
    previewUri?: string;
    originalHash?: string | null;
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

function encodeStringToBase64(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 1) {
        binary += String.fromCharCode(bytes[index]);
    }
    return btoa(binary);
}

async function computeSHA256Bytes(bytes: Uint8Array): Promise<string> {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const hashBuffer = await crypto.subtle.digest('SHA-256', copy.buffer);
    return Array.from(new Uint8Array(hashBuffer)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readTextFile(sessionId: string, filePath: string): Promise<{ content: string; hash: string } | null> {
    const response = await sessionReadFile(sessionId, filePath);
    if (!response.success || typeof response.content !== 'string') return null;
    const bytes = decodeBase64ToBytes(response.content);
    return { content: decodeUtf8Bytes(bytes), hash: await computeSHA256Bytes(bytes) };
}

// Diff display component
const DiffDisplay: React.FC<{ diffContent: string }> = ({ diffContent }) => {
    const { theme } = useUnistyles();
    const lines = diffContent.split('\n');

    return (
        <View>
            {lines.map((line, index) => {
                const baseStyle = { ...Typography.mono(), fontSize: 14, lineHeight: 20 };
                let lineStyle: any = baseStyle;
                let backgroundColor = 'transparent';

                if (line.startsWith('+') && !line.startsWith('+++')) {
                    lineStyle = { ...baseStyle, color: theme.colors.diff.addedText };
                    backgroundColor = theme.colors.diff.addedBg;
                } else if (line.startsWith('-') && !line.startsWith('---')) {
                    lineStyle = { ...baseStyle, color: theme.colors.diff.removedText };
                    backgroundColor = theme.colors.diff.removedBg;
                } else if (line.startsWith('@@')) {
                    lineStyle = { ...baseStyle, color: theme.colors.diff.hunkHeaderText, fontWeight: '600' };
                    backgroundColor = theme.colors.diff.hunkHeaderBg;
                } else if (line.startsWith('+++') || line.startsWith('---')) {
                    lineStyle = { ...baseStyle, color: theme.colors.text, fontWeight: '600' };
                } else {
                    lineStyle = { ...baseStyle, color: theme.colors.diff.contextText };
                }

                return (
                    <View
                        key={index}
                        style={{
                            backgroundColor,
                            paddingHorizontal: 8,
                            paddingVertical: 1,
                            borderLeftWidth: line.startsWith('+') && !line.startsWith('+++') ? 3 :
                                           line.startsWith('-') && !line.startsWith('---') ? 3 : 0,
                            borderLeftColor: line.startsWith('+') && !line.startsWith('+++') ? theme.colors.diff.addedBorder : theme.colors.diff.removedBorder
                        }}
                    >
                        <Text style={lineStyle}>
                            {line || ' '}
                        </Text>
                    </View>
                );
            })}
        </View>
    );
};

export default React.memo(function FileScreen() {
    const { theme } = useUnistyles();
    const navigation = useNavigation();
    const { id: sessionId } = useLocalSearchParams<{ id: string }>();
    const searchParams = useLocalSearchParams();
    const encodedPath = searchParams.path as string;
    const lineParam = searchParams.line as string | undefined;
    const columnParam = searchParams.column as string | undefined;
    const requestedLine = lineParam ? Number.parseInt(lineParam, 10) : null;
    const requestedColumn = columnParam ? Number.parseInt(columnParam, 10) : null;
    const session = storage.getState().sessions[sessionId!];
    const canWrite = rigCanWriteFiles(session?.metadata);
    const sessionPath = session?.metadata?.path ?? null;
    let rawPath = '';

    // Decode base64 path with error handling
    try {
        rawPath = encodedPath ? atob(encodedPath) : '';
    } catch (error) {
        console.error('Failed to decode file path:', error);
        rawPath = encodedPath || '';
    }
    const resolvedPath = resolveSessionFilePath(rawPath, sessionPath);
    const filePath = resolvedPath?.absolutePath ?? rawPath;
    const gitDiffPath = resolvedPath?.withinSessionRoot ? resolvedPath.relativePath : null;

    // Read from Zustand cache for instant rendering on revisit
    const cached = useSessionFileCache(sessionId!, filePath);

    const [fileContent, setFileContent] = React.useState<FileContent | null>(() => {
        if (!cached) return null;
        return {
            content: cached.content ?? '',
            encoding: 'utf8',
            isBinary: cached.isBinary,
            previewKind: classifyFilePreview(filePath),
            originalHash: null,
        };
    });
    const [diffContent, setDiffContent] = React.useState<string | null>(() => cached?.diff ?? null);
    const [displayMode, setDisplayMode] = React.useState<'file' | 'diff'>('diff');
    const [isLoading, setIsLoading] = React.useState(!cached);
    const [error, setError] = React.useState<string | null>(null);
    const [editContent, setEditContent] = React.useState(cached?.content ?? '');
    const [sourceMode, setSourceMode] = React.useState<'source' | 'preview'>('source');
    const [isEditing, setIsEditing] = React.useState(false);
    const [isSaving, setIsSaving] = React.useState(false);
    const [externalChange, setExternalChange] = React.useState<{ content: string; hash: string } | null>(null);
    const scrollViewRef = React.useRef<ScrollView | null>(null);
    const allowDiscardRef = React.useRef(false);

    // Determine file language from extension
    const getFileLanguage = React.useCallback((path: string): string | null => {
        const ext = path.split('.').pop()?.toLowerCase();
        switch (ext) {
            case 'js':
            case 'jsx':
                return 'javascript';
            case 'ts':
            case 'tsx':
                return 'typescript';
            case 'py':
                return 'python';
            case 'html':
            case 'htm':
                return 'html';
            case 'css':
                return 'css';
            case 'json':
                return 'json';
            case 'md':
                return 'markdown';
            case 'xml':
                return 'xml';
            case 'yaml':
            case 'yml':
                return 'yaml';
            case 'sh':
            case 'bash':
                return 'bash';
            case 'sql':
                return 'sql';
            case 'go':
                return 'go';
            case 'rust':
            case 'rs':
                return 'rust';
            case 'java':
                return 'java';
            case 'c':
                return 'c';
            case 'cpp':
            case 'cc':
            case 'cxx':
                return 'cpp';
            case 'php':
                return 'php';
            case 'rb':
                return 'ruby';
            case 'swift':
                return 'swift';
            case 'kt':
                return 'kotlin';
            default:
                return null;
        }
    }, []);

    // Load file content (fetches in background even if cache exists)
    React.useEffect(() => {
        let isCancelled = false;

        const loadFile = async () => {
            try {
                // Only show loading spinner if no cache
                if (!cached) {
                    setIsLoading(true);
                }
                setError(null);

                const previewKind = classifyFilePreview(filePath);
                if (previewKind === 'unsupported') {
                    if (!isCancelled) {
                        setFileContent({ content: '', encoding: 'base64', isBinary: true, previewKind });
                        storage.getState().applyFileCache(sessionId!, filePath, '', null, true);
                        setIsLoading(false);
                    }
                    return;
                }

                if (previewKind === 'image') {
                    const response = await sessionReadFile(sessionId, filePath);
                    if (!isCancelled) {
                        if (response.success && typeof response.content === 'string') {
                            setFileContent({ content: '', encoding: 'base64', isBinary: false, previewKind, previewUri: imageDataUri(filePath, response.content) });
                        } else {
                            setError(response.error || t('files.failedToRead'));
                        }
                    }
                    return;
                }

                if (previewKind === 'pdf') {
                    const response = await sessionReadFile(sessionId, filePath);
                    if (!isCancelled) {
                        if (response.success && typeof response.content === 'string') {
                            setFileContent({ content: '', encoding: 'base64', isBinary: false, previewKind, previewUri: pdfDataUri(response.content) });
                        } else {
                            setError(response.error || t('files.failedToRead'));
                        }
                    }
                    return;
                }

                let fetchedDiff: string | null = null;

                // Fetch git diff for the file (if in git repo)
                if (sessionPath && sessionId && gitDiffPath && gitDiffPath !== '.') {
                    try {
                        const diffResponse = await sessionBash(sessionId, {
                            command: `git diff --no-ext-diff -- "${gitDiffPath}"`,
                            cwd: sessionPath,
                            timeout: 5000
                        });

                        if (!isCancelled && diffResponse.success && diffResponse.stdout.trim()) {
                            fetchedDiff = diffResponse.stdout;
                            setDiffContent(fetchedDiff);
                        }
                    } catch (diffError) {
                        console.log('Could not fetch git diff:', diffError);
                    }
                }

                const response = await sessionReadFile(sessionId, filePath);

                if (!isCancelled) {
                    if (response.success && typeof response.content === 'string') {
                        let rawBytes: Uint8Array;
                        let decodedContent: string;
                        try {
                            rawBytes = decodeBase64ToBytes(response.content);
                            decodedContent = decodeUtf8Bytes(rawBytes);
                        } catch (decodeError) {
                            setFileContent({ content: '', encoding: 'base64', isBinary: true, previewKind });
                            storage.getState().applyFileCache(sessionId!, filePath, '', fetchedDiff, true);
                            return;
                        }

                        const hasNullBytes = rawBytes.some((byte) => byte === 0);
                        const nonPrintableCount = decodedContent.split('').filter(char => {
                            const code = char.charCodeAt(0);
                            return code < 32 && code !== 9 && code !== 10 && code !== 13;
                        }).length;
                        const isBinary = hasNullBytes || (nonPrintableCount / decodedContent.length > 0.1);

                        const content = isBinary ? '' : decodedContent;
                        const originalHash = await computeSHA256Bytes(rawBytes);
                        setFileContent({ content, encoding: 'utf8', isBinary, previewKind, originalHash });
                        setEditContent(content);
                        setSourceMode(previewKind === 'html' || filePath.toLowerCase().endsWith('.md') ? 'preview' : 'source');
                        setExternalChange(null);
                        storage.getState().applyFileCache(sessionId!, filePath, content, fetchedDiff, isBinary);
                    } else {
                        setError(response.error || 'Failed to read file');
                    }
                }
            } catch (error) {
                console.error('Failed to load file:', error);
                if (!isCancelled) {
                    setError('Failed to load file');
                }
            } finally {
                if (!isCancelled) {
                    setIsLoading(false);
                }
            }
        };

        loadFile();

        return () => {
            isCancelled = true;
        };
    }, [filePath, gitDiffPath, sessionId, sessionPath]);

    const hasChanges = !!fileContent && !fileContent.isBinary && editContent !== fileContent.content;
    const canEdit = canWrite && typeof fileContent?.originalHash === 'string';

    React.useEffect(() => {
        allowDiscardRef.current = false;
    }, [filePath]);

    React.useEffect(() => navigation.addListener('beforeRemove', (event) => {
        if (!hasChanges || allowDiscardRef.current) return;
        event.preventDefault();
        void Modal.confirm(
            t("uiCopy.discardUnsavedChanges"),
            t("uiCopy.yourEditsToValueHaveNotBeenSaved", { value1: filePath.split('/').pop() || filePath }),
            { confirmText: 'Discard', destructive: true },
        ).then((confirmed) => {
            if (!confirmed) return;
            allowDiscardRef.current = true;
            navigation.dispatch(event.data.action);
        });
    }), [filePath, hasChanges, navigation]);

    React.useEffect(() => {
        if (!fileContent?.originalHash || fileContent.isBinary || !sessionId) return;
        const originalHash = fileContent.originalHash;
        const timer = setInterval(async () => {
            try {
                const latest = await readTextFile(sessionId, filePath);
                if (latest && latest.hash !== originalHash) setExternalChange(latest);
            } catch {
                // Transient daemon/read failures are shown by the next explicit action.
            }
        }, 5000);
        return () => clearInterval(timer);
    }, [fileContent?.originalHash, fileContent?.isBinary, filePath, sessionId]);

    const handleReloadExternal = React.useCallback(() => {
        if (!externalChange || !fileContent) return;
        setFileContent({ ...fileContent, content: externalChange.content, originalHash: externalChange.hash });
        setEditContent(externalChange.content);
        setExternalChange(null);
        storage.getState().applyFileCache(sessionId!, filePath, externalChange.content, diffContent, false);
    }, [diffContent, externalChange, fileContent, filePath, sessionId]);

    const handleSave = React.useCallback(async () => {
        if (!sessionId || !fileContent || !canEdit || !hasChanges) return;
        setIsSaving(true);
        try {
            const response = await sessionWriteFile(
                sessionId,
                filePath,
                encodeStringToBase64(editContent),
                fileContent.originalHash,
            );
            if (!response.success) {
                if (response.error?.toLowerCase().includes('hash')) {
                    const latest = await readTextFile(sessionId, filePath).catch(() => null);
                    if (latest) setExternalChange(latest);
                    Modal.alert(t('files.fileConflict'), t('files.fileConflictDescription'));
                } else {
                    Modal.alert(t('common.error'), response.error || t('files.failedToSave'));
                }
                return;
            }
            const savedHash = response.hash ?? await computeSHA256Bytes(new TextEncoder().encode(editContent));
            const next = { ...fileContent, content: editContent, originalHash: savedHash };
            setFileContent(next);
            setExternalChange(null);
            storage.getState().applyFileCache(sessionId, filePath, editContent, diffContent, false);
        } finally {
            setIsSaving(false);
        }
    }, [canEdit, diffContent, editContent, fileContent, filePath, hasChanges, sessionId]);

    // Show error modal if there's an error
    React.useEffect(() => {
        if (error) {
            Modal.alert(t('common.error'), error);
        }
    }, [error]);

    // Set default display mode based on diff availability
    React.useEffect(() => {
        if (requestedLine !== null && requestedLine > 0) {
            setDisplayMode('file');
        } else if (diffContent) {
            setDisplayMode('diff');
        } else if (fileContent) {
            setDisplayMode('file');
        }
    }, [diffContent, fileContent, requestedLine]);

    React.useEffect(() => {
        if (!fileContent?.content || displayMode !== 'file' || requestedLine === null || requestedLine <= 0) {
            return;
        }
        const offset = Math.max(0, ((requestedLine - 1) * 20) - 40);
        requestAnimationFrame(() => {
            scrollViewRef.current?.scrollTo({ y: offset, animated: false });
        });
    }, [displayMode, fileContent?.content, requestedLine]);

    const fileName = filePath.split('/').pop() || filePath;
    const language = getFileLanguage(filePath);

    if (isLoading) {
        return (
            <View style={{
                flex: 1,
                backgroundColor: Platform.select({ web: theme.colors.surface, default: 'transparent' }),
                justifyContent: 'center',
                alignItems: 'center'
            }}>
                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                <Text style={{
                    marginTop: 16,
                    fontSize: 16,
                    color: theme.colors.textSecondary,
                    ...Typography.default()
                }}>
                    {t('files.loadingFile', { fileName })}
                </Text>
            </View>
        );
    }

    if (error) {
        return (
            <View style={{
                flex: 1,
                backgroundColor: Platform.select({ web: theme.colors.surface, default: 'transparent' }),
                justifyContent: 'center',
                alignItems: 'center',
                padding: 20
            }}>
                <Text style={{
                    fontSize: 18,
                    fontWeight: 'bold',
                    color: theme.colors.textDestructive,
                    marginBottom: 8,
                    ...Typography.default('semiBold')
                }}>
                    {t('common.error')}
                </Text>
                <Text style={{
                    fontSize: 16,
                    color: theme.colors.textSecondary,
                    textAlign: 'center',
                    ...Typography.default()
                }}>
                    {error}
                </Text>
            </View>
        );
    }

    if (fileContent?.isBinary) {
        return (
            <View style={{
                flex: 1,
                backgroundColor: Platform.select({ web: theme.colors.surface, default: 'transparent' }),
                justifyContent: 'center',
                alignItems: 'center',
                padding: 20
            }}>
                <Text style={{
                    fontSize: 18,
                    fontWeight: 'bold',
                    color: theme.colors.textSecondary,
                    marginBottom: 8,
                    ...Typography.default('semiBold')
                }}>
                    {t('files.binaryFile')}
                </Text>
                <Text style={{
                    fontSize: 16,
                    color: theme.colors.textSecondary,
                    textAlign: 'center',
                    ...Typography.default()
                }}>
                    {t('files.cannotDisplayBinary')}
                </Text>
                <Text style={{
                    fontSize: 14,
                    color: '#999',
                    textAlign: 'center',
                    marginTop: 8,
                    ...Typography.default()
                }}>
                    {fileName}
                </Text>
            </View>
        );
    }

    if (fileContent?.previewKind === 'image' && fileContent.previewUri) {
        return (
            <View style={styles.container}>
                <MobileGlassSurface enabled={Platform.OS !== 'web'} intensity={62} style={styles.fileHeader}>
                    <FileIcon fileName={fileName} size={20} />
                    <Text style={styles.filePath} numberOfLines={2}>{filePath}</Text>
                </MobileGlassSurface>
                <View style={styles.imageWrap}>
                    <Image
                        source={{ uri: fileContent.previewUri }}
                        style={styles.imagePreview}
                        contentFit="contain"
                        accessibilityLabel={t("uiCopy.previewOfValue", { value1: fileName })}
                    />
                </View>
            </View>
        );
    }

    if (fileContent?.previewKind === 'pdf' && fileContent.previewUri) {
        return (
            <View style={styles.container}>
                <MobileGlassSurface enabled={Platform.OS !== 'web'} intensity={62} style={styles.fileHeader}>
                    <FileIcon fileName={fileName} size={20} />
                    <Text style={styles.filePath} numberOfLines={2}>{filePath}</Text>
                </MobileGlassSurface>
                <View style={styles.documentPreview}>
                    <FileDocumentPreview kind="pdf" uri={fileContent.previewUri} title={t("uiCopy.previewOfValue", { value1: fileName })} />
                </View>
            </View>
        );
    }

    const hasSourcePreview = fileContent?.previewKind === 'html' || language === 'markdown';

    return (
        <View style={styles.container}>

            {/* File path header */}
            <MobileGlassSurface enabled={Platform.OS !== 'web'} intensity={62} style={{
                padding: 16,
                borderBottomWidth: Platform.select({ web: 1, default: 0.5 }),
                borderBottomColor: Platform.select({ web: theme.colors.divider, default: theme.colors.glass.border }),
                backgroundColor: Platform.select({ web: theme.colors.surfaceHigh, android: theme.colors.glass.backgroundStrong, default: 'transparent' }),
                flexDirection: 'row',
                alignItems: 'center'
            }}>
                <FileIcon fileName={fileName} size={20} />
                <Text style={{
                    fontSize: 14,
                    color: theme.colors.textSecondary,
                    marginLeft: 8,
                    flex: 1,
                    ...Typography.mono()
                }}>
                    {requestedLine !== null && requestedLine > 0
                        ? `${filePath}:${requestedLine}${requestedColumn !== null && requestedColumn > 0 ? `:${requestedColumn}` : ''}`
                        : filePath}
                </Text>
                {hasChanges && (
                    <Text style={[styles.unsavedLabel, { color: theme.colors.warning }]}>{t("uiCopy.unsaved")}</Text>
                )}
                {displayMode === 'file' && hasSourcePreview && (
                    <Pressable
                        onPress={() => setSourceMode(sourceMode === 'preview' ? 'source' : 'preview')}
                        style={[styles.headerButton, { backgroundColor: theme.colors.input.background }]}
                    >
                        <Text style={[styles.headerButtonText, { color: theme.colors.text }]}>
                            {sourceMode === 'preview' ? t("uiCopy.source") : t("uiCopy.preview")}
                        </Text>
                    </Pressable>
                )}
                {displayMode === 'file' && canEdit && sourceMode === 'source' && (
                    <Pressable
                        onPress={() => setIsEditing((value) => !value)}
                        style={[styles.headerButton, { backgroundColor: theme.colors.input.background }]}
                    >
                        <Text style={[styles.headerButtonText, { color: theme.colors.text }]}>
                            {isEditing ? t("uiCopy.done") : t("files.editFile")}
                        </Text>
                    </Pressable>
                )}
                {displayMode === 'file' && canEdit && hasChanges && (
                    <Pressable
                        onPress={handleSave}
                        disabled={isSaving}
                        style={[styles.headerButton, { backgroundColor: theme.colors.textLink, opacity: isSaving ? 0.6 : 1 }]}
                    >
                        <Text style={[styles.headerButtonText, { color: 'white' }]}>{isSaving ? t("uiCopy.saving") : t("files.saveFile")}</Text>
                    </Pressable>
                )}
            </MobileGlassSurface>

            {externalChange && (
                <View style={[styles.warningBar, { borderBottomColor: theme.colors.divider, backgroundColor: `${theme.colors.warning}18` }]}>
                    <Ionicons name="alert-circle-outline" size={18} color={theme.colors.warning} />
                    <Text style={[styles.warningText, { color: theme.colors.text }]}>{t("uiCopy.thisFileChangedOnTheHost")}</Text>
                    <View style={{ flex: 1 }} />
                    <Pressable onPress={handleReloadExternal} style={styles.warningAction}>
                        <Text style={{ color: theme.colors.textLink }}>{t("files.reload")}</Text>
                    </Pressable>
                    <Pressable onPress={() => setExternalChange(null)} style={styles.warningAction}>
                        <Text style={{ color: theme.colors.textSecondary }}>{t("agentQuestion.dismiss")}</Text>
                    </Pressable>
                </View>
            )}

            {/* Toggle buttons for File/Diff view */}
            {diffContent && (
                <MobileGlassSurface enabled={Platform.OS !== 'web'} intensity={56} style={{
                    flexDirection: 'row',
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderBottomWidth: Platform.select({ web: 1, default: 0.5 }),
                    borderBottomColor: Platform.select({ web: theme.colors.divider, default: theme.colors.glass.border }),
                    backgroundColor: Platform.select({ web: theme.colors.surface, android: theme.colors.glass.backgroundStrong, default: 'transparent' })
                }}>
                    <Pressable
                        onPress={() => setDisplayMode('diff')}
                        style={{
                            paddingHorizontal: 16,
                            paddingVertical: 8,
                            borderRadius: 8,
                            backgroundColor: displayMode === 'diff'
                                ? Platform.select({ web: theme.colors.textLink, default: `${theme.colors.textLink}66` })
                                : Platform.select({ web: theme.colors.input.background, default: theme.colors.glass.backgroundSubtle }),
                            marginRight: 8
                        }}
                    >
                        <Text style={{
                            fontSize: 14,
                            fontWeight: '600',
                            color: displayMode === 'diff' ? 'white' : theme.colors.textSecondary,
                            ...Typography.default()
                        }}>
                            {t('files.diff')}
                        </Text>
                    </Pressable>

                    <Pressable
                        onPress={() => setDisplayMode('file')}
                        style={{
                            paddingHorizontal: 16,
                            paddingVertical: 8,
                            borderRadius: 8,
                            backgroundColor: displayMode === 'file'
                                ? Platform.select({ web: theme.colors.textLink, default: `${theme.colors.textLink}66` })
                                : Platform.select({ web: theme.colors.input.background, default: theme.colors.glass.backgroundSubtle })
                        }}
                    >
                        <Text style={{
                            fontSize: 14,
                            fontWeight: '600',
                            color: displayMode === 'file' ? 'white' : theme.colors.textSecondary,
                            ...Typography.default()
                        }}>
                            {t('files.file')}
                        </Text>
                    </Pressable>
                </MobileGlassSurface>
            )}

            {/* Content display */}
            {displayMode === 'diff' && diffContent ? (
                <ScrollView
                    ref={scrollViewRef}
                    style={{ flex: 1 }}
                    contentContainerStyle={{ padding: 16, maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }}
                    showsVerticalScrollIndicator
                >
                    <DiffDisplay diffContent={diffContent} />
                </ScrollView>
            ) : sourceMode === 'preview' && fileContent?.previewKind === 'html' ? (
                <View style={styles.documentPreview}>
                    <FileDocumentPreview
                        kind="html"
                        html={safeHtmlPreviewDocument(editContent)}
                        title={t("uiCopy.previewOfValue", { value1: fileName })}
                    />
                </View>
            ) : sourceMode === 'preview' && language === 'markdown' ? (
                <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={{ padding: 16, maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }}
                    showsVerticalScrollIndicator
                >
                    <MarkdownView markdown={editContent} sessionId={sessionId!} />
                </ScrollView>
            ) : isEditing && canEdit ? (
                <TextInput
                    value={editContent}
                    onChangeText={setEditContent}
                    multiline
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    textAlignVertical="top"
                    style={[styles.mobileEditor, { color: theme.colors.text, backgroundColor: theme.colors.surface }]}
                    accessibilityLabel={t("uiCopy.editValue", { value1: fileName })}
                />
            ) : (
                <ScrollView
                    ref={scrollViewRef}
                    style={{ flex: 1 }}
                    contentContainerStyle={{ padding: 16, maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }}
                    showsVerticalScrollIndicator
                >
                    {editContent ? (
                    <SimpleSyntaxHighlighter
                        code={editContent}
                        language={language}
                        selectable={true}
                    />
                    ) : fileContent ? (
                    <Text style={{
                        fontSize: 16,
                        color: theme.colors.textSecondary,
                        fontStyle: 'italic',
                        ...Typography.default()
                    }}>
                        {t('files.fileEmpty')}
                    </Text>
                    ) : null}
                </ScrollView>
            )}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        // Header (file path + toggle) spans the full screen width;
        // the code/diff body is bounded by layout.maxWidth on the ScrollView's
        // contentContainerStyle so it lines up with the chat / changes views.
        flex: 1,
        backgroundColor: Platform.select({ web: theme.colors.surface, default: 'transparent' }),
    },
    fileHeader: {
        padding: 16,
        borderBottomWidth: Platform.select({ web: 1, default: 0.5 }),
        borderBottomColor: Platform.select({ web: theme.colors.divider, default: theme.colors.glass.border }),
        backgroundColor: Platform.select({ web: theme.colors.surfaceHigh, android: theme.colors.glass.backgroundStrong, default: 'transparent' }),
        flexDirection: 'row',
        alignItems: 'center',
    },
    filePath: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        marginLeft: 8,
        flex: 1,
        ...Typography.mono(),
    },
    imageWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
    },
    imagePreview: {
        width: '100%',
        height: '100%',
        maxWidth: layout.maxWidth,
    },
    documentPreview: {
        flex: 1,
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        backgroundColor: 'white',
    },
    headerButton: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 7,
        marginLeft: 6,
    },
    headerButtonText: {
        fontSize: 13,
        ...Typography.default('semiBold'),
    },
    unsavedLabel: {
        fontSize: 12,
        marginHorizontal: 6,
        ...Typography.default('semiBold'),
    },
    warningBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderBottomWidth: 1,
    },
    warningText: {
        fontSize: 13,
        ...Typography.default('semiBold'),
    },
    warningAction: {
        paddingHorizontal: 6,
        paddingVertical: 4,
    },
    mobileEditor: {
        flex: 1,
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        padding: 16,
        fontSize: 14,
        lineHeight: 21,
        ...Typography.mono(),
    },
}));
