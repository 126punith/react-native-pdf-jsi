import type { HybridObject } from 'react-native-nitro-modules';

export interface RenderResult {
  success: boolean;
  pageNumber: number;
  width: number;
  height: number;
  scale: number;
  cached: boolean;
  renderTimeMs: number;
}

export interface PageMetrics {
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
  scale: number;
  renderTimeMs: number;
  cacheSizeKb: number;
}

export interface CacheMetrics {
  pageCacheSize: number;
  totalCacheSizeKb: number;
  hitRatio: number;
}

export interface SearchResult {
  page: number;
  text: string;
  rect: string;
}

export interface PerformanceMetrics {
  lastRenderTime: number;
  avgRenderTime: number;
  cacheHitRatio: number;
  memoryUsageMB: number;
}

export interface KB16Support {
  supported: boolean;
  platform: string;
  message: string;
  googlePlayCompliant: boolean;
  ndkVersion: string;
  buildFlags: string;
}

export interface JSIStats {
  version: string;
  performanceLevel: string;
  directMemoryAccess: boolean;
  bridgeOptimized: boolean;
  initialized: boolean;
}

export interface PageSize {
  width: number;
  height: number;
}

export interface PdfCacheInfo {
  cacheId: string;
  filePath: string;
  fileSize: number;
}

export interface PdfCacheStats {
  fileCount: number;
  totalBytes: number;
  hitRatio: number;
}

/**
 * An open PDF. Cheap reads are synchronous. Rendering, search, text
 * extraction, OCR, and file export stay async because they do real work.
 * Android implements this in C++; iOS implements it in Swift (PDFKit).
 */
export interface PdfDocument
  extends HybridObject<{ ios: 'swift'; android: 'c++' }> {
  readonly pageCount: number;
  readonly path: string;
  pageSize(index: number): PageSize;
  pageMetrics(index: number): PageMetrics;
  readonly cacheMetrics: CacheMetrics;
  readonly performanceMetrics: PerformanceMetrics;
  setRenderQuality(quality: number): void;
  clearCache(): void;
  optimizeMemory(): void;
  renderPage(index: number, scale: number): Promise<RenderResult>;
  preloadPages(startPage: number, endPage: number): Promise<boolean>;
  searchText(
    term: string,
    startPage: number,
    endPage: number
  ): Promise<SearchResult[]>;
  extractText(index: number): Promise<string>;
  extractTextFromPages(pageIndicesJson: string): Promise<string>;
  extractAllText(): Promise<string>;
  recognizeText(index: number, fast: boolean): Promise<string>;
  exportPageToImage(index: number, scale: number): Promise<string>;
  exportToImages(scale: number): Promise<string>;
  rotatePage(pageNumber: number, degrees: number): Promise<boolean>;
  deletePage(pageNumber: number): Promise<boolean>;
  close(): void;
}

/**
 * Process-wide PDF entry point. `open` is the only way to get a document
 * handle — there is no pdfId registry on this API.
 */
export interface PdfLibrary
  extends HybridObject<{ ios: 'swift'; android: 'c++' }> {
  open(path: string): Promise<PdfDocument>;
  readonly jsiStats: JSIStats;
  readonly kb16Support: KB16Support;
  readonly ocrAvailable: boolean;
  mergePDFs(filePaths: string[], outputPath: string): Promise<string>;
  splitPDF(
    filePath: string,
    pageRangesJson: string,
    outputDir: string
  ): Promise<string>;
  extractPages(
    filePath: string,
    pageNumbersJson: string,
    outputPath: string
  ): Promise<string>;
  compressPDF(
    inputPath: string,
    outputPath: string,
    compressionLevel: number
  ): Promise<string>;
  storeCachedPdf(base64: string, identifier: string): Promise<PdfCacheInfo>;
  cachedPdfPath(identifier: string): Promise<string>;
  removeCachedPdf(identifier: string): Promise<boolean>;
  clearPdfCache(): Promise<boolean>;
  clearExpiredPdfs(): Promise<number>;
  pdfCacheStats(): Promise<PdfCacheStats>;
}
