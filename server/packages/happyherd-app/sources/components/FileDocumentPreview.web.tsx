import * as React from 'react';
import { documentPreviewWebSandbox } from '@/utils/filePreview';
import { useDeviceType } from '@/utils/responsive';
import { MobilePdfPreview } from './MobilePdfPreview.web';

type FileDocumentPreviewProps = {
    kind: 'html' | 'pdf';
    html?: string;
    uri?: string;
    title: string;
    fileName?: string;
    interactive?: boolean;
};

export const FileDocumentPreview = React.memo(function FileDocumentPreview({
    kind,
    html,
    uri,
    title,
    fileName,
    interactive = false,
}: FileDocumentPreviewProps) {
    const deviceType = useDeviceType();
    if (kind === 'pdf' && deviceType === 'phone') {
        return <MobilePdfPreview key={uri} uri={uri} title={title} fileName={fileName} />;
    }
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
