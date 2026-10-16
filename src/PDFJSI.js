/**
 * Nitro entry point. Cheap document reads are synchronous on the handle
 * returned by openPdf(). Heavy work stays a single Promise.
 *
 * Native documents are owned by a reference-counted registry. Hermes cannot
 * see the native memory behind a PdfDocument, so documents are closed
 * explicitly: when the last reference is released (after a small warm pool),
 * when the file is replaced (invalidatePdf), or on a memory warning.
 */

import { AppState } from 'react-native';
import { NitroModules } from 'react-native-nitro-modules';

const WARM_POOL_SIZE = 2;

let library;
/** path -> entry for the current (non-stale) document of that path */
const entries = new Map();
/** entries whose file was replaced but are still referenced or pinned */
const staleEntries = new Set();
/** released, unpinned entries kept open for fast reopen; oldest first */
const warmPool = [];

function safeClose(document) {
    try {
        document.close();
    } catch (error) {
        if (__DEV__) {
            console.warn('PDFJSI: close() failed', error);
        }
    }
}

function removeFromWarm(entry) {
    const index = warmPool.indexOf(entry);
    if (index !== -1) {
        warmPool.splice(index, 1);
    }
}

function closeEntry(entry) {
    if (entry.closed) {
        return;
    }
    entry.closed = true;
    removeFromWarm(entry);
    staleEntries.delete(entry);
    if (entries.get(entry.path) === entry) {
        entries.delete(entry.path);
    }
    if (entry.document) {
        safeClose(entry.document);
        entry.document = null;
    }
}

function createEntry(path) {
    const entry = {
        path,
        promise: null,
        document: null,
        refs: 0,
        pinned: false,
        stale: false,
        closed: false,
    };
    entry.promise = getPdfLibrary()
        .open(path)
        .then(
            (document) => {
                if (entry.closed) {
                    safeClose(document);
                    throw new Error('PDF was closed while it was opening.');
                }
                entry.document = document;
                if (entry.refs === 0 && !entry.pinned) {
                    settleUnreferenced(entry);
                }
                return document;
            },
            (error) => {
                entry.closed = true;
                if (entries.get(path) === entry) {
                    entries.delete(path);
                }
                staleEntries.delete(entry);
                throw error;
            }
        );
    entries.set(path, entry);
    return entry;
}

function settleUnreferenced(entry) {
    if (entry.closed || entry.refs > 0 || entry.pinned) {
        return;
    }
    if (entry.stale) {
        closeEntry(entry);
        return;
    }
    if (!entry.document) {
        return;
    }
    removeFromWarm(entry);
    warmPool.push(entry);
    while (warmPool.length > WARM_POOL_SIZE) {
        closeEntry(warmPool.shift());
    }
}

function entryFor(path) {
    return entries.get(path) || createEntry(path);
}

async function acquireEntry(path) {
    const entry = entryFor(path);
    entry.refs += 1;
    removeFromWarm(entry);
    try {
        await entry.promise;
    } catch (error) {
        entry.refs -= 1;
        throw error;
    }
    if (entry.closed) {
        entry.refs -= 1;
        throw new Error('PDF was closed while it was opening.');
    }
    return entry;
}

function releaseEntry(entry) {
    if (entry.refs <= 0) {
        return;
    }
    entry.refs -= 1;
    settleUnreferenced(entry);
}

function findReferencedEntry(pathOrDocument) {
    if (typeof pathOrDocument === 'string') {
        const live = entries.get(pathOrDocument);
        if (live && live.refs > 0) {
            return live;
        }
        for (const entry of staleEntries) {
            if (entry.path === pathOrDocument && entry.refs > 0) {
                return entry;
            }
        }
        return null;
    }
    for (const entry of entries.values()) {
        if (entry.document === pathOrDocument && entry.refs > 0) {
            return entry;
        }
    }
    for (const entry of staleEntries) {
        if (entry.document === pathOrDocument && entry.refs > 0) {
            return entry;
        }
    }
    return null;
}

/**
 * Takes a reference on the document at `path`, opening it if needed.
 * Every acquirePdf must be paired with releasePdf.
 */
export async function acquirePdf(path) {
    const entry = await acquireEntry(path);
    return entry.document;
}

/** Releases a reference taken with acquirePdf (by path or document handle). */
export function releasePdf(pathOrDocument) {
    const entry = findReferencedEntry(pathOrDocument);
    if (entry) {
        releaseEntry(entry);
    }
}

