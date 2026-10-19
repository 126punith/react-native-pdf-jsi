/**
 * ExportManager - PDF export and page operations.
 *
 * Page numbers are zero-based. Operations that change a document write a new
 * file (`outputPath`), or replace the source file when no output is given.
 */

import { Platform, Share } from 'react-native';
import PDFTextExtractor from '../utils/PDFTextExtractor';
import { getPdfCache, getPdfLibrary, invalidatePdf, withPdfDocument } from '../PDFJSI';
import { loadNormalizedSource } from '../PdfCache';
import { normalizeSource } from '../source';
import { requirePageIndex } from '../pages';

export const ExportFormat = {
    TEXT: 'text',
    JPEG: 'jpeg',
    PNG: 'png',
    PDF: 'pdf',
};

/** JPEG quality as a fraction; mapped to 0-100 for the native encoder. */
export const ExportQuality = {
    LOW: 0.5,
    MEDIUM: 0.75,
    HIGH: 0.9,
    BEST: 1.0,
};

function normalizeQuality(quality) {
    if (typeof quality === 'number' && Number.isFinite(quality)) {
        return quality <= 1 ? Math.round(quality * 100) : Math.round(quality);
    }
    const named = {
        low: ExportQuality.LOW,
        medium: ExportQuality.MEDIUM,
        high: ExportQuality.HIGH,
        best: ExportQuality.BEST,
    }[String(quality || '').toLowerCase()];
    return Math.round((named ?? ExportQuality.HIGH) * 100);
}

function renderOptions(options = {}) {
    const { format = ExportFormat.JPEG, quality = ExportQuality.HIGH, width, height, scale = 2, background } = options;
    return {
        format: format === ExportFormat.PNG ? 'png' : 'jpeg',
        quality: normalizeQuality(quality),
        scale,
        ...(width ? { maxWidth: width } : {}),
        ...(height ? { maxHeight: height } : {}),
        ...(background ? { background } : {}),
    };
}

export class ExportManager {
    isAvailable() {
        return true;
    }

    // ============================================
    // TEXT
    // ============================================

    /**
     * @param {string} filePath
     * @param {{ pages?: number[], includePageNumbers?: boolean, separator?: string }} options zero-based pages
     */
    async exportToText(filePath, options = {}) {
        const { pages = null, includePageNumbers = true, separator = '\n\n--- Page {page} ---\n\n' } = options;
        const textMap = pages
            ? await PDFTextExtractor.extractTextFromPages(filePath, pages)
            : await PDFTextExtractor.extractAllText(filePath);
        const sortedPages = Array.from(textMap.keys()).sort((a, b) => a - b);
        let result = '';
        sortedPages.forEach((page, index) => {
            if (includePageNumbers && index > 0) {
                result += separator.replace('{page}', String(page + 1));
            }
            result += textMap.get(page) || '';
        });
        return result;
    }

    /** @param {number} page zero-based */
    async exportPageToText(filePath, page) {
        return PDFTextExtractor.extractTextFromPage(filePath, requirePageIndex(page));
    }

    // ============================================
    // IMAGES
    // ============================================

    /**
     * Renders pages to image files.
     * @returns {Promise<string[]>} image paths
     */
    async exportToImages(filePath, options = {}) {
        const { pages = undefined } = options;
        const { format, quality, maxWidth, maxHeight, background } = renderOptions(options);
        const images = await withPdfDocument(filePath, (document) =>
            document.renderThumbnails({
                format,
                quality,
                ...(pages ? { pages: pages.map((page) => requirePageIndex(page, document.pageCount)) } : {}),
                ...(maxWidth ? { maxWidth } : {}),
                ...(maxHeight ? { maxHeight } : {}),
                ...(background ? { background } : {}),
                ...(maxWidth || maxHeight ? {} : { maxWidth: Math.round(612 * (options.scale ?? 2)) }),
            })
        );
        return images.map((image) => image.path);
    }

    /**
     * @param {number} page zero-based
     * @returns {Promise<string>} image path
     */
    async exportPageToImage(filePath, page, options = {}) {
        const image = await withPdfDocument(filePath, (document) =>
            document.renderPage(requirePageIndex(page, document.pageCount), renderOptions(options))
        );
        return image.path;
    }

    // ============================================
    // PDF OPERATIONS
    // ============================================

    /** Downloads http(s) URLs natively; local paths are returned as they are. */
    async resolveMergePath(filePath) {
        if (typeof filePath !== 'string' || filePath.trim() === '') {
            throw new Error('Merge path must be a file path or http(s) URL');
        }
        const trimmed = filePath.trim();
        if (!/^https?:\/\//i.test(trimmed)) {
            return trimmed;
        }
        const loaded = await loadNormalizedSource(normalizeSource({ uri: trimmed, cache: 'session' }));
        return loaded.path;
    }

