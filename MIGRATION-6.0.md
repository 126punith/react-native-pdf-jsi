# Migrating to 6.0.0

6.0 replaces the viewer component, moves downloads into native code, and makes pages zero-based everywhere. It is a breaking release: plan an afternoon for a typical app.

## Summary

| Area | 5.x | 6.0 |
| --- | --- | --- |
| Viewer | `Pdf` from `index.js` (AndroidPdfViewer on Android) | `PdfView` (own tiled PDFium viewer on Android, PDFKit on iOS) |
| Pages | 1-based in the view and managers, 0-based on `PdfDocument` | 0-based everywhere |
| Downloads | `react-native-blob-util` in JS | Native `PdfCache` (ETag revalidation, resume, LRU limit) |
| Errors | Strings | `PdfError` with a stable `code` |
| Editing | `rotatePage` / `deletePage` write the file immediately | Edits stay in memory until `document.save(path)` |
| Language | JavaScript with hand-written `index.d.ts` | TypeScript, types generated from source |

## Dependencies

Remove these from your app unless you use them yourself:

```sh
npm uninstall react-native-blob-util @react-native-async-storage/async-storage crypto-js
```

`react-native-nitro-modules` (0.37.x) is the only native peer. The New Architecture is still required, iOS 13+.

On Android the Jitpack repository is no longer needed for this package. Expo users: the config plugin no longer edits `build.gradle`.

## The viewer

```tsx
// 5.x
import Pdf from 'react-native-pdf-jsi';

<Pdf
  source={{ uri, cache: true }}
  page={3}
  onLoadComplete={(numberOfPages, path, size) => {}}
  onPageChanged={(page, numberOfPages) => {}}
  onError={(error) => {}}
/>

// 6.0
import { PdfView, type PdfViewRef } from 'react-native-pdf-jsi';

const ref = useRef<PdfViewRef>(null);

<PdfView
  ref={ref}
  source={{ uri }}
  initialPage={2}
  onLoad={({ pageCount, path, width, height, outline }) => {}}
  onPageChange={({ page, pageCount }) => {}}
  onError={(error) => console.warn(error.code, error.message)}
/>

ref.current?.goToPage(5);
ref.current?.zoomTo(2, { animated: true });
```

The default export is still the viewer (`import Pdf from 'react-native-pdf-jsi'` gives `PdfView`), but its props changed.

### Props

| 5.x | 6.0 |
| --- | --- |
| `page` (1-based, controlled) | `initialPage` (0-based, applied once) plus `ref.goToPage(page)` |
| `scale` | `initialScale` plus `ref.zoomTo(scale)` |
| `fitPolicy={0 \| 1 \| 2}` | `fitPolicy="width" \| "height" \| "page"` |
| `onLoadComplete(n, path, size, toc)` | `onLoad({ pageCount, path, width, height, outline })` |
| `onPageChanged(page, n)` | `onPageChange({ page, pageCount })`, `page` is 0-based |
| `onScaleChanged(scale)` | `onScaleChange({ scale })` |
| `onPageSingleTap(page, x, y)` | `onPageTap({ page, x, y })`, in PDF points from the page's top-left |
| `onPressLink(url)` | `onLinkPress({ url })` |
| `onLoadProgress(percent)` | `onLoadProgress({ loadedBytes, totalBytes })`; `totalBytes` is missing when the server sends no length |
| `onError(error)` | `onError(pdfError)` |
| `highlightRects=[{ page, rect: "l,t,r,b" }]` | `highlights=[{ page, rect: { x, y, width, height } }]` |
| `renderActivityIndicator(progress)` | Same, receives `{ loadedBytes, totalBytes }` or `null`; pass `null` to hide it |
| `trustAllCerts`, `usePDFKit`, `enableAntialiasing`, `enableAnnotations`… | Removed |

Highlights and taps share one coordinate system: PDF points measured from the top-left corner of the page as it is displayed (rotation applied). `document.searchText` returns rectangles in the same system, so results can be passed straight to `highlights`.