/** Runs `fn(document)` while holding a reference; always releases it. */
export async function withPdfDocument(path, fn) {
    const entry = await acquireEntry(path);
    try {
        return await fn(entry.document);
    } finally {
        releaseEntry(entry);
    }
}

/**
 * Call when the file at `path` is about to be replaced or deleted. The next
 * acquire opens a fresh document; the old one closes once nothing uses it.
 */
export function invalidatePdf(path) {
    const entry = entries.get(path);
    if (!entry) {
        return;
    }
    entries.delete(path);
    entry.stale = true;
    removeFromWarm(entry);
    if (entry.refs > 0 || entry.pinned) {
        staleEntries.add(entry);
    } else {
        closeEntry(entry);
    }
}

/** Closes every released document kept warm for fast reopen. */
export function trimPdfCache() {
    while (warmPool.length > 0) {
        closeEntry(warmPool.shift());
    }
}

/** Force-closes every document, including referenced and pinned ones. */
export function closeAllPdfs() {
    for (const entry of [...entries.values(), ...staleEntries]) {
        closeEntry(entry);
    }
    warmPool.length = 0;
}

export function getPdfRegistryStats() {
    let referenced = 0;
    let pinned = 0;
    for (const entry of entries.values()) {
        if (entry.refs > 0) referenced += 1;
        if (entry.pinned) pinned += 1;
    }
    return {
        open: entries.size,
        referenced,
        pinned,
        warm: warmPool.length,
        stale: staleEntries.size,
    };
}

try {
    AppState.addEventListener('memoryWarning', trimPdfCache);
} catch (error) {
    // AppState is unavailable outside a React Native runtime.
}

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

/**
 * Opens and pins the document at `path`. A pinned document stays open until
 * closePdf(path). Prefer withPdfDocument or acquirePdf/releasePdf.
 */
export async function openPdf(path) {
    const entry = entryFor(path);
    entry.pinned = true;
    removeFromWarm(entry);
    return entry.promise;
}

/** Force-closes the document at `path`, even if it is still referenced. */
export function closePdf(path) {
    const live = entries.get(path);
    if (live) {
        closeEntry(live);
    }
    for (const entry of [...staleEntries]) {
        if (entry.path === path) {
            closeEntry(entry);
        }
    }
}

function requireOpen(path) {
    const entry = entries.get(path);
    if (!entry || !entry.document) {
        throw new Error('PDF is not open. Call await openPdf(path) first.');
    }
    if (warmPool.includes(entry)) {
        removeFromWarm(entry);
        warmPool.push(entry);
    }
    return entry.document;
}

function resolveDocumentPath(pdfIdOrPath) {
    if (entries.has(pdfIdOrPath)) {
        return pdfIdOrPath;
    }
    if (typeof pdfIdOrPath === 'string' && (pdfIdOrPath.includes('/') || pdfIdOrPath.startsWith('file:'))) {
        return pdfIdOrPath;
    }
    throw new Error(
        'pdfId strings were removed in 5.0. Call openPdf(path) and use the document handle, or pass the file path.'
    );
}

function withResolvedDocument(pdfIdOrPath, fn) {
    return withPdfDocument(resolveDocumentPath(pdfIdOrPath), fn);
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
    return withResolvedDocument(pdfId, (document) => document.renderPage(toZeroBased(pageNumber), scale));
}

export function getPageMetrics(path, pageNumber) {
    return requireOpen(path).pageMetrics(toZeroBased(pageNumber));
}

export async function preloadPagesDirect(pdfId, startPage, endPage) {
    return withResolvedDocument(pdfId, (document) =>
        document.preloadPages(toZeroBased(startPage), toZeroBased(endPage))
    );
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
    return withResolvedDocument(pdfId, (document) =>
        document.searchText(searchTerm, toZeroBased(startPage), toZeroBased(endPage))
    );
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
    return withResolvedDocument(pdfId, (document) =>
        progressiveLoad(document, startPage, batchSize, onProgress)
    );
}

async function progressiveLoad(document, startPage, batchSize, onProgress) {
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
    await withResolvedDocument(pdfId, (document) =>
        Promise.all(frequentPages.map((page) => document.preloadPages(toZeroBased(page), toZeroBased(page))))
    );
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
    acquirePdf,
    releasePdf,
    withPdfDocument,
    invalidatePdf,
    trimPdfCache,
    closeAllPdfs,
    getPdfRegistryStats,
    getPdfLibrary,
};

export default pdfJSI;
