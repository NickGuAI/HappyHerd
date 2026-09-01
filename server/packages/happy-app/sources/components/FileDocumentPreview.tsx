import * as React from 'react';
import { WebView } from 'react-native-webview';

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
}: FileDocumentPreviewProps) {
    return (
        <WebView
            source={kind === 'html' ? { html: html ?? '' } : { uri: uri ?? 'about:blank' }}
            javaScriptEnabled={false}
            domStorageEnabled={false}
            originWhitelist={['about:blank', 'data:*']}
            onShouldStartLoadWithRequest={(request) => (
                request.url === 'about:blank' || request.url.startsWith('data:')
            )}
            setSupportMultipleWindows={false}
            allowingReadAccessToURL="about:blank"
        />
    );
});
