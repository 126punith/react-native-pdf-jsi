# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.4.1] - 2026-03-19

### Fixed
- **Android crash: `IllegalStateException: Already closed`** – Prevents crashes caused by a race condition between the background rendering thread (`RenderingHandler`) and the main thread calling `recycle()` during unmount.
  - Configures PdfiumAndroid to **ignore double-close attempts** by setting `AlreadyClosedBehavior.IGNORE` via `ConfigKt.setPdfiumConfig(new Config(new DefaultLogger(), AlreadyClosedBehavior.IGNORE))` in `PdfView`'s constructor.
  - Aligns behavior with the upstream fix in [`wonday/react-native-pdf` commit `3234127`](https://github.com/wonday/react-native-pdf/commit/32341278905678c09358ecc1e7c54cc8876b2af1), where closing an already-closed PDF resource is treated as a no-op instead of throwing.

## [4.4.0] - 2025-03-08

### Added
- **Programmatic search and highlight (Android & iOS)** – Fixes [#24](https://github.com/126punith/react-native-pdf-jsi/issues/24)
  - **`searchTextDirect(pdfId, searchTerm, startPage, endPage)`** – Exported to JS; runs native PDF text search and returns `{ page, text, rect }[]` with bounding boxes in PDF coordinates.
  - **`pdfId` prop** – Optional stable ID for the current PDF (e.g. `"main-pdf"`). Required for `searchTextDirect` so the native side can resolve the document path.
  - **`highlightRects` prop** – Array of `{ page, rect }` (rect: `"left,top,right,bottom"` in PDF points). When set, the viewer draws semi-transparent yellow highlights over those regions. Supports zoom and scroll on both platforms.
  - **Path registration** – Path for search is registered when the PDF loads (from `onLoadComplete` and native `onDocumentChanged`). JS can also call `PDFJSIManager.registerPathForSearch(pdfId, path)` for explicit registration. Only local file paths are registered; URI paths are ignored to avoid search on non-downloaded sources.
- **Android**: `SearchRegistry` for `pdfId`→path and page dimensions; PDFium-based search with rect fallback; highlight drawing in `PdfView` with correct PDF-to-view scaling and Y-axis conversion.
- **iOS**: `SearchRegistry`, PDFKit `findString` search, `HighlightOverlayView` for drawing highlights; overlay redraw on zoom and scroll so highlights stay aligned with text.

### Fixed
- **iOS search returning 0 results**: Search now uses the local file path (from load/cache) instead of the original URI. Path is registered when the document loads and via JS after `onLoadComplete`. URI guard in native search prevents using `http(s):` paths.
- **iOS highlights misaligned after zoom/scroll**: Highlight overlay is redrawn in `scrollViewDidZoom`, `scrollViewDidEndZooming`, and `scrollViewDidScroll` so `convertRect:fromPage:` is re-evaluated and highlights stay aligned with the zoomed/scrolled content.
- **iOS PDFJSIManager build**: Replaced `(void *)doc` with `(__bridge void *)doc` for ARC; removed unused variables to clear compiler warnings.
- **.gitignore**: Added `.npmrc` to avoid committing auth tokens.

### Technical details
- **Android**: `SearchRegistry.java`, `PDFJSIManager.searchInPdf` with page-size registration and rect fallback, `PdfView`/`PdfManager` for `pdfId`/`highlightRects`, `registerPathForSearch` promise API.
- **iOS**: `SearchRegistry.h/m`, `PDFJSIManager.m` PDFKit search and `registerPathForSearch`, `RNPDFPdfView.mm` `HighlightOverlayView`, path registration in `setPdfId`/`updateProps`/`onDocumentChanged`, overlay redraw in scroll/zoom delegates.
- **JS**: `index.js` exports `searchTextDirect`, passes `pdfId`/`highlightRects`, calls `registerPathForSearch` in `onLoadComplete` handler; `src/PDFJSI.js` and Fabric spec updated for new props.

## [4.3.0] - 2025-02-02

### Added
- **Expo Support**: Added Expo config plugin for seamless integration with Expo development builds
  - New `app.plugin.js` entry point for Expo auto-discovery
  - `plugin/` directory with TypeScript source and compiled JavaScript
  - Automatic Jitpack repository configuration for Android
  - PDFKit framework linking for iOS
  - Works with `npx expo prebuild` and `npx expo run:ios/android`

### Technical Details
- **app.plugin.js**: Expo plugin entry point that exports the compiled plugin
- **plugin/src/index.ts**: Main plugin combining Android and iOS configurations
- **plugin/src/withPdfJsiAndroid.ts**: Adds Jitpack maven repository for AndroidPdfViewer dependency
- **plugin/src/withPdfJsiIos.ts**: Ensures PDFKit framework is properly linked
- **package.json**: Added `app.plugin` field, `expo` keywords, build scripts, and devDependencies

### Notes
- Expo Go is NOT supported (requires native code)
- Must use Expo development builds (`npx expo run:ios` or `npx expo run:android`)
- Compatible with Expo SDK 50+ and EAS Build

## [4.2.2] - 2025-01-31

### Fixed
- **PDFCompressor Module**: Fixed "Unable to resolve module react-native-pdf-jsi/src/PDFCompressor" error ([#17](https://github.com/126punith/react-native-pdf-jsi/issues/17))
  - Added missing `PDFCompressor.js` module to the library
  - Exported `PDFCompressor`, `CompressionPreset`, and `CompressionLevel` from both `src/index.js` and root `index.js`
  - Added TypeScript definitions for PDFCompressor in `index.d.ts`
- **iOS Compilation Error**: Fixed "Call to undeclared function 'RCTLogInfo'" error in `PDFExporter.m`
  - Added missing `#import <React/RCTLog.h>` import
- **Native Compression Bridge**: Added `compressPDF` method to `PDFExporter` native module on both Android and iOS
  - Bridges to existing `StreamingPDFProcessor` for actual compression
  - Returns detailed compression results (original size, compressed size, ratio, duration)
- **Compression Estimates**: Updated `estimateCompression()` to use realistic ratios (~15-18% savings)
  - Previous estimates claimed 50-75% savings which was unrealistic for zlib deflate on PDFs
  - Added accurate note explaining that all presets produce similar compression due to PDFs containing already-compressed content

### Technical Details
- **PDFExporter.java (Android)**: Added `compressPDF(inputPath, outputPath, compressionLevel, promise)` method that calls `StreamingPDFProcessor.compressPDFStreaming()`
- **PDFExporter.m (iOS)**: Added `compressPDF:outputPath:compressionLevel:resolver:rejecter:` method that calls `StreamingPDFProcessor compressPDFStreaming:`
- **PDFCompressor.js**: New module providing high-level compression API with presets (EMAIL, WEB, MOBILE, PRINT, ARCHIVE)

## [4.1.1] - 2025-01-05

### Fixed
- **iOS Pinch-to-Zoom**: Fixed critical issue where pinch-to-zoom gestures were not working on iOS devices
  - Removed interfering custom pinch gesture recognizer that was blocking PDFView's native pinch-to-zoom functionality
  - Enabled PDFView's native pinch gestures which work through its internal UIScrollView
  - Updated gesture recognizer delegate to allow simultaneous recognition with PDFView's internal gestures
  - Improved scale change event throttling to prevent excessive callbacks (0.01 threshold)
  - Pinch-to-zoom now works smoothly on iOS, matching Android behavior where native library handles gestures
- **Package Dependencies**: Removed incorrect self-dependency (`react-native-pdf-jsi: ^2.2.4`) from package.json that was causing package managers to install both v4.1.0 and v2.2.4 simultaneously

### Technical Details
- **RNPDFPdfView.mm (iOS)**: Removed custom `UIPinchGestureRecognizer` and `handlePinch:` method that was consuming pinch gestures without applying them to PDFView
- **RNPDFPdfView.mm (iOS)**: Explicitly enabled PDFView's native pinch gesture recognizers in gesture recognizer initialization loop
- **RNPDFPdfView.mm (iOS)**: Updated `onScaleChanged:` method with 0.01 threshold to reduce excessive callbacks for tiny scale changes
- **RNPDFPdfView.mm (iOS)**: Updated `gestureRecognizer:shouldRecognizeSimultaneouslyWithGestureRecognizer:` to allow PDFView's internal gestures to work simultaneously
- **package.json**: Removed self-dependency entry

This fix resolves [issue #11](https://github.com/126punith/react-native-pdf-jsi/issues/11) where pinch-to-zoom was not working on iOS while working correctly on Android, and [issue #12](https://github.com/126punith/react-native-pdf-jsi/issues/12) where the package incorrectly listed itself as a dependency causing circular dependency issues.

## [4.1.0] - 2025-12-30

### Fixed
- **Android onLoadComplete Callback**: Fixed critical issue where `onLoadComplete` prop was not firing on Android devices
  - **Note**: iOS was not affected by this issue. iOS uses a notification-based approach (`PDFViewDocumentChangedNotification`) which is inherently more reliable. This fix is Android-specific.
  - Added comprehensive error handling in `loadComplete()` to ensure events are always dispatched even if errors occur during page size retrieval, zoom operations, or table of contents serialization
  - Implemented delayed event dispatch using `Handler.post()` to ensure React component is mounted and ready before dispatching `loadComplete` event, fixing timing issues
  - Restored `drawPdf()` call in `onAfterUpdateTransaction()` to ensure PDF loads properly on initial mount
  - Added duplicate call prevention to avoid multiple `loadComplete` events
  - Added fallback dispatch mechanism in `drawPdf()` when skipping reload if PDF is already loaded but event wasn't dispatched
  - Enhanced logging for debugging event dispatch issues
  - Resets event tracking flags when PDF path changes to ensure `onLoadComplete` fires for new documents

### Technical Details
- **PdfView.java**: Added `loadCompleteDispatched` and `lastKnownPageCount` tracking flags, delayed dispatch mechanism, and comprehensive error handling
- **PdfManager.java**: Restored `drawPdf()` call in `onAfterUpdateTransaction()` method
- **RNPDFPdfView.mm (iOS)**: Updated `onDocumentChanged` to include file path in `loadComplete` message for consistency with Android format
- **index.js**: Added debug logging for event tracking in development mode

This fix resolves the regression similar to [react-native-pdf issue #899](https://github.com/wonday/react-native-pdf/issues/899) and ensures reliable `onLoadComplete` callback execution on Android. iOS implementation was also updated to include file path in the message format for consistency.

## [4.0.0] - 2025-12-13

### Added
- **iOS Pro Features Port**: Complete feature parity with Android - all pro features now available on iOS
  - File download and management (FileDownloader, FileManager)
  - PDF export operations (split, merge, extract, rotate, delete)
  - Export to images (PNG/JPEG)
  - PDF compression
  - Text extraction
- **iOS Performance Optimizations**:
  - ImagePool for efficient UIImage reuse and memory management
  - LazyMetadataLoader for deferred PDF metadata loading
  - MemoryMappedCache for zero-copy file access using mmap()
  - StreamingPDFProcessor for chunk-based processing of large files
- **Cross-Platform Compatibility**: Platform.OS checks for method signature differences (Android 3 args vs iOS 2 args for splitPDF)

### Fixed
- **TypeScript Definitions**: Fixed malformed comment blocks in `index.d.ts` that made functional props appear commented out
  - All props (spacing, password, renderActivityIndicator, enableAntialiasing, enablePaging, enableRTL, enableAnnotationRendering, enableDoubleTapZoom, fitPolicy) now properly documented
- **Android splitPDF**: Fixed argument count mismatch - Android requires 3 arguments (filePath, ranges, outputDir) while iOS requires 2 (filePath, ranges)
- **Promise Resolution**: Fixed EXC_BAD_ACCESS crashes by ensuring all promise callbacks execute on main thread
- **File Download**: Removed unstable native folder creation code, using react-native-blob-util for folder operations

### Changed
- **FileManager.js**: Removed subfolderName parameters, simplified to use react-native-blob-util for folder creation
- **ExportManager.js**: Removed folderName parameters, added Platform.OS compatibility checks
- **iOS FileDownloader**: Simplified implementation, removed subfolder creation logic
- **iOS FileManager**: Removed native createSubfolder method

## [3.4.2] - 2025-11-30

### Fixed
- **Android Compilation Error**: Fixed missing `setEnableMomentum` method implementation in `PdfManager.java` that was causing build failures with React Native codegen. The method is now implemented as a NOOP since Android's ScrollView handles momentum scrolling automatically.

## [3.4.1] - 2025-11-29

### Fixed
- Android and iOS build issues resolved

## [3.4.0] - 2025-11-29

### Added
- **Enhanced Navigation**: Added immediate page navigation support in `setPage()` method. The PDF now jumps to the specified page instantly when navigation is triggered programmatically.
- **Improved File Path Handling**: Added `downloadedFilePath` instance variable for reliable path tracking during PDF loading. This ensures file paths are available immediately, even before React state updates.
- **New `getPath()` Method**: Added public method to retrieve the current PDF file path. Returns the most reliable path source (instance variable > state path).
- **Enhanced Path Extraction**: Improved `onLoadComplete` callback to receive file path directly from native module, ensuring more reliable path availability for bookmarking, export, and PDF operations.

### Fixed
- **Navigation Reliability**: Fixed issue where programmatic page navigation would not scroll to the target page. The native `setPage()` method now calls `jumpTo()` immediately when the page changes.
- **File Path Availability**: Fixed issue where `pdfFilePath` was sometimes empty in `onLoadComplete`, causing failures in export and PDF operations. Path is now reliably extracted from multiple sources with proper fallbacks.
- **Native Event Handling**: Enhanced `loadComplete` event message format to include file path, improving reliability of path extraction in JavaScript.

### Changed
- **Native Message Format**: Updated `loadComplete` event format from `loadComplete|pages|width|height|tableContents` to `loadComplete|pages|width|height|path|tableContents` for backward compatibility with automatic detection of old/new formats.
- **Path Tracking**: File paths are now stored in an instance variable (`downloadedFilePath`) immediately upon file preparation/download completion, in addition to React state, ensuring synchronous access.

## [3.3.0] - Previous Version

Previous release notes...

