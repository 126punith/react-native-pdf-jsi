/**
 * PDFText - Native text extraction, optional OCR, searchable PDF, and custom engines.
 *
 * Modes:
 * - text: embedded PDF text only (Pdfium / PDFKit)
 * - ocr: rasterize pages and run OCR (Vision / ML Kit / custom engine)
 * - auto: prefer embedded text; OCR when page text is empty/short
 *
 * @author Punith M
 */

import { Platform } from 'react-native';
import { openPdf, getPdfLibrary } from './PDFJSI';

let customOCREngine = null;

function nativeAvailable() {
    return true;
}

async function withDocument(filePath, fn) {
    const document = await openPdf(filePath);
    return fn(document);
}

async function pageCountOf(filePath) {
    return withDocument(filePath, (document) => document.pageCount);
}

async function textFromPage(filePath, pageIndex) {
    return withDocument(filePath, (document) => document.extractText(pageIndex));
}

async function pageSizeOf(filePath, pageIndex) {
    return withDocument(filePath, (document) => document.pageSize(pageIndex));
}

function objectToMap(obj) {
    const map = new Map();
    if (!obj || typeof obj !== 'object') return map;
    Object.keys(obj).forEach((key) => {
        const idx = Number(key);
        map.set(Number.isNaN(idx) ? key : idx, obj[key] ?? '');
    });
    return map;
}

/** Normalize ocrOptions before forwarding to native / custom engines. */
function normalizeOcrOptions(ocrOptions = {}) {
    const out = { ...ocrOptions };
    if (out.fast != null) out.fast = !!out.fast;
    if (out.languages != null && !Array.isArray(out.languages)) {
        delete out.languages;
    }
    return out;
}

function parseRect(rectStr) {
    if (!rectStr || typeof rectStr !== 'string') return null;
    const parts = rectStr.split(',').map((p) => Number(p.trim()));
    if (parts.length < 4 || parts.some((n) => Number.isNaN(n))) return null;
    return { left: parts[0], top: parts[1], right: parts[2], bottom: parts[3] };
}

/**
 * Convert image-pixel rect (top-left origin) to PDF points (bottom-left / y-up:
 * "left,top,right,bottom" with top > bottom), matching searchTextDirect / highlightRects.
 */
function imageRectToPdfRect(rectStr, imageWidth, imageHeight, pageWidthPt, pageHeightPt) {
    const r = parseRect(rectStr);
    if (!r || !imageWidth || !imageHeight || !pageWidthPt || !pageHeightPt) return null;
    const sx = pageWidthPt / imageWidth;
    const sy = pageHeightPt / imageHeight;
    const left = r.left * sx;
    const right = r.right * sx;
    const topFromTop = Math.min(r.top, r.bottom) * sy;
    const bottomFromTop = Math.max(r.top, r.bottom) * sy;
    const pdfTop = pageHeightPt - topFromTop;
    const pdfBottom = pageHeightPt - bottomFromTop;
    return `${left},${pdfTop},${right},${pdfBottom}`;
}

async function exportPageImage(filePath, pageIndex0, dpi) {
    const scale = Math.max(1, dpi / 72);
    return withDocument(filePath, (document) => document.exportPageToImage(pageIndex0, scale));
}

async function runNativeOCR() {
    throw new Error('Image-path OCR was removed in 5.0. Use PDFText.recognizePage(filePath, pageIndex).');
}

async function runOCROnImage(imagePath, ocrOptions = {}) {
    if (customOCREngine && typeof customOCREngine.recognize === 'function') {
        const result = await customOCREngine.recognize(imagePath, ocrOptions);
        if (typeof result === 'string') {
            return { text: result, blocks: [], engine: 'custom' };
        }
        return {
            text: result?.text ?? '',
            blocks: result?.blocks ?? [],
            engine: result?.engine || 'custom',
            imageWidth: result?.imageWidth,
            imageHeight: result?.imageHeight,
        };
    }
    return runNativeOCR(imagePath, ocrOptions);
}

/**
 * Prefer in-memory recognizePage; fall back to export + recognizeImage.
 * Custom engines always use a temp export (file path API).
 */
