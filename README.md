# react-native-pdf-jsi

PDF viewer for React Native. Version 5 requires the New Architecture.

- **Nitro** owns document logic: open, page geometry, render, search, text, OCR, merge, split, compress, and the on-disk cache.
- **Fabric** owns the view (`RNPDFPdfView`) and nothing else.
- **iOS** is a Swift Nitro hybrid on PDFKit and Vision.
- **Android** is a C++ Nitro hybrid on PDFium.
- Windows is not supported.

See [MIGRATION-5.0.md](MIGRATION-5.0.md) if you are upgrading from 4.x.

## Install

```sh
npm install react-native-pdf-jsi react-native-nitro-modules react-native-blob-util
cd ios && pod install
```

The host app must build with the New Architecture enabled. There is no Paper fallback.

Optional Android OCR (ML Kit) is off unless you set `pdfJsiEnableOcr=true` in `gradle.properties`. iOS OCR uses Vision and needs no extra flag.

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

## Downloads

Saving into the public Downloads folder is done in JavaScript with `react-native-blob-util` (`FileManager.downloadToPublicFolder`). There is no native file-picker module.
