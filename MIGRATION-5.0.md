# Migrating to 5.0.0

5.0.0 deletes the Paper view managers, the React Native bridge modules, the Windows target, and the `pdfId` string API.

## Required

- React Native New Architecture (Fabric + Nitro). Old architecture builds will not compile.
- `react-native-nitro-modules` and `react-native-blob-util` stay peer dependencies.
- iOS 13+. Android `minSdk` is unchanged.
- Windows (`RCTPdf`, the `windows/` folder) is gone.

## API

Open a document and keep the handle. Do not mint a new id per call.

```js
// 4.x
await PDFJSI.registerPathForSearch(pdfId, path);
await PDFJSI.renderPageDirect(pdfId, 1, 2, path);

// 5.0
const document = await getPdfLibrary().open(path);
document.pageCount;
await document.renderPage(0, 2);
document.close();
```

Page indexes on `PdfDocument` are 0-based. `renderPageDirect`, `searchTextDirect`, `getPageMetrics`, and `preloadPagesDirect` in `src/PDFJSI.js` still take 1-based pages and subtract one. Pass the **file path** as the first argument; random `pdfId` strings are rejected.

These calls are synchronous properties or methods. Do not wrap them in an extra Promise:

- `pageCount`, `path`, `pageSize`, `pageMetrics`, `cacheMetrics`, `performanceMetrics`
- `setRenderQuality`, `clearCache`, `optimizeMemory`, `close`
- `jsiStats`, `kb16Support`, `ocrAvailable`

These stay async: `open`, `renderPage`, `preloadPages`, `searchText`, text extraction, `recognizeText`, image export, rotate, delete, merge, split, extract, compress, and the disk-cache methods.

`registerPathForSearch` is removed. The Fabric view registers its own search path from the `path` prop.

`createSearchablePDF` (the OCR sandwich export) is removed. `recognizeText(index, fast)` returns the recognized string.

File download and "open downloads" are `src/managers/FileManager.js`, implemented with `react-native-blob-util` and `Linking`. `NativeModules.FileManager` and `NativeModules.FileDownloader` no longer exist.

## Native modules removed

`PDFJSIManager`, `EnhancedPdfJSIBridge`, `PDFExporter`, `PDFTextModule`, `FileManager`, `FileDownloader`, and the JSI methods that used to live on `RNPDFPdfViewManager`. Call `NitroModules.createHybridObject('PdfLibrary')` instead.
