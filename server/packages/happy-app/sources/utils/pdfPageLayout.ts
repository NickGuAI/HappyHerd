export type PdfSize = { width: number; height: number };
export type PdfPan = { x: number; y: number };

export function fitPdfPage(page: PdfSize, area: PdfSize): number {
    if (page.width <= 0 || page.height <= 0 || area.width <= 0 || area.height <= 0) return 0;
    return Math.min(area.width / page.width, area.height / page.height);
}

export function clampPdfPan(pan: PdfPan, page: PdfSize, area: PdfSize): PdfPan {
    const maxX = Math.max(0, (page.width - area.width) / 2);
    const maxY = Math.max(0, (page.height - area.height) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, pan.x)), y: Math.max(-maxY, Math.min(maxY, pan.y)) };
}