    async mergePDFs(filePaths, outputPath = null) {
        const localPaths = [];
        for (const filePath of filePaths) {
            localPaths.push(await this.resolveMergePath(filePath));
        }
        return getPdfLibrary().mergePDFs(localPaths, outputPath || '');
    }

    /**
     * @param {Array<[number, number]>} ranges zero-based inclusive [start, end] pairs
     * @returns {Promise<string[]>}
     */
    async splitPDF(filePath, ranges, outputDir = null) {
        const pairs = ranges.map((range) => {
            const [start, end = start] = Array.isArray(range) ? range : [range, range];
            return [requirePageIndex(start), requirePageIndex(end)];
        });
        const raw = await getPdfLibrary().splitPDF(filePath, JSON.stringify(pairs), outputDir || '');
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
    }

    /** @param {number[]} pages zero-based */
    async extractPages(filePath, pages, outputPath = null) {
        const indices = pages.map((page) => requirePageIndex(page));
        return getPdfLibrary().extractPages(filePath, JSON.stringify(indices), outputPath || '');
    }

    async _editAndSave(filePath, outputPath, edit) {
        const target = outputPath || filePath;
        const saved = await withPdfDocument(filePath, async (document) => {
            await edit(document);
            return document.save(target);
        });
        invalidatePdf(target);
        return saved;
    }

    /** @param {Record<number, number>} rotations zero-based page -> degrees */
    async rotatePages(filePath, rotations, outputPath = null) {
        return this._editAndSave(filePath, outputPath, async (document) => {
            for (const [page, degrees] of Object.entries(rotations || {})) {
                await document.rotatePage(requirePageIndex(Number(page), document.pageCount), Number(degrees));
            }
        });
    }

    /** @param {number[]} pages zero-based */
    async deletePages(filePath, pages, outputPath = null) {
        return this._editAndSave(filePath, outputPath, async (document) => {
            const indices = [...new Set(pages.map((page) => requirePageIndex(page, document.pageCount)))].sort(
                (a, b) => b - a
            );
            for (const index of indices) {
                await document.deletePage(index);
            }
        });
    }

    // ============================================
    // SHARE
    // ============================================

    async share(content, options = {}) {
        const { title = 'Exported from PDF', message = null, type = 'text' } = options;
        const shareOptions = { title };
        if (type === 'text') {
            shareOptions.message = content;
        } else {
            shareOptions.url = content.startsWith('file://') ? content : `file://${content}`;
            if (message) {
                shareOptions.message = message;
            }
        }
        return Share.share(shareOptions);
    }

    async exportAndShareText(filePath, options = {}) {
        const text = await this.exportToText(filePath, options);
        return this.share(text, { title: 'PDF Text Export', type: 'text' });
    }

    /** @param {number} page zero-based */
    async exportAndShareImage(filePath, page, options = {}) {
        const imagePath = await this.exportPageToImage(filePath, page, options);
        return this.share(imagePath, { title: `PDF Page ${page + 1}`, type: 'file' });
    }

    // ============================================
    // BATCH
    // ============================================

    /** @param {number[]} pages zero-based */
    async exportPagesToImages(filePath, pages, options = {}, onProgress = null) {
        const imagePaths = [];
        for (let index = 0; index < pages.length; index++) {
            const imagePath = await this.exportPageToImage(filePath, pages[index], options);
            imagePaths.push(imagePath);
            if (onProgress) {
                onProgress(index + 1, pages.length, imagePath);
            }
        }
        return imagePaths;
    }

    /** @param {number[]} pages zero-based */
    async exportPagesToText(filePath, pages, onProgress = null) {
        const textMap = await PDFTextExtractor.extractTextFromPages(filePath, pages);
        if (onProgress) {
            onProgress(textMap.size, pages.length);
        }
        return textMap;
    }

    getCapabilities() {
        return {
            exportToText: true,
            exportToImages: true,
            mergePDFs: true,
            splitPDF: true,
            extractPages: true,
            rotatePages: true,
            deletePages: true,
            ocrViaPDFText: true,
            share: true,
        };
    }

    getModuleInfo() {
        return {
            isAvailable: true,
            platform: Platform.OS,
            version: getPdfLibrary().version,
            cacheDirectory: getPdfCache().cacheDirectory,
            capabilities: this.getCapabilities(),
        };
    }
}

const exportManager = new ExportManager();

export default exportManager;
