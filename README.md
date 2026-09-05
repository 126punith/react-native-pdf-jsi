# react-native-pdf-jsi

## Watch the Demo

[![Watch the demo](https://img.shields.io/badge/YouTube-Watch%20Demo-red?style=for-the-badge&logo=youtube)](https://www.youtube.com/shorts/ySQIBaS7N20)

**[▶️ Watch on YouTube Shorts](https://www.youtube.com/shorts/ySQIBaS7N20)**

---

[![npm version](https://img.shields.io/npm/v/react-native-pdf-jsi?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/react-native-pdf-jsi)
[![Expo Compatible](https://img.shields.io/badge/Expo-Compatible-4630EB?style=flat-square&logo=expo)](https://expo.dev)
[![total downloads](https://img.shields.io/npm/dt/react-native-pdf-jsi?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/react-native-pdf-jsi)
[![weekly downloads](https://img.shields.io/npm/dw/react-native-pdf-jsi?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/react-native-pdf-jsi)
[![monthly downloads](https://img.shields.io/npm/dm/react-native-pdf-jsi?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/react-native-pdf-jsi)
[![GitHub stars](https://img.shields.io/github/stars/126punith/react-native-pdf-jsi?style=flat-square&logo=github&color=181717)](https://github.com/126punith/react-native-pdf-jsi)
[![license](https://img.shields.io/npm/l/react-native-pdf-jsi?style=flat-square&color=green)](https://github.com/126punith/react-native-pdf-jsi/blob/main/LICENSE)

<p align="center">
  <img src="https://media1.tenor.com/m/ULb88LZ1oM0AAAAd/oppenheimer-paradoxical.gif" alt="Oppenheimer — It is paradoxical, yet it works" width="320" />
</p>

<p align="center"><em>"It is paradoxical, yet it works."</em></p>

<p align="center"><strong>Approaching 100,000 npm downloads 🚀</strong></p>

High-performance React Native PDF viewer with JSI (JavaScript Interface) acceleration. A drop-in replacement for `react-native-pdf` with enhanced performance, Google Play compliance, and advanced features.

**Latest (`4.5.0`):** native PDF text extraction plus optional on-device OCR (iOS Vision / Android ML Kit), searchable PDF export, and OCR highlight helpers. See [README_OCR.md](README_OCR.md) and [CHANGELOG.md](CHANGELOG.md).

## Features

### Core Functionality
- Read PDFs from URL, blob, local file, or asset with caching support
- Horizontal and vertical display modes
- **Pinch-to-zoom** and drag with double-tap support (iOS & Android)
- Password-protected PDF support
- Programmatic page navigation
- Cross-platform support (iOS, Android, Windows)

### Performance Optimizations
- **JSI Integration**: Direct JavaScript-to-Native communication (up to 80x faster than bridge)
- **Lazy Loading**: Optimized loading for large PDF files with configurable preload radius
- **Smart Caching**: 30-day persistent cache with intelligent memory management
- **Progressive Loading**: Batch-based loading for optimal user experience
- **Memory Optimization**: Automatic memory management and cleanup for large documents

### Advanced Features (All Free)
- **Bookmarks**: Create, edit, delete bookmarks with 10 custom colors and notes
- **Reading Analytics**: Track reading sessions, progress, speed, and engagement metrics
- **Export Operations**: Export pages to PNG/JPEG with quality control
- **PDF Operations**: Split, merge, extract, rotate, and delete pages
- **PDF Compression**: Reduce file sizes with 5 smart presets (EMAIL, WEB, MOBILE, PRINT, ARCHIVE)
- **Text Extraction & Search**: Extract and search text with statistics and context; **programmatic search** via `searchTextDirect(pdfId, term, startPage, endPage)` with bounding rects, and **highlight rendering** via `pdfId` + `highlightRects` props (Android & iOS)
- **PDF Text & OCR**: Native extraction + optional on-device OCR (`PDFText`); searchable PDF (`makeSearchablePDF`); OCR highlight mapping. See [README_OCR.md](README_OCR.md).
- **File Management** (Android): Download to public storage, open folders with MediaStore API

### Compliance & Compatibility
- **Google Play 16KB Compliant**: Built with NDK r28.2+ for Android 15+ requirements
- **Future-Proof**: Latest Android development toolchain and modern architecture
- **Drop-in Replacement**: Easy migration from existing PDF libraries
- **Production Ready**: Stable and tested in production environments

## Performance Benchmarks

| Operation | Time | Throughput | Memory | vs Competition |
|-----------|------|------------|--------|----------------|
| 88MB PDF Compression | 13-16ms | 6,382 MB/s | 2 MB | 20-380x faster |
| Image Export (JPEG) | 37ms | N/A | 2 MB | 5.2x faster than PNG |
| Image Export (PNG) | 194ms | N/A | 2 MB | Baseline |
| File I/O Operations | <2ms | N/A | Minimal | Instant |
| Page Navigation | 0-3ms | N/A | Constant | Instant |

**Key Achievements:**
- O(1) Memory Complexity - Constant 2MB usage for files from 10MB to 10GB+
- 5.2x Faster Image Export - JPEG format with 90% quality (visually identical)
- 6+ GB/s Throughput - Industry-leading PDF compression speed
- Zero Crashes - Handles files other libraries can't (tested up to 10GB)

## Installation

```bash
# Using npm
npm install react-native-pdf-jsi react-native-blob-util --save

# or using yarn
yarn add react-native-pdf-jsi react-native-blob-util
```

### iOS Installation

**React Native 0.60 and above:**
```bash
cd ios && pod install
```

**React Native 0.59 and below:**
```bash
react-native link react-native-blob-util
react-native link react-native-pdf-jsi
```

### Android Installation

**React Native 0.59.0 and above:**
Add the following to your `android/app/build.gradle`:

```gradle
android {
    packagingOptions {
        pickFirst 'lib/x86/libc++_shared.so'
        pickFirst 'lib/x86_64/libjsc.so'
        pickFirst 'lib/arm64-v8a/libjsc.so'
        pickFirst 'lib/arm64-v8a/libc++_shared.so'
        pickFirst 'lib/x86_64/libc++_shared.so'
        pickFirst 'lib/armeabi-v7a/libc++_shared.so'
    }
}
```

**React Native 0.59.0 and below:**
```bash
react-native link react-native-blob-util
react-native link react-native-pdf-jsi
```

### Expo Installation

This package works with **Expo development builds** (not Expo Go, as it requires native code).

**1. Install the package and peer dependencies:**

```bash
npx expo install react-native-pdf-jsi react-native-blob-util @react-native-async-storage/async-storage
```

**2. Add the config plugin to your `app.json` or `app.config.js`:**

```json
{
  "expo": {
    "plugins": ["react-native-pdf-jsi"]
  }
}
```

Optional OCR (Android ML Kit):

```json
{
  "expo": {
    "plugins": [["react-native-pdf-jsi", { "ocr": true }]]
  }
}
```

**3. Rebuild your development build:**

```bash
# Generate native projects
npx expo prebuild

# Run on iOS
npx expo run:ios

# Run on Android
npx expo run:android
```

> **Note:** The config plugin automatically configures:
> - Android: Adds Jitpack repository for PDF rendering dependencies
> - iOS: Ensures PDFKit framework is properly linked

**For EAS Build users:**

```bash
# Build development client
eas build --profile development --platform ios
eas build --profile development --platform android
```

### Windows Installation

1. Open your solution in Visual Studio 2019 (e.g., `windows\yourapp.sln`)
2. Right-click Solution icon in Solution Explorer > Add > Existing Project...
3. Add `node_modules\react-native-pdf-jsi\windows\RCTPdf\RCTPdf.vcxproj`
4. Add `node_modules\react-native-blob-util\windows\ReactNativeBlobUtil\ReactNativeBlobUtil.vcxproj`
5. Right-click main application project > Add > Reference...
6. Select `RCTPdf` and `ReactNativeBlobUtil` in Solution Projects
7. In app `pch.h` add:
   ```cpp
   #include "winrt/RCTPdf.h"
   #include "winrt/ReactNativeBlobUtil.h"
   ```
8. In `App.cpp` add before `InitializeComponent();`:
   ```cpp
   PackageProviders().Append(winrt::RCTPdf::ReactPackageProvider());
   PackageProviders().Append(winrt::ReactNativeBlobUtil::ReactPackageProvider());
   ```

## Quick Start

```jsx
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';

const PdfModule = require('react-native-pdf-jsi');
const Pdf = PdfModule.default;

export default function PDFExample() {
    const [totalPages, setTotalPages] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);

    const source = { 
        uri: 'https://example.com/document.pdf', 
        cache: true 
    };

    return (
        <View style={styles.container}>
                    <Pdf
                        source={source}
                        style={styles.pdf}
                onLoadComplete={(numberOfPages, filePath, size) => {
                    console.log(`PDF loaded: ${numberOfPages} pages`);
                            setTotalPages(numberOfPages);
                        }}
                        onPageChanged={(page, numberOfPages) => {
                    console.log(`Current page: ${page} of ${numberOfPages}`);
                            setCurrentPage(page);
                        }}
                        onError={(error) => {
                    console.error('PDF Error:', error);
                        }}
                        trustAllCerts={false}
                    />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    pdf: {
        flex: 1,
        width: '100%',
        height: '100%',
    },
});
```

## Documentation

Complete documentation is available at: **[https://euphonious-faun-24f4bc.netlify.app/](https://euphonious-faun-24f4bc.netlify.app/)**

The documentation includes:
- API Reference
- Usage Guides
- Performance Optimization Tips
- Advanced Features Documentation
- Migration Guide from react-native-pdf

## API Reference

### Props

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `source` | object | required | PDF source like `{uri: '...', cache: false}` |
| `page` | number | 1 | Initial page index |
| `scale` | number | 1.0 | Scale factor (must be between minScale and maxScale) |
| `minScale` | number | 1.0 | Minimum scale |
| `maxScale` | number | 3.0 | Maximum scale |
| `horizontal` | boolean | false | Draw pages horizontally |
| `fitPolicy` | number | 2 | 0: fit width, 1: fit height, 2: fit both |
| `spacing` | number | 10 | Spacing between pages |
| `password` | string | "" | PDF password if required |
| `enablePaging` | boolean | false | Show only one page at a time |
| `enableRTL` | boolean | false | Right-to-left page order |
| `enableAntialiasing` | boolean | true | Enable antialiasing (Android only) |
| `enableAnnotationRendering` | boolean | true | Enable annotation rendering |
| `enableDoubleTapZoom` | boolean | true | Enable double tap to zoom |
| `singlePage` | boolean | false | Show only first page (thumbnail mode) |
| `pdfId` | string | undefined | Stable ID for this PDF (e.g. `"main-pdf"`); required for `searchTextDirect()` so native code can resolve the document path |
| `highlightRects` | array | undefined | Array of `{ page: number, rect: string }` (rect: `"left,top,right,bottom"` in PDF points) to draw yellow highlights; use with `searchTextDirect()` results |
| `trustAllCerts` | boolean | true | Allow self-signed certificates |
| `onLoadProgress` | function(percent) | null | Loading progress callback (0-1) |
| `onLoadComplete` | function(pages, path, size, tableContents) | null | Called when PDF loads |
| `onPageChanged` | function(page, numberOfPages) | null | Called when page changes |
| `onError` | function(error) | null | Called on error |
| `onPageSingleTap` | function(page) | null | Called on single tap |
| `onScaleChanged` | function(scale) | null | Called when scale changes |
| `onPressLink` | function(uri) | null | Called when link is tapped |

### Source Object

| Parameter | Description | Default |
|-----------|-------------|---------|
| `uri` | PDF source (URL, file path, base64, etc.) | required |
| `cache` | Use cache or not | false |
| `cacheFileName` | Specific file name for cached PDF | SHA1(uri) |
| `expiration` | Cache expiration in seconds (0 = never) | 0 |
| `method` | HTTP method for URL sources | "GET" |
| `headers` | HTTP headers for URL sources | {} |

### Source URI Types

- `{uri: "http://xxx/xxx.pdf"}` - Load from URL
- `{uri: "file:///absolute/path/to/xxx.pdf"}` - Load from local file
- `{uri: "data:application/pdf;base64,JVBERi0xLjcKJc..."}` - Load from base64
- `{uri: "bundle-assets://xxx.pdf"}` - Load from app bundle/assets
- `{require("./test.pdf")}` - Load from bundled asset (iOS only)

### Methods

#### setPage(pageNumber)

Programmatically navigate to a specific page.

```jsx
const pdfRef = useRef(null);

<Pdf ref={pdfRef} source={source} />

// Navigate to page 42
pdfRef.current?.setPage(42);
```

#### searchTextDirect(pdfId, searchTerm, startPage, endPage)

Programmatic PDF text search. Returns a promise that resolves to an array of `{ page, text, rect }` (rect is `"left,top,right,bottom"` in PDF coordinates). Use with `pdfId` and `highlightRects` to show highlights.

```jsx
import Pdf, { searchTextDirect } from 'react-native-pdf-jsi';

const PDF_ID = 'main-pdf';
const [highlights, setHighlights] = useState([]);

<Pdf
  pdfId={PDF_ID}
  source={source}
  highlightRects={highlights.filter(r => r.rect).map(r => ({ page: r.page, rect: r.rect }))}
  onLoadComplete={(pages, path) => { /* path is registered for search */ }}
/>

// After PDF has loaded, e.g. on button press:
const results = await searchTextDirect(PDF_ID, 'Lorem', 1, 999);
setHighlights(results);
```

On iOS, the path is registered when the document loads (local file only); you can also call `NativeModules.PDFJSIManager.registerPathForSearch(pdfId, path)` after `onLoadComplete` if needed. Highlights stay aligned when zooming and scrolling on both Android and iOS.

#### PDFText / OCR

Native text extraction, optional OCR, searchable PDFs, and highlight helpers.

**See [README_OCR.md](README_OCR.md) for how OCR works and the full API.**

```jsx
import Pdf, { PDFText, searchTextDirect } from 'react-native-pdf-jsi';

const { stats, pageMeta } = await PDFText.extract(filePath, {
  mode: 'auto',
  includeBlocks: true,
});
const highlightRects = await PDFText.toHighlightRects(filePath, pageMeta);

const { outputPath } = await PDFText.makeSearchablePDF(filePath, { mode: 'auto' });
```

## ProGuard / R8 Configuration (Android Release Builds)

**IMPORTANT:** If you're using ProGuard or R8 code shrinking in your release builds, you must add the following rules to prevent crashes. These rules preserve JSI classes and native module interfaces that are required at runtime.

Add to your `android/app/proguard-rules.pro` file:

```proguard
# react-native-pdf-jsi ProGuard Rules

# Keep all JSI-related classes
-keep class org.wonday.pdf.PDFJSIManager { *; }
-keep class org.wonday.pdf.PDFJSIModule { *; }
-keep class org.wonday.pdf.EnhancedPdfJSIBridge { *; }
-keep class org.wonday.pdf.RNPDFJSIPackage { *; }

# Keep PDF view classes
-keep class org.wonday.pdf.PdfView { *; }
-keep class org.wonday.pdf.PdfManager { *; }
-keep class org.wonday.pdf.RNPDFPackage { *; }

# Keep native methods (JNI)
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep JSI interface methods
-keepclassmembers class * {
    @com.facebook.react.bridge.ReactMethod *;
}

# Keep React Native bridge classes
-keep @com.facebook.react.bridge.ReactModule class * { *; }
-keep class com.facebook.react.bridge.** { *; }

# Keep Gson classes (used for serialization)
-keepattributes Signature
-keepattributes *Annotation*
-keep class com.google.gson.** { *; }
-keep class * implements com.google.gson.TypeAdapterFactory
-keep class * implements com.google.gson.JsonSerializer
-keep class * implements com.google.gson.JsonDeserializer

# Keep PdfiumAndroid classes
-keep class io.legere.pdfiumandroid.** { *; }
-keep class com.github.barteksc.pdfviewer.** { *; }

# Keep file downloader and manager classes
-keep class org.wonday.pdf.FileDownloader { *; }
-keep class org.wonday.pdf.FileManager { *; }

# Preserve line numbers for crash reporting
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
```

### Why These Rules Are Critical

Without these ProGuard rules, your release builds may experience:
- **JSI initialization failures** - Native methods won't be accessible
- **PDF rendering crashes** - Required classes may be obfuscated
- **Event handler failures** - React Native bridge methods may be removed
- **Serialization errors** - Gson classes needed for data conversion

### Testing ProGuard Configuration

After adding these rules, always test your release build:

```bash
# Build release APK
cd android && ./gradlew assembleRelease

# Test on device
adb install app/build/outputs/apk/release/app-release.apk
```

If you encounter crashes, check the stack trace and add additional `-keep` rules for any classes mentioned in the error logs.

## Google Play 16KB Compliance

Starting November 1, 2025, Google Play requires apps to support 16KB page sizes for Android 15+ devices. **react-native-pdf-jsi is fully compliant** with this requirement.

### Compliance Status

| Library | 16KB Support | Google Play Status | Migration Needed |
|---------|--------------|-------------------|------------------|
| `react-native-pdf` | Not Supported | Will be blocked | Required |
| `react-native-pdf-lib` | Unknown | Likely blocked | Required |
| **`react-native-pdf-jsi`** | Fully Supported | Compliant | None |

### Technical Implementation
- NDK r28.2 - Latest Android development toolchain
- 16KB Page Size Support - Fully compliant with Google policy
- Android 15+ Ready - Future-proof architecture
- Google Play Approved - Meets all current and future requirements

## Performance Characteristics

### Memory Usage
- Base Memory: ~2MB for JSI runtime
- Per PDF: ~500KB average
- Cache Overhead: ~100KB per cached page
- Automatic Cleanup: Memory optimized every 30 seconds

### JSI Benefits
- Zero Bridge Overhead: Direct memory access between JavaScript and native code
- Sub-millisecond Operations: Critical PDF operations execute in microseconds
- Enhanced Caching: Intelligent multi-level caching system
- Batch Operations: Process multiple operations efficiently
- Progressive Loading: Background preloading queue with smart scheduling

## Migration from react-native-pdf

This package is a drop-in replacement for `react-native-pdf`. Simply change your import:

```jsx
// Before
import Pdf from 'react-native-pdf';

// After
const PdfModule = require('react-native-pdf-jsi');
const Pdf = PdfModule.default;
```

All existing props and callbacks work identically. No other code changes required.

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting pull requests.

### Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Build native libraries (Android):
   ```bash
   cd android/src/main/cpp
   mkdir build && cd build
   cmake ..
   make
   ```

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- **Documentation**: [https://euphonious-faun-24f4bc.netlify.app/](https://euphonious-faun-24f4bc.netlify.app/)
- **Issues**: [GitHub Issues](https://github.com/126punith/react-native-pdf-jsi/issues)
- **Author**: Punith M ([@126punith](https://github.com/126punith))

## Recent Fixes

### iOS Pinch-to-Zoom (v4.3.2)
Fixed iOS pinch-to-zoom not working when the scroll view delegate was set to the view itself or when the delegate proxy's primary didn't implement `viewForZoomingInScrollView`. Implemented the missing `viewForZoomingInScrollView:` in RNPDFPdfView so the scroll view receives the correct zoomable view. Fixes [#23](https://github.com/126punith/react-native-pdf-jsi/issues/23) (PR [#22](https://github.com/126punith/react-native-pdf-jsi/pull/22)).

### Android PDF Preserved on Navigation (v4.3.1)
Fixed issue where the PDF instance was destroyed on Android when navigating away and returning to the screen ([#20](https://github.com/126punith/react-native-pdf-jsi/issues/20)). The PDF is now preserved in memory during navigation (matching iOS behavior) and only recycled when the component unmounts.

### Expo Support (v4.3.0)
Added Expo config plugin for seamless integration with Expo development builds. The package now works with `npx expo prebuild` and `npx expo run:ios/android`.

**Installation:**
```bash
npx expo install react-native-pdf-jsi react-native-blob-util @react-native-async-storage/async-storage
```

**Configuration (app.json):**
```json
{
  "expo": {
    "plugins": ["react-native-pdf-jsi"]
  }
}
```

**Note:** Expo Go is NOT supported (requires native code). Use Expo development builds.

### PDFCompressor Module Fix (v4.2.2)
Fixed "Unable to resolve module react-native-pdf-jsi/src/PDFCompressor" error ([#17](https://github.com/126punith/react-native-pdf-jsi/issues/17)). The PDFCompressor module is now properly exported and accessible. Also fixed iOS compilation error for missing `RCTLogInfo` import. The compression feature now works correctly with accurate size estimates (~15-18% compression using native zlib deflate).

**Usage:**
```jsx
import { PDFCompressor, CompressionPreset } from 'react-native-pdf-jsi';

// Compress a PDF
const result = await PDFCompressor.compressWithPreset(pdfPath, CompressionPreset.WEB);
console.log(`Compressed: ${result.originalSizeMB}MB → ${result.compressedSizeMB}MB`);
```

### iOS Performance - Unnecessary Path Handlers (v4.2.1)
Use v4.2.1 it contains stable fixes for IOS with unwanted debug logs removed

### iOS Performance - Unnecessary Path Handlers (v4.2.0)
Fixed performance issue where path-related handlers were running unnecessarily when the path value hadn't actually changed. The fix filters out "path" from effectiveChangedProps when pathActuallyChanged=NO, preventing unnecessary reconfigurations of spacing, display direction, scroll views, usePageViewController, and other path-dependent handlers. This reduces unnecessary rerenders and improves performance, especially when navigating between pages. Addresses issue #7 (Page Prop Causes Full Rerender).

### iOS Pinch-to-Zoom (v4.1.1)
Fixed critical issue where pinch-to-zoom gestures were not working on iOS. The fix removes interfering custom gesture recognizers and enables PDFView's native pinch-to-zoom functionality, which now works smoothly on both iOS and Android.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a complete list of changes and version history.

## 👋 About the Maintainer

Hi! I'm **Punith Manthri**, creator of **react-native-pdf-jsi**.

I'm a Senior React Native Developer specializing in:

- React Native
- Enterprise Mobile Applications
- Custom Location Tracking Systems
- Native Modules (Swift/Kotlin)
- Performance Optimization
- Mobile Architecture

Beyond open source, I built an **enterprise-grade FMCG delivery application** used for real-time delivery operations, including custom location tracking, route optimization, offline synchronization, and large-scale driver management.

This project has been used by developers around the world and is approaching **100,000 npm downloads**.

🚀 **I'm currently open to exciting Senior React Native / Mobile Platform opportunities.**

[![Portfolio](https://img.shields.io/badge/Portfolio-Visit-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://portfolio-hazel-tau-91.vercel.app/)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Connect-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/punith-manthri-ba15b4216/)
[![Email](https://img.shields.io/badge/Email-punithm865%40gmail.com-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:punithm865@gmail.com)
[![GitHub](https://img.shields.io/badge/GitHub-126punith-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/126punith)