async function runPageOCR(filePath, pageIndex0, ocrDpi, ocrFormat, ocrOptions) {
    const opts = { ...ocrOptions, dpi: ocrDpi };

    if (customOCREngine && typeof customOCREngine.recognize === 'function') {
        const imagePath = await exportPageImage(filePath, pageIndex0, ocrDpi, ocrFormat);
        const result = await runOCROnImage(imagePath, ocrOptions);
        const pageSize = await pageSizeOf(filePath, pageIndex0);
        const imageWidth =
            result.imageWidth || Math.round((pageSize.width * ocrDpi) / 72);
        const imageHeight =
            result.imageHeight || Math.round((pageSize.height * ocrDpi) / 72);
        return {
            ...result,
            imagePath,
            imageWidth,
            imageHeight,
            pageSize,
            tempImage: true,
        };
    }

    if (getPdfLibrary().ocrAvailable) {
        try {
            const text = await withDocument(filePath, (document) =>
                document.recognizeText(pageIndex0, !!opts.fast)
            );
            const result = { text, blocks: [], engine: 'ocr' };
            const pageSize = await pageSizeOf(filePath, pageIndex0);
            return {
                text: result?.text ?? '',
                blocks: result?.blocks ?? [],
                engine: result?.engine || 'ocr',
                imageWidth: result?.imageWidth,
                imageHeight: result?.imageHeight,
                pageSize,
                tempImage: false,
            };
        } catch (e) {
            // Fall through to export path
        }
    }

    const imagePath = await exportPageImage(filePath, pageIndex0, ocrDpi, ocrFormat);
    const result = await runOCROnImage(imagePath, ocrOptions);
            const pageSize = await pageSizeOf(filePath, pageIndex0);
    return {
        ...result,
        imagePath,
        imageWidth:
            result.imageWidth || Math.round((pageSize.width * ocrDpi) / 72),
        imageHeight:
            result.imageHeight || Math.round((pageSize.height * ocrDpi) / 72),
        pageSize,
        tempImage: true,
    };
}

function isNativeTextMode(usedMode) {
    return usedMode === 'text';
}

function isOcrMode(usedMode) {
    return usedMode && usedMode !== 'text';
}

class PDFText {
    static setOCREngine(engine) {
        if (engine != null && typeof engine.recognize !== 'function') {
            throw new Error('OCR engine must implement recognize(imagePath, options)');
        }
        customOCREngine = engine;
    }

    static clearOCREngine() {
        customOCREngine = null;
    }

    static getOCREngine() {
        return customOCREngine;
    }

    static isAvailable() {
        return nativeAvailable();
    }

    static async isOCRAvailable() {
        if (customOCREngine) return true;
        try {
            return !!getPdfLibrary().ocrAvailable;
        } catch {
            return false;
        }
    }

    static async getCapabilities() {
        const ocr = await PDFText.isOCRAvailable();
        return {
            textExtraction: true,
            ocr,
            customEngineSupported: true,
            customEngineRegistered: !!customOCREngine,
            recognizePage: ocr,
            searchablePdf: false,
            platform: Platform.OS,
            ocrBuildEnabled: ocr,
        };
    }

    static async getPageSize(filePath, pageIndex0) {
        return pageSizeOf(filePath, pageIndex0);
    }

    /**
     * Map OCR pageMeta blocks to Pdf `highlightRects`.
     * @param {string} filePath
     * @param {Map|Object} pageMeta - from extract({ includeBlocks: true })
     * @returns {Promise<Array<{ page: number, rect: string }>>}
     */
    static async toHighlightRects(filePath, pageMeta) {
        if (!pageMeta) return [];
        const entries =
            pageMeta instanceof Map
                ? Array.from(pageMeta.entries())
                : Object.keys(pageMeta).map((k) => [Number(k), pageMeta[k]]);

        const highlights = [];
        for (const [pageIndex0, meta] of entries) {
            const blocks = meta?.blocks || [];
            if (!blocks.length) continue;

            let pageSize = meta.pageSize;
            if (!pageSize) {
                pageSize = await this.getPageSize(filePath, pageIndex0);
            }
            const imageWidth = meta.imageSize?.width;
            const imageHeight = meta.imageSize?.height;
            if (!imageWidth || !imageHeight) continue;

            for (const block of blocks) {
                const pdfRect = imageRectToPdfRect(
                    block.rect,
                    imageWidth,
                    imageHeight,
                    pageSize.width,
                    pageSize.height
                );
                if (!pdfRect) continue;
                highlights.push({
                    page: pageIndex0 + 1,
                    rect: pdfRect,
                });
            }
        }
        return highlights;
    }

