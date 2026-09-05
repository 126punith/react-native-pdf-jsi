/**
 * Copyright (c) 2025-present, Punith M (punithm300@gmail.com)
 * PDF text extraction (Pdfium) and optional on-device OCR (ML Kit).
 */

package org.wonday.pdf;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.pdf.PdfDocument;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.util.Log;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.lang.reflect.Method;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import io.legere.pdfiumandroid.PdfiumCore;
import io.legere.pdfiumandroid.PdfPage;
import io.legere.pdfiumandroid.PdfTextPage;

public class PDFTextModule extends ReactContextBaseJavaModule {
    private static final String TAG = "PDFTextModule";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    public PDFTextModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @Override
    public String getName() {
        return "PDFTextModule";
    }

    private String normalizePath(String filePath) {
        if (filePath == null) return null;
        if (filePath.startsWith("file://")) {
            return filePath.substring(7);
        }
        return filePath;
    }

    private ParcelFileDescriptor openPdfDescriptor(String path) throws IOException {
        if (path.startsWith("content://")) {
            return getReactApplicationContext().getContentResolver()
                .openFileDescriptor(Uri.parse(path), "r");
        }
        File file = new File(path);
        if (!file.exists() || !file.canRead()) {
            throw new IOException("PDF file not found or unreadable: " + path);
        }
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @ReactMethod
    public void getCapabilities(Promise promise) {
        WritableMap caps = Arguments.createMap();
        caps.putBoolean("textExtraction", true);
        caps.putBoolean("ocr", BuildConfig.PDF_JSI_OCR_ENABLED && isMlKitPresent());
        caps.putBoolean("customEngineSupported", true);
        caps.putBoolean("recognizePage", BuildConfig.PDF_JSI_OCR_ENABLED && isMlKitPresent());
        caps.putBoolean("searchablePdf", true);
        caps.putString("platform", "android");
        caps.putBoolean("ocrBuildEnabled", BuildConfig.PDF_JSI_OCR_ENABLED);
        promise.resolve(caps);
    }

    @ReactMethod
    public void isOCRAvailable(Promise promise) {
        promise.resolve(BuildConfig.PDF_JSI_OCR_ENABLED && isMlKitPresent());
    }

    @ReactMethod
    public void getPageCount(String filePath, Promise promise) {
        executor.execute(() -> {
            ParcelFileDescriptor pfd = null;
            try {
                String path = normalizePath(filePath);
                pfd = openPdfDescriptor(path);
                try (PdfRenderer renderer = new PdfRenderer(pfd)) {
                    promise.resolve(renderer.getPageCount());
                }
                pfd = null;
            } catch (Exception e) {
                Log.e(TAG, "getPageCount failed", e);
                promise.reject("PAGE_COUNT_ERROR", e.getMessage(), e);
            } finally {
                closeQuietly(pfd);
            }
        });
    }

    @ReactMethod
    public void getPageSize(String filePath, int pageIndex, Promise promise) {
        executor.execute(() -> {
            ParcelFileDescriptor pfd = null;
            io.legere.pdfiumandroid.PdfDocument doc = null;
            try {
                String path = normalizePath(filePath);
                pfd = openPdfDescriptor(path);
                PdfiumCore core = new PdfiumCore();
                doc = core.newDocument(pfd);
                int pageCount = doc.getPageCount();
                if (pageIndex < 0 || pageIndex >= pageCount) {
                    promise.reject("PAGE_SIZE_ERROR", "Page index out of range: " + pageIndex);
                    return;
                }
                PdfPage page = doc.openPage(pageIndex);
                try {
                    WritableMap size = Arguments.createMap();
                    size.putDouble("width", page.getPageWidthPoint());
                    size.putDouble("height", page.getPageHeightPoint());
                    promise.resolve(size);
                } finally {
                    page.close();
                }
            } catch (Exception e) {
                Log.e(TAG, "getPageSize failed", e);
                promise.reject("PAGE_SIZE_ERROR", e.getMessage(), e);
            } finally {
                closeDoc(doc);
                closeQuietly(pfd);
            }
        });
    }

    @ReactMethod
    public void extractTextFromPage(String filePath, int pageIndex, Promise promise) {
        executor.execute(() -> {
            try {
                String text = extractPageText(normalizePath(filePath), pageIndex);
                promise.resolve(text != null ? text : "");
            } catch (Exception e) {
                Log.e(TAG, "extractTextFromPage failed", e);
                promise.reject("EXTRACT_TEXT_ERROR", e.getMessage(), e);
            }
        });
    }

    @ReactMethod
    public void extractTextFromPages(String filePath, ReadableArray pageIndices, Promise promise) {
        executor.execute(() -> {
            ParcelFileDescriptor pfd = null;
            io.legere.pdfiumandroid.PdfDocument doc = null;
            try {
                String path = normalizePath(filePath);
                pfd = openPdfDescriptor(path);
                PdfiumCore core = new PdfiumCore();
                doc = core.newDocument(pfd);
                WritableMap out = Arguments.createMap();
                int pageCount = doc.getPageCount();
                for (int i = 0; i < pageIndices.size(); i++) {
                    int pageIndex = pageIndices.getInt(i);
                    if (pageIndex < 0 || pageIndex >= pageCount) {
                        out.putString(String.valueOf(pageIndex), "");
                        continue;
                    }
                    out.putString(String.valueOf(pageIndex), extractPageText(doc, pageIndex));
                }
                promise.resolve(out);
            } catch (Exception e) {
                Log.e(TAG, "extractTextFromPages failed", e);
                promise.reject("EXTRACT_TEXT_ERROR", e.getMessage(), e);
            } finally {
                closeDoc(doc);
                closeQuietly(pfd);
            }
        });
    }

    @ReactMethod
    public void extractAllText(String filePath, Promise promise) {
        executor.execute(() -> {
            ParcelFileDescriptor pfd = null;
            io.legere.pdfiumandroid.PdfDocument doc = null;
            try {
                String path = normalizePath(filePath);
                pfd = openPdfDescriptor(path);
                PdfiumCore core = new PdfiumCore();
                doc = core.newDocument(pfd);
                int pageCount = doc.getPageCount();
                WritableMap out = Arguments.createMap();
                for (int i = 0; i < pageCount; i++) {
                    out.putString(String.valueOf(i), extractPageText(doc, i));
                }
                promise.resolve(out);
            } catch (Exception e) {
                Log.e(TAG, "extractAllText failed", e);
                promise.reject("EXTRACT_TEXT_ERROR", e.getMessage(), e);
            } finally {
                closeDoc(doc);
                closeQuietly(pfd);
            }
        });
    }

    @ReactMethod
    public void recognizeImage(String imagePath, ReadableMap options, Promise promise) {
        executor.execute(() -> {
            if (!ensureOcrReady(promise)) return;
            Bitmap bitmap = null;
            try {
                String path = normalizePath(imagePath);
                bitmap = BitmapFactory.decodeFile(path);
                if (bitmap == null) {
                    promise.reject("OCR_IMAGE_ERROR", "Failed to decode image: " + path);
                    return;
                }
                WritableMap result = runMlKitOcr(bitmap);
                result.putInt("imageWidth", bitmap.getWidth());
                result.putInt("imageHeight", bitmap.getHeight());
                promise.resolve(result);
            } catch (Exception e) {
                Log.e(TAG, "recognizeImage failed", e);
                promise.reject("OCR_ERROR", e.getMessage(), e);
            } finally {
                recycleBitmap(bitmap);
            }
        });
    }

    /**
     * Render a PDF page to an in-memory bitmap and run OCR (no temp image file).
     */
    @ReactMethod
    public void recognizePage(String filePath, int pageIndex, ReadableMap options, Promise promise) {
        executor.execute(() -> {
            if (!ensureOcrReady(promise)) return;
            ParcelFileDescriptor pfd = null;
            Bitmap bitmap = null;
            try {
                String path = normalizePath(filePath);
                double dpi = options != null && options.hasKey("dpi") ? options.getDouble("dpi") : 200.0;
                float scale = (float) Math.max(1.0, dpi / 72.0);

                pfd = openPdfDescriptor(path);
                try (PdfRenderer renderer = new PdfRenderer(pfd)) {
                    pfd = null;
                    if (pageIndex < 0 || pageIndex >= renderer.getPageCount()) {
                        promise.reject("OCR_ERROR", "Page index out of range: " + pageIndex);
                        return;
                    }
                    PdfRenderer.Page page = renderer.openPage(pageIndex);
                    try {
                        int width = Math.max(1, Math.round(page.getWidth() * scale));
                        int height = Math.max(1, Math.round(page.getHeight() * scale));
                        bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
                        Canvas canvas = new Canvas(bitmap);
                        canvas.drawColor(Color.WHITE);
                        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                    } finally {
                        page.close();
                    }
                }

                WritableMap result = runMlKitOcr(bitmap);
                result.putInt("imageWidth", bitmap.getWidth());
                result.putInt("imageHeight", bitmap.getHeight());
                promise.resolve(result);
            } catch (Exception e) {
                Log.e(TAG, "recognizePage failed", e);
                promise.reject("OCR_ERROR", e.getMessage(), e);
            } finally {
                recycleBitmap(bitmap);
                closeQuietly(pfd);
            }
        });
    }

    /**
     * Build an image+invisible-text searchable PDF from JS-prepared page payloads.
     * pages: [{ imagePath, widthPt, heightPt, blocks: [{ text, rect }] }]
     * rect is image-pixel top-left "left,top,right,bottom".
     */
    @ReactMethod
    public void createSearchablePDF(ReadableArray pages, String outputPath, Promise promise) {
        executor.execute(() -> {
            PdfDocument outDoc = null;
            FileOutputStream fos = null;
            try {
                if (pages == null || pages.size() == 0) {
                    promise.reject("SEARCHABLE_PDF_ERROR", "pages array is required");
                    return;
                }
                String out = normalizePath(outputPath);
                if (out == null || out.isEmpty()) {
                    promise.reject("SEARCHABLE_PDF_ERROR", "outputPath is required");
                    return;
                }

                outDoc = new PdfDocument();
                Paint imagePaint = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
                Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
                // Near-invisible but still present in content stream for text extractors
                textPaint.setColor(Color.argb(2, 0, 0, 0));
                textPaint.setStyle(Paint.Style.FILL);

                for (int i = 0; i < pages.size(); i++) {
                    ReadableMap pageMap = pages.getMap(i);
                    if (pageMap == null) continue;
                    String imagePath = normalizePath(pageMap.getString("imagePath"));
                    float widthPt = (float) pageMap.getDouble("widthPt");
                    float heightPt = (float) pageMap.getDouble("heightPt");
                    if (widthPt <= 0) widthPt = 612f;
                    if (heightPt <= 0) heightPt = 792f;

                    Bitmap pageBitmap = BitmapFactory.decodeFile(imagePath);
                    if (pageBitmap == null) {
                        throw new IOException("Failed to decode page image: " + imagePath);
                    }

                    int pageW = Math.max(1, Math.round(widthPt));
                    int pageH = Math.max(1, Math.round(heightPt));
                    PdfDocument.PageInfo info =
                        new PdfDocument.PageInfo.Builder(pageW, pageH, i + 1).create();
                    PdfDocument.Page outPage = outDoc.startPage(info);
                    Canvas canvas = outPage.getCanvas();
                    canvas.drawBitmap(pageBitmap, null, new Rect(0, 0, pageW, pageH), imagePaint);

                    float imgW = pageBitmap.getWidth();
                    float imgH = pageBitmap.getHeight();
                    float sx = pageW / imgW;
                    float sy = pageH / imgH;

                    if (pageMap.hasKey("blocks")) {
                        ReadableArray blocks = pageMap.getArray("blocks");
                        if (blocks != null) {
                            for (int b = 0; b < blocks.size(); b++) {
                                ReadableMap block = blocks.getMap(b);
                                if (block == null) continue;
                                String text = block.hasKey("text") ? block.getString("text") : "";
                                if (text == null || text.isEmpty()) continue;
                                String rectStr = block.hasKey("rect") ? block.getString("rect") : null;
                                drawInvisibleText(canvas, text, rectStr, sx, sy, pageH, textPaint);
                            }
                        }
                    }

                    outDoc.finishPage(outPage);
                    pageBitmap.recycle();
                }

                File outFile = new File(out);
                File parent = outFile.getParentFile();
                if (parent != null && !parent.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    parent.mkdirs();
                }
                fos = new FileOutputStream(outFile);
                outDoc.writeTo(fos);
                fos.flush();

                WritableMap result = Arguments.createMap();
                result.putString("outputPath", out);
                result.putInt("pageCount", pages.size());
                promise.resolve(result);
            } catch (Exception e) {
                Log.e(TAG, "createSearchablePDF failed", e);
                promise.reject("SEARCHABLE_PDF_ERROR", e.getMessage(), e);
            } finally {
                if (outDoc != null) {
                    outDoc.close();
                }
                if (fos != null) {
                    try {
                        fos.close();
                    } catch (IOException ignored) {}
                }
            }
        });
    }

    private void drawInvisibleText(Canvas canvas, String text, String rectStr,
                                   float sx, float sy, float pageH, Paint textPaint) {
        float left = 0, top = 0, right = pageH, bottom = pageH;
        if (rectStr != null && rectStr.contains(",")) {
            String[] parts = rectStr.split(",");
            if (parts.length >= 4) {
                try {
                    left = Float.parseFloat(parts[0].trim());
                    top = Float.parseFloat(parts[1].trim());
                    right = Float.parseFloat(parts[2].trim());
                    bottom = Float.parseFloat(parts[3].trim());
                } catch (NumberFormatException ignored) {}
            }
        }
        // Image top-left → PDF page coords (canvas origin top-left for PdfDocument)
        float x = left * sx;
        float yTop = top * sy;
        float boxH = Math.max(8f, Math.abs(bottom - top) * sy);
        textPaint.setTextSize(Math.max(6f, boxH * 0.85f));
        // drawText uses baseline; place near top of box
        canvas.drawText(text.replace('\n', ' '), x, yTop + boxH * 0.8f, textPaint);
    }

    private boolean ensureOcrReady(Promise promise) {
        if (!BuildConfig.PDF_JSI_OCR_ENABLED) {
            promise.reject(
                "OCR_DISABLED",
                "OCR is not enabled. Set pdfJsiEnableOcr=true in gradle.properties " +
                    "or use the Expo plugin option { ocr: true }, then rebuild."
            );
            return false;
        }
        if (!isMlKitPresent()) {
            promise.reject(
                "OCR_UNAVAILABLE",
                "ML Kit text recognition is not on the classpath. Rebuild with OCR enabled."
            );
            return false;
        }
        return true;
    }

    private String extractPageText(String path, int pageIndex) throws IOException {
        ParcelFileDescriptor pfd = null;
        io.legere.pdfiumandroid.PdfDocument doc = null;
        try {
            pfd = openPdfDescriptor(path);
            PdfiumCore core = new PdfiumCore();
            doc = core.newDocument(pfd);
            int pageCount = doc.getPageCount();
            if (pageIndex < 0 || pageIndex >= pageCount) {
                throw new IOException("Page index out of range: " + pageIndex + " (count=" + pageCount + ")");
            }
            return extractPageText(doc, pageIndex);
        } finally {
            closeDoc(doc);
            closeQuietly(pfd);
        }
    }

    private String extractPageText(io.legere.pdfiumandroid.PdfDocument doc, int pageIndex) {
        PdfPage page = doc.openPage(pageIndex);
        if (page == null) return "";
        try {
            PdfTextPage textPage = page.openTextPage();
            if (textPage == null) return "";
            try {
                int chars = textPage.textPageCountChars();
                if (chars <= 0) return "";
                String text = textPage.textPageGetText(0, chars);
                return text != null ? text : "";
            } finally {
                textPage.close();
            }
        } catch (Exception e) {
            Log.d(TAG, "No text on page " + pageIndex + ": " + e.getMessage());
            return "";
        } finally {
            page.close();
        }
    }

    private boolean isMlKitPresent() {
        try {
            Class.forName("com.google.mlkit.vision.text.TextRecognition");
            return true;
        } catch (ClassNotFoundException e) {
            return false;
        }
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private WritableMap runMlKitOcr(Bitmap bitmap) throws Exception {
        Class<?> inputImageClass = Class.forName("com.google.mlkit.vision.common.InputImage");
        Method fromBitmap = inputImageClass.getMethod("fromBitmap", Bitmap.class, int.class);
        Object inputImage = fromBitmap.invoke(null, bitmap, 0);

        Class<?> textRecognitionClass = Class.forName("com.google.mlkit.vision.text.TextRecognition");
        Class<?> optionsClass = Class.forName("com.google.mlkit.vision.text.latin.TextRecognizerOptions");
        Object defaultOptions = optionsClass.getField("DEFAULT_OPTIONS").get(null);
        Method getClient;
        try {
            Class<?> optionsInterface = Class.forName(
                "com.google.mlkit.vision.text.TextRecognizerOptionsInterface");
            getClient = textRecognitionClass.getMethod("getClient", optionsInterface);
        } catch (ClassNotFoundException | NoSuchMethodException e) {
            getClient = textRecognitionClass.getMethod("getClient", optionsClass);
        }
        Object recognizer = getClient.invoke(null, defaultOptions);

        Method process = recognizer.getClass().getMethod("process", inputImageClass);
        Object task = process.invoke(recognizer, inputImage);

        Class<?> tasksClass = Class.forName("com.google.android.gms.tasks.Tasks");
        Method await = tasksClass.getMethod("await", Class.forName("com.google.android.gms.tasks.Task"));
        Object visionText = await.invoke(null, task);

        String fullText = (String) visionText.getClass().getMethod("getText").invoke(visionText);
        List textBlocks = (List) visionText.getClass().getMethod("getTextBlocks").invoke(visionText);

        WritableArray blocks = Arguments.createArray();
        if (textBlocks != null) {
            for (Object block : textBlocks) {
                WritableMap blockMap = Arguments.createMap();
                String blockText = (String) block.getClass().getMethod("getText").invoke(block);
                blockMap.putString("text", blockText != null ? blockText : "");
                Object box = block.getClass().getMethod("getBoundingBox").invoke(block);
                if (box != null) {
                    android.graphics.Rect rect = (android.graphics.Rect) box;
                    blockMap.putString("rect",
                        rect.left + "," + rect.top + "," + rect.right + "," + rect.bottom);
                } else {
                    blockMap.putString("rect", "");
                }
                blocks.pushMap(blockMap);
            }
        }

        try {
            recognizer.getClass().getMethod("close").invoke(recognizer);
        } catch (Exception ignored) {}

        WritableMap result = Arguments.createMap();
        result.putString("text", fullText != null ? fullText : "");
        result.putArray("blocks", blocks);
        result.putString("engine", "mlkit");
        return result;
    }

    private void recycleBitmap(Bitmap bitmap) {
        if (bitmap != null && !bitmap.isRecycled()) {
            bitmap.recycle();
        }
    }

    private void closeDoc(io.legere.pdfiumandroid.PdfDocument doc) {
        if (doc != null) {
            try {
                doc.close();
            } catch (Exception ignored) {}
        }
    }

    private void closeQuietly(ParcelFileDescriptor pfd) {
        if (pfd != null) {
            try {
                pfd.close();
            } catch (IOException ignored) {}
        }
    }

    @Override
    public void onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy();
        if (executor != null && !executor.isShutdown()) {
            executor.shutdownNow();
        }
    }
}
