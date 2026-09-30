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

/**
 * C++ HybridObject for PDF operations. Nitrogen generates the JSI bindings;
 * HybridPDFJSI implements this interface.
 */
export interface PDFJSI
  extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  renderPageDirect(
    pdfId: string,
    pageNumber: number,
    scale: number,
    base64Data: string
  ): Promise<RenderResult>;
  getPageMetrics(pdfId: string, pageNumber: number): Promise<PageMetrics>;
  preloadPagesDirect(
    pdfId: string,
    startPage: number,
    endPage: number
  ): Promise<boolean>;
  getCacheMetrics(pdfId: string): Promise<CacheMetrics>;
  clearCacheDirect(pdfId: string, cacheType: string): Promise<boolean>;
  optimizeMemory(pdfId: string): Promise<boolean>;
  searchTextDirect(
    pdfId: string,
    searchTerm: string,
    startPage: number,
    endPage: number
  ): Promise<SearchResult[]>;
  getPerformanceMetrics(pdfId: string): Promise<PerformanceMetrics>;
  setRenderQuality(pdfId: string, quality: number): Promise<boolean>;
  check16KBSupport(): Promise<KB16Support>;
  getJSIStats(): Promise<JSIStats>;
  registerPathForSearch(pdfId: string, path: string): Promise<boolean>;
  getPageCount(filePath: string): Promise<number>;
  getPageSize(filePath: string, pageIndex: number): Promise<PageSize>;
  extractTextFromPage(filePath: string, pageIndex: number): Promise<string>;
  extractTextFromPages(filePath: string, pageIndicesJson: string): Promise<string>;
  extractAllText(filePath: string): Promise<string>;
  exportPageToImage(filePath: string, pageIndex: number, scale: number): Promise<string>;
  exportToImages(filePath: string, scale: number): Promise<string>;
  mergePDFs(filePathsJson: string, outputPath: string): Promise<string>;
  splitPDF(filePath: string, pageRangesJson: string, outputDir: string): Promise<string>;
  extractPages(filePath: string, pageNumbersJson: string, outputPath: string): Promise<string>;
  rotatePage(filePath: string, pageNumber: number, degrees: number): Promise<boolean>;
  deletePage(filePath: string, pageNumber: number): Promise<boolean>;
  compressPDF(inputPath: string, outputPath: string, compressionLevel: number): Promise<string>;
}
