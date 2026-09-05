/**
 * Copyright (c) 2017-present, Wonday (@wonday.org)
 * All rights reserved.
 *
 * This source code is licensed under the MIT-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import * as ReactNative from 'react-native';

export type TableContent = {
    children: TableContent[],
    mNativePtr: number,
    pageIdx: number,
    title: string,
};

export type Source = {
    uri?: string;
    headers?: {
        [key: string]: string;
    };
    cache?: boolean;
    cacheFileName?: string;
    expiration?: number;
    method?: string;
};

export interface PdfProps {
    style?: ReactNative.StyleProp<ReactNative.ViewStyle>,
    progressContainerStyle?: ReactNative.StyleProp<ReactNative.ViewStyle>,
    source: Source | number,
    page?: number,
    scale?: number,
    minScale?: number,
    maxScale?: number,
    horizontal?: boolean,
    showsHorizontalScrollIndicator?: boolean,
    showsVerticalScrollIndicator?: boolean,
    scrollEnabled?: boolean,
    /**
     * Space between pages in pixels
     */
    spacing?: number,
    /**
     * Password for encrypted PDFs
     */
    password?: string,
    /**
     * Custom loading indicator component
     * @param progress - Progress value from 0 to 1
     */
    renderActivityIndicator?: (progress: number) => React.ReactElement,
    /**
     * Enable antialiasing for smoother rendering
     */
    enableAntialiasing?: boolean,
    /**
     * Enable page-by-page navigation mode
     */
    enablePaging?: boolean,
    /**
     * Enable right-to-left layout support
     */
    enableRTL?: boolean,
    /**
     * Enable rendering of PDF annotations
     */
    enableAnnotationRendering?: boolean,
    /**
     * Enable double-tap to zoom functionality
     */
    enableDoubleTapZoom?: boolean;
    /**
     * Fit policy.  This will adjust the initial zoom of the PDF based on the initial size of the view and the scale factor.
     * 0 = fit width
     * 1 = fit height
     * 2 = fit both
     */
    fitPolicy?: 0 | 1 | 2,
    trustAllCerts?: boolean,
    singlePage?: boolean,
    onLoadProgress?: (percent: number,) => void,
    onLoadComplete?: (numberOfPages: number, path: string, size: {height: number, width: number}, tableContents?: TableContent[]) => void,
    onPageChanged?: (page: number, numberOfPages: number) => void,
    onError?: (error: object) => void,
    onPageSingleTap?: (page: number, x: number, y: number) => void,
    onScaleChanged?: (scale: number) => void,
    onPressLink?: (url: string) => void,
    /**
     * Optional. When set, use this id with searchTextDirect(pdfId, ...) for programmatic text search.
     * On iOS, the same id must be passed to the Pdf view and to searchTextDirect. One view per pdfId.
     */
    pdfId?: string,
    /**
     * Optional. Array of rects to highlight on the PDF (e.g. from searchTextDirect results).
     * Each item: { page: number, rect: string } where rect is "left,top,right,bottom" in PDF page coordinates.
     * Supported on Android; iOS can be added later.
     */
    highlightRects?: Array<{ page: number; rect: string }>,
}

declare class Pdf extends React.Component<PdfProps, any> {
    setPage: (pageNumber: number) => void;
}

export default Pdf;

// ========================================
// PDFCache (Streaming Base64 Decoder)
// ========================================

/**
 * Cache info returned from storage operations
 */
export interface CacheInfo {
    cacheId: string;
    filePath: string;
    fileSize: number;
    createdAt: number;
    lastAccessed?: number;
    expired?: boolean;
}

/**
 * Options for storing base64 PDF with streaming decoder
 */
export interface StoreBase64Options {
    /**
     * Base64 PDF data (with or without data URI prefix)
     */
    base64: string;
    /**
     * Custom cache identifier (optional, auto-generated if not provided)
     */
    identifier?: string;
    /**
     * Cache TTL in milliseconds
     * @default 2592000000 (30 days)
     */
    maxAge?: number;
    /**
     * Maximum cache size in bytes
     * @default 524288000 (500MB)
     */
    maxSize?: number;
    /**
     * Progress callback (0.0 to 1.0)
     */
    onProgress?: (progress: number) => void;
}

/**
 * Cache statistics
 */
export interface CacheStats {
    totalSize: number;
    fileCount: number;
    hitRate: number;
    cacheHits: number;
    cacheMisses: number;
    averageLoadTime: number;
}

/**
 * PDFCache Manager for streaming base64 decoding
 * Eliminates OOM crashes with large PDFs (60MB-200MB+)
 */
