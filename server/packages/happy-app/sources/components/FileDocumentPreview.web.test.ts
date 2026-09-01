import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FileDocumentPreview } from './FileDocumentPreview.web';

describe('FileDocumentPreview web embed policy', () => {
    it('lets Chrome built-in PDF viewer load without relaxing HTML previews', () => {
        const pdfMarkup = renderToStaticMarkup(React.createElement(FileDocumentPreview, {
            kind: 'pdf',
            uri: 'data:application/pdf;base64,AAAA',
            title: 'PDF preview',
        }));
        const htmlMarkup = renderToStaticMarkup(React.createElement(FileDocumentPreview, {
            kind: 'html',
            html: '<p>HTML preview</p>',
            title: 'HTML preview',
        }));

        expect(pdfMarkup).toContain('src="data:application/pdf;base64,AAAA"');
        expect(pdfMarkup).not.toContain('sandbox=');
        expect(htmlMarkup).toContain('sandbox=""');
        expect(htmlMarkup).not.toContain('src="data:application/pdf');
    });

    it('adds only script execution when interactive HTML is selected', () => {
        const htmlMarkup = renderToStaticMarkup(React.createElement(FileDocumentPreview, {
            kind: 'html',
            html: '<script>document.body.dataset.ready = "yes"</script>',
            title: 'Interactive HTML preview',
            interactive: true,
        }));

        expect(htmlMarkup).toContain('sandbox="allow-scripts"');
        expect(htmlMarkup).not.toContain('allow-same-origin');
        expect(htmlMarkup).not.toContain('allow-forms');
        expect(htmlMarkup).not.toContain('allow-popups');
        expect(htmlMarkup).toContain('referrerPolicy="no-referrer"');
    });
});