    /**
     * Sync helper when page sizes / image sizes are already on pageMeta.
     */
    static blocksToHighlightRects(pageMeta) {
        if (!pageMeta) return [];
        const entries =
            pageMeta instanceof Map
                ? Array.from(pageMeta.entries())
                : Object.keys(pageMeta).map((k) => [Number(k), pageMeta[k]]);
        const highlights = [];
        for (const [pageIndex0, meta] of entries) {
            const blocks = meta?.blocks || [];
            const pageSize = meta?.pageSize;
            const imageWidth = meta?.imageSize?.width;
            const imageHeight = meta?.imageSize?.height;
            if (!pageSize || !imageWidth || !imageHeight) continue;
            for (const block of blocks) {
                const pdfRect = imageRectToPdfRect(
                    block.rect,
                    imageWidth,
                    imageHeight,
                    pageSize.width,
                    pageSize.height
                );
                if (!pdfRect) continue;
                highlights.push({ page: pageIndex0 + 1, rect: pdfRect });
            }
        }
        return highlights;
    }

    /**
     * Extract text from a PDF.
     * @returns {Promise<{ pages, fullText, stats, pageMeta? }>}
     */
    static async extract(filePath, options = {}) {
        if (!filePath) {
            throw new Error('filePath is required');
        }
        if (!nativeAvailable()) {
            throw new Error('PDF text extraction is not available');
        }

        const {
            pages = null,
            mode = 'auto',
            minTextLength = 20,
            ocrDpi = 200,
            ocrFormat = 'jpeg',
            ocrOptions: rawOcrOptions = {},
            includeBlocks = false,
            onProgress = null,
        } = options;
        const ocrOptions = normalizeOcrOptions(rawOcrOptions);

        const pageCount = await pageCountOf(filePath);
        let indices;
        if (pages && pages.length) {
            indices = pages.map((p) => p - 1).filter((i) => i >= 0 && i < pageCount);
        } else {
            indices = Array.from({ length: pageCount }, (_, i) => i);
        }

        const pageMap = new Map();
        const pageMeta = includeBlocks ? new Map() : null;
        const ocrAvailable = await this.isOCRAvailable();

        let pagesNative = 0;
        let pagesOcr = 0;
        let pagesEmpty = 0;

        for (let i = 0; i < indices.length; i++) {
            const pageIndex = indices[i];
            let text = '';
            let usedMode = 'text';
            let ocrResult = null;

            if (mode === 'text' || mode === 'auto') {
                text = await textFromPage(filePath, pageIndex);
                text = text || '';
            }

            const needsOcr =
                mode === 'ocr' ||
                (mode === 'auto' && text.trim().length < minTextLength);

            if (needsOcr) {
                if (!ocrAvailable && !customOCREngine) {
                    if (mode === 'ocr') {
                        throw new Error(
                            Platform.OS === 'android'
                                ? 'OCR is not available. Enable with pdfJsiEnableOcr=true (or Expo plugin { ocr: true }) and rebuild, or call PDFText.setOCREngine(...).'
                                : 'OCR is not available on this device. Use PDFText.setOCREngine(...) or iOS 13+.'
                        );
                    }
                } else {
                    ocrResult = await runPageOCR(
                        filePath,
                        pageIndex,
                        ocrDpi,
                        ocrFormat,
                        ocrOptions
                    );
                    text = ocrResult?.text ?? '';
                    usedMode = ocrResult?.engine || 'ocr';
                }
            }

            if (isOcrMode(usedMode)) {
                pagesOcr += 1;
            } else if (isNativeTextMode(usedMode)) {
                pagesNative += 1;
            }
            if (!text || !String(text).trim()) {
                pagesEmpty += 1;
            }

            pageMap.set(pageIndex, text);
            if (pageMeta) {
                const meta = {
                    mode: usedMode,
                    blocks: ocrResult?.blocks || [],
                };
                if (ocrResult?.imageWidth && ocrResult?.imageHeight) {
                    meta.imageSize = {
                        width: ocrResult.imageWidth,
                        height: ocrResult.imageHeight,
                    };
                }
                if (ocrResult?.pageSize) {
                    meta.pageSize = ocrResult.pageSize;
                }
                pageMeta.set(pageIndex, meta);
            }

            if (onProgress) {
                onProgress({
                    page: pageIndex + 1,
                    total: indices.length,
                    mode: usedMode,
                });
            }
        }

        const fullText = Array.from(pageMap.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([, t]) => t)
            .join('\n\n');

        const stats = {
            totalPages: indices.length,
            pagesNative,
            pagesOcr,
            pagesEmpty,
            mode,
        };

        const result = { pages: pageMap, fullText, stats };
        if (pageMeta) result.pageMeta = pageMeta;
        return result;
    }