export interface PDFCacheManager {
    /**
     * Store base64 PDF with streaming decoder (O(1) constant memory)
     * @param options Storage options
     * @returns Promise resolving to cache info
     */
    storeBase64(options: StoreBase64Options): Promise<CacheInfo>;
    
    /**
     * Get cached PDF by identifier
     * @param identifier Cache identifier
     * @returns Promise resolving to cache info or null if not found
     */
    get(identifier: string): Promise<CacheInfo | null>;
    
    /**
     * Check if PDF is cached and not expired
     * @param identifier Cache identifier
     * @returns Promise resolving to true if cached and valid
     */
    has(identifier: string): Promise<boolean>;
    
    /**
     * Remove cached PDF
     * @param identifier Cache identifier
     * @returns Promise resolving to true if removed successfully
     */
    remove(identifier: string): Promise<boolean>;
    
    /**
     * Clear all cached PDFs
     */
    clear(): Promise<void>;
    
    /**
     * Clear expired PDFs only
     * @returns Promise resolving to number of entries removed
     */
    clearExpired(): Promise<number>;
    
    /**
     * Get cache statistics
     * @returns Promise resolving to cache stats
     */
    getStats(): Promise<CacheStats>;
    
    /**
     * Estimate decoded size from base64 length
     * @param base64Length Length of base64 string
     * @returns Estimated decoded size in bytes
     */
    estimateDecodedSize(base64Length: number): number;
}

/**
 * PDFCache singleton instance
 */
export const PDFCache: PDFCacheManager;

/**
 * CacheManager (alias for PDFCache)
 */
export const CacheManager: PDFCacheManager;

// ========================================
// PDFCompressor (PDF Compression)
// ========================================

/**
 * Compression presets for different use cases
 */
export enum CompressionPreset {
    /** Optimized for email attachments (high compression, smaller file) */
    EMAIL = 'email',
    /** Optimized for web viewing (balanced compression) */
    WEB = 'web',
    /** Optimized for mobile devices (good compression, fast decompression) */
    MOBILE = 'mobile',
    /** Optimized for printing (low compression, high quality) */
    PRINT = 'print',
    /** Optimized for long-term archival (maximum compression) */
    ARCHIVE = 'archive',
    /** Custom compression settings */
    CUSTOM = 'custom'
}

/**
 * Compression levels (0-9, higher = more compression but slower)
 */
export enum CompressionLevel {
    NONE = 0,
    FASTEST = 1,
    FAST = 3,
    BALANCED = 5,
    DEFAULT = 6,
    GOOD = 7,
    BETTER = 8,
    BEST = 9
}

/**
 * Compression options
 */
export interface CompressionOptions {
    /** Compression preset (from CompressionPreset) */
    preset?: CompressionPreset;
    /** Compression level (0-9), overrides preset */
    level?: number;
    /** Output file path (optional, auto-generated if not provided) */
    outputPath?: string;
    /** Progress callback function */
    onProgress?: (progress: { progress: number; bytesProcessed: number; totalBytes: number }) => void;
}

/**
 * Compression result
 */
export interface CompressionResult {
    /** Whether compression was successful */
    success: boolean;
    /** Input file path */
    inputPath: string;
    /** Output file path */
    outputPath: string;
    /** Original file size in bytes */
    originalSize: number;
    /** Compressed file size in bytes */
    compressedSize: number;
    /** Original file size in MB */
    originalSizeMB: number;
    /** Compressed file size in MB */
    compressedSizeMB: number;
    /** Compression ratio (0-1, lower is better) */
    compressionRatio: number;
    /** Space saved percentage */
    spaceSavedPercent: number;
    /** Duration in milliseconds */
    durationMs: number;
    /** Throughput in MB/s */
    throughputMBps: number;
    /** Preset used */
    preset: CompressionPreset;
    /** Compression level used */
    compressionLevel: number;
    /** Method used (native_streaming or fallback) */
    method: string;
}

/**
 * Compression estimate result
 */
export interface CompressionEstimate {
    /** Input file path */
    inputPath: string;
    /** Original file size in bytes */
    originalSize: number;
    /** Original file size in MB */
    originalSizeMB: number;
    /** Estimated compressed size in bytes */
    estimatedCompressedSize: number;
    /** Estimated compressed size in MB */
    estimatedCompressedSizeMB: number;
    /** Estimated compression ratio */
    estimatedCompressionRatio: number;
    /** Estimated space savings percentage */
    estimatedSavingsPercent: number;
    /** Estimated duration in milliseconds */
    estimatedDurationMs: number;
    /** Preset used for estimate */
    preset: CompressionPreset;
    /** Description of the preset */
    presetDescription: string;
    /** Confidence level of the estimate */
    confidence: 'low' | 'medium' | 'high';
    /** Additional notes */
    note: string;
}

/**
 * PDFCompressor capabilities
 */