`onPageChange` fires once scrolling settles, not on every frame.

### Passwords

```tsx
const [password, setPassword] = useState<string>();

<PdfView
  source={{ uri }}
  password={password}
  onPasswordRequired={({ incorrect }) => promptForPassword(incorrect).then(setPassword)}
/>
```

Without `onPasswordRequired`, the view calls `onError` with code `password-required` or `password-incorrect`. Downloaded files are reused when the password changes.

## Sources and caching

```ts
{ uri: 'https://…', headers, cache: 'session' }  // default: cleared when the app's cache is cleared
{ uri: 'https://…', cache: 'persistent' }         // kept until removed (Application Support / noBackupFilesDir), still revalidated
{ uri: 'https://…', cache: 'none' }               // always downloaded; the file is removed after 24 hours
{ uri: 'https://…', maxAgeMs: 60_000 }            // skip revalidation for a minute
{ uri: 'https://…', cacheKey: 'invoice-42' }      // for signed URLs that change every time
{ filePath: '/data/…/file.pdf' }
{ base64: 'JVBERi0…' }
require('./manual.pdf')
```

`cache: true` still means `'session'` and `cache: false` means `'none'`. `expiration` and `cacheFileName` are gone; use `maxAgeMs` and `cacheKey`.

Cached documents are revalidated with `If-None-Match` / `If-Modified-Since`. When the device is offline (or the server answers with a 5xx), the stored copy is used. Files of 32 MB and more resume with a `Range` request after an interruption instead of starting over. Concurrent requests for the same document share one download. The `session` cache keeps at most 200 MB by default, removing the least recently used copies first; `persistent` copies stay until you remove them:

```ts
import { PdfCache, PdfFiles } from 'react-native-pdf-jsi';

PdfCache.maxCacheBytes = 500 * 1024 * 1024;
await PdfCache.clear();
await PdfFiles.saveToDownloads(path, 'report.pdf');
```

Source objects are compared by value, so writing `source={{ uri }}` inline no longer reloads the document on every render.

## Saving files

5.x copied every loaded PDF into the documents folder. 6.0 does not: the path from `onLoad`, `usePdfDocument` or `PdfCache.download` points into the library's cache. Do not store a `cache: 'none'` or `'session'` path for later; the file can be gone after a restart. Use `cache: 'persistent'`, or copy the file somewhere you own:

```ts
const target = `${PdfFiles.documentDirectory}/invoice-42.pdf`;
await PdfFiles.copy(path, target);
```

`PdfFiles.saveToDownloads` (and `FileManager.downloadToPublicFolder`) writes to the public Downloads folder on Android and to the app's Documents folder on iOS. iOS lists that folder in the Files app (On My iPhone, then your app) only when the app's `Info.plist` contains:

```xml
<key>UIFileSharingEnabled</key>
<true/>
<key>LSSupportsOpeningDocumentsInPlace</key>
<true/>
```

The Expo plugin adds both keys; pass `{ "iosFileSharing": false }` to opt out. Bare React Native apps add them by hand. `FileManager.openDownloadsFolder()` opens the app's folder in the Files app.

## Pages are zero-based

Every API that takes or returns a page now uses 0-based indexes:

- `PdfView`: `initialPage`, `goToPage`, `onPageChange`, `onPageTap`, `highlights`, `outline[].page`
- `ExportManager`: `exportPageToText`, `exportPageToImage`, `extractPages`, `deletePages`, `rotatePages`; `splitPDF` takes `[[start, end], …]` pairs
- `PDFText.extract({ pages })`, `toHighlightRects` / `blocksToHighlightRects` output
- `BookmarkManager` bookmarks and reading progress

Values that are not whole numbers (`NaN`, `1.5`, `'2'`) are ignored by navigation methods and rejected with `invalid-page` by document methods.

Stored 5.x bookmarks used 1-based pages. Subtract one when you migrate them:

