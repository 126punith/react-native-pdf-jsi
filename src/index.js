/**
 * Copyright (c) 2025-present, Punith M (punithm300@gmail.com)
 * Enhanced PDF JSI Integration - Main Export
 * All rights reserved.
 * 
 * Main export file for enhanced PDF JSI components and utilities
 */

// Core JSI functionality
export { default as PDFJSI } from './PDFJSI';

// PDF Compression
export { 
    default as PDFCompressor, 
    PDFCompressor as PDFCompressorClass,
    CompressionPreset, 
    CompressionLevel 
} from './PDFCompressor';

export { default as PDFText } from './PDFText';
export { default as PDFTextExtractor } from './utils/PDFTextExtractor';

// Enhanced PDF View component
export { default as EnhancedPdfView, EnhancedPdfUtils } from './EnhancedPdfView';

// React hooks
export { default as usePDFJSI } from './hooks/usePDFJSI';

// Re-export individual JSI methods for convenience
export {
    renderPageDirect,
    getPageMetrics,
    preloadPagesDirect,
    getCacheMetrics,
    clearCacheDirect,
    optimizeMemory,
    searchTextDirect,
    getPerformanceMetrics,
    setRenderQuality,
    getJSIStats,
    getPerformanceHistory,
    clearPerformanceHistory
} from './PDFJSI';

// Re-export compression utilities
export {
    CompressionPreset,
    CompressionLevel
} from './PDFCompressor';