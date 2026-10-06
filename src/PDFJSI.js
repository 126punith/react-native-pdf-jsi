/**
 * Nitro entry point. Cheap document reads are synchronous on the handle
 * returned by openPdf(). Heavy work stays a single Promise.
 */

import { NitroModules } from 'react-native-nitro-modules';

let library;
const openDocuments = new Map();

export function getPdfLibrary() {
    if (library === undefined) {
        library = NitroModules.createHybridObject('PdfLibrary');
    }
    return library;
}

/** @deprecated Use getPdfLibrary(). The hybrid name is PdfLibrary, not PDFJSI. */
export function getNitroPDFJSI() {
    return getPdfLibrary();
}

export async function openPdf(path) {
    const existing = openDocuments.get(path);
    if (existing) {
        return existing;
    }
    const document = await getPdfLibrary().open(path);
    openDocuments.set(path, document);
    return document;
}

export function closePdf(path) {
    const document = openDocuments.get(path);
    if (!document) {
        return;
    }
    document.close();
    openDocuments.delete(path);
}

function requireOpen(path) {
    const document = openDocuments.get(path);
    if (!document) {
        throw new Error('PDF is not open. Call await openPdf(path) first.');
    }
    return document;
}

async function ensureDocument(pdfIdOrPath) {
    if (openDocuments.has(pdfIdOrPath)) {
        return openDocuments.get(pdfIdOrPath);
    }
    if (typeof pdfIdOrPath === 'string' && (pdfIdOrPath.includes('/') || pdfIdOrPath.startsWith('file:'))) {
        return openPdf(pdfIdOrPath);
    }
    throw new Error(
        'pdfId strings were removed in 5.0. Call openPdf(path) and use the document handle, or pass the file path.'
    );
}

function toZeroBased(pageNumber) {
    const page = Number(pageNumber);
    return page > 0 ? page - 1 : 0;
}

export function checkJSIAvailability() {
    try {
        getPdfLibrary();
        return true;
    } catch (error) {
        return false;
    }
}

export function getJSIStats() {
    return getPdfLibrary().jsiStats;
}

export function check16KBSupport() {
    return getPdfLibrary().kb16Support;
}

export async function renderPageDirect(pdfId, pageNumber, scale) {
    const document = await ensureDocument(pdfId);
    return document.renderPage(toZeroBased(pageNumber), scale);
}

export function getPageMetrics(path, pageNumber) {
    return requireOpen(path).pageMetrics(toZeroBased(pageNumber));
}

export async function preloadPagesDirect(pdfId, startPage, endPage) {
    const document = await ensureDocument(pdfId);
    return document.preloadPages(toZeroBased(startPage), toZeroBased(endPage));
}

export function getCacheMetrics(path) {
    return requireOpen(path).cacheMetrics;
}

export function clearCacheDirect(path) {
    requireOpen(path).clearCache();
    return true;
}

export function optimizeMemory(path) {
    requireOpen(path).optimizeMemory();
    return true;
}

export async function searchTextDirect(pdfId, searchTerm, startPage, endPage) {
    const document = await ensureDocument(pdfId);
    return document.searchText(searchTerm, toZeroBased(startPage), toZeroBased(endPage));
}

export function getPerformanceMetrics(path) {
    return requireOpen(path).performanceMetrics;
}

export function setRenderQuality(path, quality) {
    requireOpen(path).setRenderQuality(quality);
    return true;
}

export function getPerformanceHistory() {
    return [];
}

export function clearPerformanceHistory() {}

export async function lazyLoadPages(pdfId, currentPage, preloadRadius) {
    const start = Math.max(1, currentPage - preloadRadius);
    const end = currentPage + preloadRadius;
    return preloadPagesDirect(pdfId, start, end);
}

export async function progressiveLoadPages(pdfId, startPage, batchSize = 4, onProgress) {
    const document = await ensureDocument(pdfId);
    const total = document.pageCount;
    let loaded = 0;
    const concurrency = 2;
    let next = toZeroBased(startPage);
    const inFlight = new Set();

    const launch = () => {
        if (next >= total) {
            return null;
        }
        const start = next;
        const end = Math.min(total - 1, start + batchSize - 1);
        next = end + 1;
        const task = document.preloadPages(start, end).then((ok) => {
            inFlight.delete(task);
            loaded += end - start + 1;
            if (onProgress) {
                onProgress(total === 0 ? 1 : loaded / total);
            }
            return ok;
        });
        inFlight.add(task);
        return task;
    };

    while (inFlight.size < concurrency && next < total) {
        launch();
    }
    while (inFlight.size > 0) {
        await Promise.race(inFlight);
        while (inFlight.size < concurrency && next < total) {
            launch();
        }
    }
    return { success: true, totalLoaded: loaded };
}

export async function smartCacheFrequentPages(pdfId, frequentPages) {
    const document = await ensureDocument(pdfId);
    await Promise.all(frequentPages.map((page) => document.preloadPages(toZeroBased(page), toZeroBased(page))));
    return true;
}

const pdfJSI = {
    checkJSIAvailability,
    getJSIStats,
    check16KBSupport,
    renderPageDirect,
    getPageMetrics,
    preloadPagesDirect,
    getCacheMetrics,
    clearCacheDirect,
    optimizeMemory,
    searchTextDirect,
    getPerformanceMetrics,
    setRenderQuality,
    getPerformanceHistory,
    clearPerformanceHistory,
    lazyLoadPages,
    progressiveLoadPages,
    smartCacheFrequentPages,
    openPdf,
    closePdf,
    getPdfLibrary,
};

export default pdfJSI;
