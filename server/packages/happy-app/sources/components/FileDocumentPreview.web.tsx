import * as React from 'react';
import { documentPreviewWebSandbox } from '@/utils/filePreview';

type FileDocumentPreviewProps = {
    kind: 'html' | 'pdf';
    html?: string;
    uri?: string;
    title: string;
    interactive?: boolean;
};

export const FileDocumentPreview = React.memo(function FileDocumentPreview({
    kind,
    html,
    uri,
    title,
    interactive = false,
}: FileDocumentPreviewProps) {
    return (
        <iframe
            key={interactive ? 'interactive' : 'safe'}
            title={title}
            src={kind === 'pdf' ? uri : undefined}
            srcDoc={kind === 'html' ? html : undefined}
            sandbox={documentPreviewWebSandbox(kind, interactive)}
            referrerPolicy="no-referrer"
            style={{ width: '100%', height: '100%', border: 0, background: 'white' }}
        />
    );
});