```ts
for (const bookmark of await bookmarkManager.getBookmarks(pdfId)) {
  await bookmarkManager.updateBookmark(pdfId, bookmark.id, { page: bookmark.page - 1 });
}
```

## Errors

Every promise rejects with a `PdfError`:

```ts
import { isPdfError } from 'react-native-pdf-jsi';

try {
  await document.renderPage(99);
} catch (error) {
  if (isPdfError(error) && error.code === 'invalid-page') { … }
}
```

Codes: `invalid-source`, `download-failed`, `password-required`, `password-incorrect`, `unsupported-pdf`, `page-render-failed`, `out-of-memory`, `invalid-page`, `invalid-argument`, `unsupported-operation`, `io-error`, `cancelled`, `document-closed`, `unknown`. Match on `code`; messages may change. `errorMessageFor(error)` returns a readable English message.

## Documents

`usePdfDocument` loads a source and opens it, releasing it on unmount:

```tsx
const { document, loading, error } = usePdfDocument({ uri });
```

Outside components, prefer `withPdfDocument(path, (document) => …)` or `acquirePdf` / `releasePdf`.

### Rendering

```ts
// 5.x
await document.renderPage(0, 2);           // returned a JSON string
await document.exportPageToImage(0, 2);
await document.exportToImages(2);

// 6.0
const image = await document.renderPage(0, { maxWidth: 1080, format: 'jpeg', quality: 85 });
image.uri; image.width; image.height;

const thumbnails = await document.renderThumbnails({ maxWidth: 200 });
```

`renderPage` scales to fit `maxWidth` / `maxHeight` (or uses `scale`) and returns `{ page, uri, path, width, height }`.

`<PdfPage document={document} page={0} />` draws one page sized by its aspect ratio, for thumbnails and custom layouts.

### Editing

Edits change the open document. Nothing is written until you save:

```ts
await document.rotatePage(0, 90);
await document.deletePage(3);
await document.movePage(5, 0);
await document.insertPages('/path/other.pdf', 2);
await document.addAnnotation({ page: 0, type: 'highlight', rect: { x: 72, y: 72, width: 200, height: 20 } });
await document.setFormFieldValues({ name: 'Ada' });
await document.save(outputPath);
await document.save(outputPath, { userPassword: 'open', ownerPassword: 'owner', permissions: { print: true } });
```

In 5.x `rotatePage` and `deletePage` rewrote the source file immediately. If you relied on that, call `save(document.path)` and then `invalidatePdf(document.path)`.

Saving with a password is supported on iOS. On Android it rejects with `unsupported-operation`.

## Removed

- `PDFJSI` default object and its helpers: `renderPageDirect`, `getPageMetrics`, `preloadPagesDirect`, `searchTextDirect`, `getCacheMetrics`, `clearCacheDirect`, `optimizeMemory`, `getPerformanceMetrics`, `setRenderQuality`, `getJSIStats`, `getPerformanceHistory`, `clearPerformanceHistory`. Use `PdfDocument` methods.
- `PdfDocument.preloadPages`, `cacheMetrics`, `performanceMetrics`, `setRenderQuality`, `clearCache`, `optimizeMemory`, `exportPageToImage`, `exportToImages`; `PdfLibrary.jsiStats`. The viewer manages its own cache.
- `EnhancedPdfView`, `usePDFJSI`, `PdfViewFlatList`, `DoubleTapView`, `PinchZoomView`, `index.js.flow`.
- `PDFText.makeSearchablePDF` (already non-functional in 5.x).
- `BookmarkManager` no longer imports AsyncStorage. Pass your own storage:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
bookmarkManager.setStorage(AsyncStorage);
```

Without it, bookmarks are kept in memory.

## Android

AndroidPdfViewer, `io.legere:pdfiumandroid` and Gson are no longer dependencies. If your app excluded or pinned them for this library, remove that configuration. The viewer is written in Kotlin; the library applies the Kotlin Android plugin itself.