    /**
     * Build an image + invisible-text searchable PDF (OCR sandwich).
     * Output can be opened and searched with searchTextDirect after load.
     */
    static async makeSearchablePDF(inputPath, options = {}) {
        if (!inputPath) throw new Error('inputPath is required');
        throw new Error('createSearchablePDF was removed in 5.0. Use recognizePage and assemble the PDF in JS.');

        const {
            outputPath = null,
            pages = null,
            mode = 'auto',
            minTextLength = 20,
            ocrDpi = 200,
            ocrFormat = 'jpeg',
            ocrOptions: rawOcrOptions = {},
            onProgress = null,
        } = options;
        const ocrOptions = normalizeOcrOptions(rawOcrOptions);

        const pageCount = await pageCountOf(inputPath);
        let indices;
        if (pages && pages.length) {
            indices = pages.map((p) => p - 1).filter((i) => i >= 0 && i < pageCount);
        } else {
            indices = Array.from({ length: pageCount }, (_, i) => i);
        }

        const outPath =
            outputPath ||
            inputPath.replace(/\.pdf$/i, '') + `_searchable_${Date.now()}.pdf`;

        const payload = [];
        const tempImages = [];
        let pagesNative = 0;
        let pagesOcr = 0;
        let pagesEmpty = 0;

        const ocrAvailable = await this.isOCRAvailable();

        try {
            for (let i = 0; i < indices.length; i++) {
                const pageIndex = indices[i];
                const pageSize = await pageSizeOf(inputPath, pageIndex);

                let text = '';
                let blocks = [];
                let usedMode = 'text';

                if (mode === 'text' || mode === 'auto') {
                    text = await textFromPage(inputPath, pageIndex);
                }

                const needsOcr =
                    mode === 'ocr' ||
                    (mode === 'auto' && text.trim().length < minTextLength);

                // Always rasterize for visual page in searchable output
                const imagePath = await exportPageImage(
                    inputPath,
                    pageIndex,
                    ocrDpi,
                    ocrFormat
                );
                tempImages.push(imagePath);

                const imageWidth = Math.round((pageSize.width * ocrDpi) / 72);
                const imageHeight = Math.round((pageSize.height * ocrDpi) / 72);

                if (needsOcr && (ocrAvailable || customOCREngine)) {
                    const ocrResult = await runOCROnImage(imagePath, ocrOptions);
                    text = ocrResult?.text ?? text;
                    blocks = ocrResult?.blocks || [];
                    usedMode = ocrResult?.engine || 'ocr';
                    pagesOcr += 1;
                } else {
                    pagesNative += 1;
                    if (text.trim()) {
                        // Full-page invisible text when we only have a text layer string
                        blocks = [
                            {
                                text,
                                rect: `0,0,${imageWidth},${imageHeight}`,
                            },
                        ];
                    }
                }

                if (!text || !String(text).trim()) {
                    pagesEmpty += 1;
                }

                payload.push({
                    imagePath,
                    widthPt: pageSize.width,
                    heightPt: pageSize.height,
                    blocks,
                });

                if (onProgress) {
                    onProgress({
                        page: pageIndex + 1,
                        total: indices.length,
                        mode: usedMode,
                    });
                }
            }

            throw new Error('createSearchablePDF was removed in 5.0');
            return {
                outputPath: outPath,
                stats: {
                    totalPages: indices.length,
                    pagesNative,
                    pagesOcr,
                    pagesEmpty,
                    mode,
                },
            };
        } finally {
            // Best-effort cleanup of temp exports (React Native has no RNFS dep)
            void tempImages;
        }
    }

    static async extractTextFromPage(filePath, pageNumber) {
        return textFromPage(filePath, pageNumber);
    }

    static async extractTextFromPages(filePath, pageIndices) {
        const json = await withDocument(filePath, (document) =>
            document.extractTextFromPages(JSON.stringify(pageIndices || []))
        );
        return objectToMap(JSON.parse(json));
    }

    static async extractAllText(filePath) {
        const json = await withDocument(filePath, (document) => document.extractAllText());
        return objectToMap(JSON.parse(json));
    }

    static async getPageCount(filePath) {
        return pageCountOf(filePath);
    }

    static async recognizeImage(imagePath, options = {}) {
        return runOCROnImage(imagePath, normalizeOcrOptions(options));
    }

    /**
     * In-memory OCR for a PDF page (native). Falls back to export path if needed.
     */
    static async recognizePage(filePath, pageIndex0, options = {}) {
        const ocrDpi = options.dpi ?? options.ocrDpi ?? 200;
        const ocrFormat = options.format || options.ocrFormat || 'jpeg';
        const ocrOptions = normalizeOcrOptions(options);
        return runPageOCR(filePath, pageIndex0, ocrDpi, ocrFormat, ocrOptions);
    }
}

export default PDFText;
