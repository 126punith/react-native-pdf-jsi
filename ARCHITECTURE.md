# Architecture

5.0.0 has two native stacks.

| Piece | Role |
| --- | --- |
| `RNPDFPdfView` (Fabric) | Renders the PDF. Android `PdfView.java`, iOS `RNPDFPdfView.mm` (PDFKit `PDFView`). No exported logic methods. |
| `PdfLibrary` / `PdfDocument` (Nitro) | Every document operation. iOS Swift, Android C++. |

`nitro.json` registers both hybrids with `ios: swift` and `android: c++`. Nitrogen generates the specs. Do not edit `nitrogen/generated`.

## Android

`android/src/main/cpp/PdfiumSession.cpp` holds one `FPDF_DOCUMENT` per `OpenPdf`. PDFium allows one call at a time in the process, so `FPDF_*` runs under a process-wide mutex. Each document also has its own mutex for handle state. `FPDF_InitLibrary` runs once. JPEG and PDF bytes are copied under the PDFium lock and written to disk after it is released.

`PdfOcr.java` is not a React Native module. It uses `PdfRenderer` and reflects ML Kit so the library still compiles when OCR is disabled.

## iOS

`ios/RNPDFPdf/HybridPdfLibrary.swift` and `HybridPdfDocument.swift` talk to PDFKit. OCR uses `VNRecognizeTextRequest`. Heavy methods use `Promise.parallel`, which is one background hop. Sync getters stay on the caller.

ObjC that remains is the Fabric view (`RNPDFPdfView`, `RNPDFPdfViewManager` props only) and `SearchRegistry`.

## What was removed

Paper view managers, `android/src/paper`, the `pdfjsi` JNI stubs, Windows, bridge modules, the shared `cpp/` hybrid, and the metrics mutex that guarded a map of page sizes.
