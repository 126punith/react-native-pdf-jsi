/**
 * react-native-pdf-jsi 6.0 public API.
 *
 * Pages are zero-based everywhere. Coordinates are PDF points measured from
 * the top-left corner of the displayed page.
 */

export { PdfView, PdfView as default } from './PdfView';
export type { PdfViewProps, PdfViewRef, PdfFitPolicy, NavigationOptions } from './PdfView';

export { usePdfDocument } from './usePdfDocument';
export type { UsePdfDocumentOptions, UsePdfDocumentResult } from './usePdfDocument';

export { PdfCache, PdfFiles, loadNormalizedSource } from './PdfCache';
export type { PdfCacheEntry, PdfDownloadsTarget, PdfLoadProgress, LoadOptions, LoadedSource } from './PdfCache';

export { normalizeSource, sameSource } from './source';
export type {
  PdfSource,
  PdfUriSource,
  PdfFileSource,
  PdfBase64Source,
  PdfAssetSource,
  PdfCacheMode,
  NormalizedSource,
} from './source';

export { PdfError, isPdfError, toPdfError, errorMessageFor, PDF_ERROR_CODES, DEFAULT_ERROR_MESSAGES } from './errors';
export type { PdfErrorCode } from './errors';

export { toPageIndex, requirePageIndex, toScale } from './pages';

export { parseViewerEvent } from './viewerEvents';
export type {
  PdfLoadEvent,
  PdfPageChangeEvent,
  PdfScaleChangeEvent,
  PdfPageTapEvent,
  PdfLinkPressEvent,
  PdfPasswordRequiredEvent,
  PdfHighlight,
  ViewerEvent,
} from './viewerEvents';

export {
  getPdfLibrary,
  getPdfCache,
  acquirePdf,
  releasePdf,
  withPdfDocument,
  invalidatePdf,
  trimPdfCache,
  closeAllPdfs,
  getPdfRegistryStats,
  openPdf,
  closePdf,
  isPdfModuleAvailable,
  check16KBSupport,
} from './PDFJSI';
export type { PdfRegistryStats } from './PDFJSI';

export type {
  PdfDocument,
  PdfLibrary,
  PageSize,
  PageMetrics,
  PdfPoint,
  PdfRect,
  SearchResult,
  ImageFormat,
  RenderOptions,
  ThumbnailOptions,
  RenderedImage,
  AddableAnnotationType,
  AnnotationType,
  InkStroke,
  AnnotationInput,
  PdfAnnotation,
  FormFieldType,
  PdfFormField,
  PdfPermissions,
  SaveOptions,
  OutlineItem,
} from './specs/PdfLibrary.nitro';

export { default as PDFCompressor, CompressionPreset, CompressionLevel } from './PDFCompressor';
export { default as PDFText } from './PDFText';
export { default as PDFTextExtractor } from './utils/PDFTextExtractor';
export { default as ExportManager, ExportFormat, ExportQuality } from './managers/ExportManager';
export { default as BookmarkManager, createMemoryStorage } from './managers/BookmarkManager';
export { default as AnalyticsManager } from './managers/AnalyticsManager';
export { default as CacheManager } from './managers/CacheManager';
export { default as FileManager } from './managers/FileManager';

export { default as Toolbar } from './components/Toolbar';
export { default as BookmarkModal } from './components/BookmarkModal';
export { default as BookmarkListModal } from './components/BookmarkListModal';
export { default as BookmarkIndicator } from './components/BookmarkIndicator';
export { default as ExportMenu } from './components/ExportMenu';
export { default as OperationsMenu } from './components/OperationsMenu';
export { default as AnalyticsPanel } from './components/AnalyticsPanel';
export { default as LoadingOverlay } from './components/LoadingOverlay';
export { default as Toast } from './components/Toast';
export { default as BottomSheet } from './components/BottomSheet';
export { default as SidePanel } from './components/SidePanel';