export interface CompressionCapabilities {
    /** Whether streaming / page-at-a-time compression is available */
    streamingCompression: boolean;
    /** Whether PDF-aware page recompression (downsample + JPEG) is available */
    pdfAwareRecompression?: boolean;
    /** Available presets */
    presets: CompressionPreset[];
    /** Maximum file size in MB */
    maxFileSizeMB: number;
    /** Supported platforms */
    supportedPlatforms: string[];
    /** Current platform */
    currentPlatform: string;
    /** Whether native module is available */
    nativeModuleAvailable: boolean;
    /** Optional capability note */
    note?: string;
}

/**
 * PDFCompressor Manager for PDF compression
 * Uses native PDF-aware page recompression (downsample + JPEG rebuild)
 */
export interface PDFCompressorManager {
    /**
     * Check if compression functionality is available
     * @returns True if compression is available
     */
    isAvailable(): boolean;
    
    /**
     * Get compression capabilities
     * @returns Capabilities object
     */
    getCapabilities(): CompressionCapabilities;
    
    /**
     * Compress a PDF file
     * @param inputPath Path to input PDF file
     * @param options Compression options
     * @returns Promise resolving to compression result
     */
    compress(inputPath: string, options?: CompressionOptions): Promise<CompressionResult>;
    
    /**
     * Compress PDF with a specific preset
     * @param inputPath Path to input PDF file
     * @param preset Compression preset
     * @param outputPath Output file path (optional)
     * @returns Promise resolving to compression result
     */
    compressWithPreset(inputPath: string, preset: CompressionPreset, outputPath?: string): Promise<CompressionResult>;
    
    /**
     * Compress PDF for email (maximum compression)
     * @param inputPath Path to input PDF file
     * @param outputPath Output file path (optional)
     * @returns Promise resolving to compression result
     */
    compressForEmail(inputPath: string, outputPath?: string): Promise<CompressionResult>;
    
    /**
     * Compress PDF for web viewing
     * @param inputPath Path to input PDF file
     * @param outputPath Output file path (optional)
     * @returns Promise resolving to compression result
     */
    compressForWeb(inputPath: string, outputPath?: string): Promise<CompressionResult>;
    
    /**
     * Compress PDF for mobile viewing
     * @param inputPath Path to input PDF file
     * @param outputPath Output file path (optional)
     * @returns Promise resolving to compression result
     */
    compressForMobile(inputPath: string, outputPath?: string): Promise<CompressionResult>;
    
    /**
     * Compress PDF for archival (maximum compression)
     * @param inputPath Path to input PDF file
     * @param outputPath Output file path (optional)
     * @returns Promise resolving to compression result
     */
    compressForArchive(inputPath: string, outputPath?: string): Promise<CompressionResult>;
    
    /**
     * Estimate compression result without actually compressing
     * @param inputPath Path to input PDF file
     * @param preset Compression preset
     * @returns Promise resolving to estimated compression result
     */
    estimateCompression(inputPath: string, preset?: CompressionPreset): Promise<CompressionEstimate>;
    
    /**
     * Delete a compressed file
     * @param filePath Path to file to delete
     * @returns Promise resolving to true if deleted successfully
     */
    deleteCompressedFile(filePath: string): Promise<boolean>;
    
    /**
     * Get preset configuration
     * @param preset Preset name
     * @returns Preset configuration
     */
    getPresetConfig(preset: CompressionPreset): {
        level: CompressionLevel;
        targetSizeKB: number | null;
        description: string;
    };
    
    /**
     * Get module information
     * @returns Module info object
     */
    getModuleInfo(): {
        name: string;
        version: string;
        platform: string;
        nativeAvailable: boolean;
        presets: string[];
        compressionLevels: string[];
        capabilities: CompressionCapabilities;
    };
}

/**
 * PDFCompressor singleton instance
 */
export const PDFCompressor: PDFCompressorManager;

// ========================================
// JSI / Programmatic search
// ========================================

export interface PDFSearchResultItem {
    page: number;
    text: string;
    /** Bounds of the match (format is platform-specific; on iOS a CGRect string). */
    rect: string;
}

/**
 * Search PDF text programmatically.
 * On iOS: pass the same pdfId to the Pdf view (pdfId prop) so the view is registered for search.
 * On Android: uses Pdfium text layer via SearchRegistry (pass pdfId to the Pdf view).
 */
export function searchTextDirect(
    pdfId: string,
    searchTerm: string,
    startPage: number,
    endPage: number
): Promise<PDFSearchResultItem[]>;

// ========================================
// PDFText (extraction + optional OCR)
// ========================================

export type PDFTextMode = 'text' | 'ocr' | 'auto';

