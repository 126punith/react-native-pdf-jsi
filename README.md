# react-native-pdf-jsi

[![npm downloads](https://img.shields.io/npm/dt/react-native-pdf-jsi)](https://www.npmjs.com/package/react-native-pdf-jsi)

## Breaking change in 5.0.0

**5.0.0 is not a drop-in upgrade.** Install it only if the app already uses the React Native New Architecture and you need the Nitro JSI document API (`getPdfLibrary().open(path)`).

Production apps on 4.x stay on the published line:

```sh
npm install react-native-pdf-jsi@4.5.0
```

`npm install react-native-pdf-jsi` with no version follows the npm `latest` tag. If that tag is 5.0.0, the next native build fails for the old architecture, Windows, `pdfId` strings, and the native modules removed below.

### What 5.0 removes

- Old Architecture (Paper). There is no fallback.
- Windows.
- `pdfId` string APIs. Open a document with `getPdfLibrary().open(path)` instead.
- Native modules: `PDFJSIManager`, `PDFExporter`, `PDFTextModule`, `FileManager`, `FileDownloader`.
- `createSearchablePDF` and `registerPathForSearch`.

5.0 requires `react-native-nitro-modules`. Details are in [MIGRATION-5.0.md](MIGRATION-5.0.md).

PDF viewer for React Native. Version 5 is the Nitro JSI path on the New Architecture.

- **Nitro** owns document logic: open, page geometry, render, search, text, OCR, merge, split, compress, and the on-disk cache.
- **Fabric** owns the view (`RNPDFPdfView`) and nothing else.
- **iOS** is a Swift Nitro hybrid on PDFKit and Vision.
- **Android** is a C++ Nitro hybrid on PDFium.
- Windows is not supported.

## Install 5.0 (New Architecture and Nitro JSI only)

Install this version only when you need that JSI logic. Everyone else keeps `react-native-pdf-jsi@4.5.0`.

```sh
npm install react-native-pdf-jsi@5.1.0 react-native-nitro-modules react-native-blob-util
cd ios && pod install
```

The host app must build with the New Architecture enabled. There is no Paper fallback.

Optional Android OCR (ML Kit) is off unless you set `pdfJsiEnableOcr=true` in `gradle.properties`. iOS OCR uses Vision and needs no extra flag.

### Expo

Use a development build (Expo Go is not supported). Install the native peers with `npx expo install react-native-pdf-jsi react-native-nitro-modules react-native-blob-util @react-native-async-storage/async-storage`, then add the plugin to `app.json`:

```json
{
  "expo": {
    "plugins": [["react-native-pdf-jsi", { "ocr": false }]]
  }
}
```

The plugin sets `newArchEnabled=true` for Android and iOS and fails prebuild if `"newArchEnabled": false` is set or `react-native-nitro-modules` is missing. Run `npx expo prebuild --clean` after adding it.

## View

```jsx
import Pdf from 'react-native-pdf-jsi';

<Pdf
  source={{ uri: filePath }}
  onLoadComplete={(pages) => {}}
  onPageChanged={(page, total) => {}}
/>
```

## Document handle

Cheap reads are synchronous. Work that touches the file or rasterizes a page returns a Promise.

```js
import { getPdfLibrary, openPdf } from 'react-native-pdf-jsi/src/PDFJSI';

const library = getPdfLibrary();
const document = await library.open(filePath);

document.pageCount;          // number, sync
document.pageSize(0);        // { width, height }, sync, 0-based
await document.renderPage(0, 2);
await document.searchText('hello', 0, document.pageCount - 1);
await document.extractText(0);
document.close();
```

Library calls that do not belong to one open document:

```js
await library.mergePDFs([a, b], outputPath);
await library.splitPDF(filePath, JSON.stringify([[0, 1]]), outputDir);
await library.extractPages(filePath, JSON.stringify([0, 2]), outputPath);
await library.compressPDF(inputPath, outputPath, 6);
library.jsiStats;            // sync
library.kb16Support;         // sync
library.ocrAvailable;        // sync
```

Page indexes on the Nitro handle are **0-based**. The older JS helpers `renderPageDirect` and `searchTextDirect` still accept 1-based page numbers and convert them.

## Document lifecycle

A native document holds PDFium/PDFKit memory that the JavaScript garbage collector cannot see, so it must be closed explicitly. Since 5.1.0 the package keeps open documents in a reference-counted registry. Prefer `withPdfDocument`, which releases the document when the callback finishes, even if it throws:

```js
import { withPdfDocument } from 'react-native-pdf-jsi';

const text = await withPdfDocument(filePath, (document) => document.extractText(0));
```

For a document that must stay open across several calls (for example, for the life of a screen), pair `acquirePdf` with `releasePdf`:

```js
import { acquirePdf, releasePdf } from 'react-native-pdf-jsi';

useEffect(() => {
  acquirePdf(filePath).then(setDocument, setError);
  return () => releasePdf(filePath);
}, [filePath]);
```

- Concurrent opens of the same path share one native document.
- Released documents stay open in a small warm pool (2 documents) so reopening is instant. The pool is emptied on memory warnings, or call `trimPdfCache()`.
- `openPdf(path)` still works and **pins** the document until `closePdf(path)`. `closePdf` force-closes, even while other code holds a reference.
- Call `invalidatePdf(path)` before overwriting a file at the same path, so the next open reads the new contents.
- `getPdfRegistryStats()` reports open, referenced, pinned, warm and stale counts, which is useful when checking for leaks.
- If you set a custom OCR engine with `PDFText.setOCREngine`, call `PDFText.clearOCREngine()` when the component that created it unmounts.

## Downloads

`PdfFiles.saveToDownloads(path, fileName)` (or `FileManager.downloadToPublicFolder`) saves a copy natively: into the public Downloads folder through MediaStore on Android, and into the app's Documents folder on iOS. No `react-native-blob-util` is needed.

On iOS the Documents folder shows in the Files app only when the app's `Info.plist` sets `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` to `true`. The Expo plugin adds both (opt out with `{ "iosFileSharing": false }`); bare apps add them by hand.

Paths returned for viewed documents point into the library's cache. To keep a document, load it with `cache: 'persistent'` or copy it with ``PdfFiles.copy(path, `${PdfFiles.documentDirectory}/name.pdf`)``.

## Commercial Nitro Edition & Support

react-native-pdf-jsi has crossed 223K downloads. Thank you to everyone who has used the library and supported its development.

I've recently worked on a complete migration to Nitro Modules and am exploring a paid offering for developers and teams interested in this implementation.

### What's included?

- Access to the Nitro-based implementation under a commercial license, where applicable.
- Assistance with setup and integration.
- Help troubleshooting native Android and iOS build issues.
- Direct support from the maintainer.

### Interested in the Nitro Edition?

The Nitro Edition and dedicated support will be available as a paid offering. Pricing and licensing details can be discussed based on your requirements.

Contact: [punithm865@gmail.com](mailto:punithm865@gmail.com)

### Want to support the ongoing development of the open-source version?

[Become a GitHub Sponsor](https://github.com/sponsors/126punith)

Your support helps me maintain the library and continue building for the React Native community.
