import { version } from 'pdfjs-dist/package.json';
import type * as PdfJs from 'pdfjs-dist';

export const pdfAssetRoot = `/pdfjs/${version}/`;
let pending: Promise<typeof PdfJs> | undefined;
let failedAttempts = 0;

export function loadPdfJs(retry = false): Promise<typeof PdfJs> {
    if (retry) {
        pending = undefined;
        failedAttempts += 1;
    }
    if (!pending) {
        pending = new Promise<typeof PdfJs>((resolve, reject) => {
            const suffix = failedAttempts ? `?retry=${failedAttempts}` : '';
            const script = document.createElement('script');
            script.type = 'module';
            script.src = `${pdfAssetRoot}pdf.min.js${suffix}`;
            script.onload = () => {
                const api = (globalThis as typeof globalThis & { pdfjsLib?: typeof PdfJs }).pdfjsLib;
                if (!api || api.version !== version) {
                    reject(new Error('PDF module did not load'));
                    return;
                }
                api.GlobalWorkerOptions.workerSrc = `${pdfAssetRoot}pdf.worker.min.js${suffix}`;
                resolve(api);
            };
            script.onerror = () => reject(new Error('PDF module did not load'));
            document.head.append(script);
        }).catch((error) => {
            pending = undefined;
            failedAttempts += 1;
            throw error;
        });
    }
    return pending;
}