export interface OCRBlock {
    text: string;
    rect?: string;
}

export interface OCRResult {
    text: string;
    blocks?: OCRBlock[];
    engine?: string;
    imageWidth?: number;
    imageHeight?: number;
}

export interface OCREngine {
    recognize(imagePath: string, options?: object): Promise<OCRResult | string>;
}

export interface OCROptions {
    /** iOS Vision: use fast recognition level */
    fast?: boolean;
    /** iOS 16+ Vision recognition language identifiers, e.g. ['en-US'] */
    languages?: string[];
    /** Hint that Latin ML Kit recognizer is in use on Android */
    latinOnly?: boolean;
    [key: string]: unknown;
}

export interface PDFTextExtractOptions {
    /** 1-based page numbers; omit for all pages */
    pages?: number[] | null;
    /** text = embedded only; ocr = always OCR; auto = OCR when page text is sparse */
    mode?: PDFTextMode;
    /** auto mode: OCR if trimmed embedded text length is below this (default 20) */
    minTextLength?: number;
    /** DPI used when rasterizing pages for OCR (default 200) */
    ocrDpi?: number;
    ocrFormat?: 'jpeg' | 'png';
    ocrOptions?: OCROptions;
    includeBlocks?: boolean;
    onProgress?: (progress: { page: number; total: number; mode: string }) => void;
}

export interface PDFTextStats {
    totalPages: number;
    pagesNative: number;
    pagesOcr: number;
    pagesEmpty: number;
    mode: string;
}

export interface PDFTextPageMeta {
    mode: string;
    blocks: OCRBlock[];
    imageSize?: { width: number; height: number };
    pageSize?: { width: number; height: number };
}

export interface PDFTextCapabilities {
    textExtraction: boolean;
    ocr: boolean;
    customEngineSupported: boolean;
    customEngineRegistered?: boolean;
    recognizePage?: boolean;
    searchablePdf?: boolean;
    platform: string;
    ocrBuildEnabled?: boolean;
}

export interface PDFTextExtractResult {
    pages: Map<number, string>;
    fullText: string;
    stats: PDFTextStats;
    pageMeta?: Map<number, PDFTextPageMeta>;
}

export interface PDFTextSearchableResult {
    outputPath: string;
    stats: PDFTextStats;
}

export interface PDFTextMakeSearchableOptions extends PDFTextExtractOptions {
    outputPath?: string;
}

export interface PDFHighlightRect {
    page: number;
    rect: string;
}

export interface PDFTextManager {
    setOCREngine(engine: OCREngine | null): void;
    clearOCREngine(): void;
    getOCREngine(): OCREngine | null;
    isAvailable(): boolean;
    isOCRAvailable(): Promise<boolean>;
    getCapabilities(): Promise<PDFTextCapabilities>;
    getPageSize(filePath: string, pageIndex0: number): Promise<{ width: number; height: number }>;
    extract(filePath: string, options?: PDFTextExtractOptions): Promise<PDFTextExtractResult>;
    makeSearchablePDF(inputPath: string, options?: PDFTextMakeSearchableOptions): Promise<PDFTextSearchableResult>;
    toHighlightRects(filePath: string, pageMeta: Map<number, PDFTextPageMeta> | object): Promise<PDFHighlightRect[]>;
    blocksToHighlightRects(pageMeta: Map<number, PDFTextPageMeta> | object): PDFHighlightRect[];
    extractTextFromPage(filePath: string, pageNumber: number): Promise<string>;
    extractTextFromPages(filePath: string, pageIndices: number[]): Promise<Map<number, string>>;
    extractAllText(filePath: string): Promise<Map<number, string>>;
    getPageCount(filePath: string): Promise<number>;
    recognizeImage(imagePath: string, options?: OCROptions): Promise<OCRResult>;
    recognizePage(filePath: string, pageIndex0: number, options?: OCROptions & { dpi?: number; ocrDpi?: number; format?: string }): Promise<OCRResult>;
}

/**
 * Native PDF text extraction (Pdfium / PDFKit) with optional on-device OCR
 * (iOS Vision; Android ML Kit when pdfJsiEnableOcr / Expo `{ ocr: true }`),
 * searchable PDF export, viewer highlight mapping, and custom OCR engines.
 */
export const PDFText: PDFTextManager;

export interface PDFTextExtractorStatic {
    isTextExtractionAvailable(): boolean;
    extractTextFromPage(filePath: string, pageNumber: number): Promise<string>;
    extractTextFromPages(filePath: string, pageIndices: number[]): Promise<Map<number, string>>;
    extractAllText(filePath: string): Promise<Map<number, string>>;
    getPageCount(filePath: string): Promise<number>;
}

export const PDFTextExtractor: PDFTextExtractorStatic;