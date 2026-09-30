package org.wonday.pdf;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.pdf.PdfDocument;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

import io.legere.pdfiumandroid.PdfPage;
import io.legere.pdfiumandroid.PdfTextPage;
import io.legere.pdfiumandroid.PdfiumCore;

/**
 * Synchronous PDF operations for the Nitro hybrid. File paths only.
 */
public final class PDFNitroOps {
    private static final String TAG = "PDFNitroOps";

    private PDFNitroOps() {}

    public static String pageMetrics(String pdfId, int pageNumber) {
        String path = SearchRegistry.getPath(pdfId);
        if (path == null || path.isEmpty()) {
            return error("No PDF path registered for " + pdfId);
        }
        return pageSize(normalize(path), Math.max(0, pageNumber - 1));
    }

    public static String renderPage(String pdfId, int pageNumber, float scale) {
        String path = SearchRegistry.getPath(pdfId);
        if (path == null || path.isEmpty()) {
            return error("No PDF path registered for " + pdfId);
        }
        float safeScale = scale > 0 ? scale : 1f;
        ParcelFileDescriptor pfd = null;
        try {
            File file = requireFile(normalize(path));
            pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
            try (PdfRenderer renderer = new PdfRenderer(pfd)) {
                pfd = null;
                int index = Math.max(0, pageNumber - 1);
                if (index >= renderer.getPageCount()) {
                    return error("Page out of range: " + pageNumber);
                }
                PdfRenderer.Page page = renderer.openPage(index);
                try {
                    int width = Math.max(1, Math.round(page.getWidth() * safeScale));
                    int height = Math.max(1, Math.round(page.getHeight() * safeScale));
                    Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
                    try {
                        Canvas canvas = new Canvas(bitmap);
                        canvas.drawColor(Color.WHITE);
                        long started = System.nanoTime();
                        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                        double renderTimeMs = (System.nanoTime() - started) / 1_000_000.0;
                        return width + "|" + height + "|" + renderTimeMs;
                    } finally {
                        bitmap.recycle();
                    }
                } finally {
                    page.close();
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "renderPage failed", e);
            return error(e.getMessage());
        } finally {
            closeQuietly(pfd);
        }
    }

    public static String pageCount(String filePath) {
        ParcelFileDescriptor pfd = null;
        try {
            File file = requireFile(normalize(filePath));
            pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
            try (PdfRenderer renderer = new PdfRenderer(pfd)) {
                pfd = null;
                return Integer.toString(renderer.getPageCount());
            }
        } catch (Exception e) {
            Log.e(TAG, "pageCount failed", e);
            return error(e.getMessage());
        } finally {
            closeQuietly(pfd);
        }
    }

    public static String pageSize(String filePath, int pageIndex) {
        ParcelFileDescriptor pfd = null;
        io.legere.pdfiumandroid.PdfDocument doc = null;
        try {
            File file = requireFile(normalize(filePath));
            pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
            PdfiumCore core = new PdfiumCore();
            doc = core.newDocument(pfd);
            pfd = null;
            if (pageIndex < 0 || pageIndex >= doc.getPageCount()) {
                return error("Page index out of range: " + pageIndex);
            }
            PdfPage page = doc.openPage(pageIndex);
            try {
                int rotation = 0;
                try {
                    Object value = page.getClass().getMethod("getPageRotation").invoke(page);
                    if (value instanceof Number) {
                        rotation = ((Number) value).intValue();
                    }
                } catch (Throwable ignored) {
                    rotation = 0;
                }
                return page.getPageWidthPoint() + "|" + page.getPageHeightPoint() + "|" + rotation;
            } finally {
                page.close();
            }
        } catch (Exception e) {
            Log.e(TAG, "pageSize failed", e);
            return error(e.getMessage());
        } finally {
            closeDoc(doc);
            closeQuietly(pfd);
        }
    }

    public static String textFromPage(String filePath, int pageIndex) {
        ParcelFileDescriptor pfd = null;
        io.legere.pdfiumandroid.PdfDocument doc = null;
        try {
            doc = openPdfium(normalize(filePath));
            pfd = null;
            return textOnPage(doc, pageIndex);
        } catch (Exception e) {
            Log.e(TAG, "textFromPage failed", e);
            return error(e.getMessage());
        } finally {
            closeDoc(doc);
            closeQuietly(pfd);
        }
    }

    public static String textFromPages(String filePath, String pageIndicesJson) {
        io.legere.pdfiumandroid.PdfDocument doc = null;
        try {
            doc = openPdfium(normalize(filePath));
            JSONArray indices = new JSONArray(pageIndicesJson == null ? "[]" : pageIndicesJson);
            JSONObject out = new JSONObject();
            for (int i = 0; i < indices.length(); i++) {
                int pageIndex = indices.getInt(i);
                String text = pageIndex < 0 || pageIndex >= doc.getPageCount()
                    ? ""
                    : textOnPage(doc, pageIndex);
                out.put(String.valueOf(pageIndex), text);
            }
            return out.toString();
        } catch (Exception e) {
            Log.e(TAG, "textFromPages failed", e);
            return error(e.getMessage());
        } finally {
            closeDoc(doc);
        }
    }

    public static String allText(String filePath) {
        io.legere.pdfiumandroid.PdfDocument doc = null;
        try {
            doc = openPdfium(normalize(filePath));
            JSONObject out = new JSONObject();
            int count = doc.getPageCount();
            for (int i = 0; i < count; i++) {
                out.put(String.valueOf(i), textOnPage(doc, i));
            }
            return out.toString();
        } catch (Exception e) {
            Log.e(TAG, "allText failed", e);
            return error(e.getMessage());
        } finally {
            closeDoc(doc);
        }
    }

    public static String exportPageToImage(String filePath, int pageIndex, float scale) {
        try {
            File file = requireFile(normalize(filePath));
            String output = renderPageFile(file, pageIndex, scale, file.getParentFile());
            return output;
        } catch (Exception e) {
            Log.e(TAG, "exportPageToImage failed", e);
            return error(e.getMessage());
        }
    }

    public static String exportToImages(String filePath, float scale) {
        ParcelFileDescriptor pfd = null;
        try {
            File file = requireFile(normalize(filePath));
            pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
            int count;
            try (PdfRenderer renderer = new PdfRenderer(pfd)) {
                pfd = null;
                count = renderer.getPageCount();
            }
            JSONArray paths = new JSONArray();
            for (int i = 0; i < count; i++) {
                paths.put(renderPageFile(file, i, scale, file.getParentFile()));
            }
            return paths.toString();
        } catch (Exception e) {
            Log.e(TAG, "exportToImages failed", e);
            return error(e.getMessage());
        } finally {
            closeQuietly(pfd);
        }
    }

    public static String mergePdfs(String filePathsJson, String outputPath) {
        PdfDocument merged = new PdfDocument();
        try {
            JSONArray paths = new JSONArray(filePathsJson == null ? "[]" : filePathsJson);
            if (paths.length() < 2) {
                return error("At least 2 PDF files are required for merging");
            }
            int pageNumber = 0;
            for (int i = 0; i < paths.length(); i++) {
                File file = requireFile(normalize(paths.getString(i)));
                try (ParcelFileDescriptor pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
                     PdfRenderer renderer = new PdfRenderer(pfd)) {
                    for (int pageIndex = 0; pageIndex < renderer.getPageCount(); pageIndex++) {
                        PdfRenderer.Page page = renderer.openPage(pageIndex);
                        try {
                            copyRenderedPage(merged, page, pageNumber);
                            pageNumber++;
                        } finally {
                            page.close();
                        }
                    }
                }
            }
            File output = outputFile(outputPath, new File(normalize(paths.getString(0))).getParentFile(), "merged");
            writePdf(merged, output);
            return output.getAbsolutePath();
        } catch (Exception e) {
            Log.e(TAG, "mergePdfs failed", e);
            return error(e.getMessage());
        } finally {
            merged.close();
        }
    }

    public static String splitPdf(String filePath, String pageRangesJson, String outputDir) {
        try {
            File file = requireFile(normalize(filePath));
            File dir = outputDir == null || outputDir.isEmpty()
                ? file.getParentFile()
                : new File(outputDir);
            if (dir != null && !dir.exists()) {
                dir.mkdirs();
            }
            JSONArray ranges = new JSONArray(pageRangesJson == null ? "[]" : pageRangesJson);
            JSONArray outputs = new JSONArray();
            for (int i = 0; i < ranges.length(); i++) {
                JSONArray range = ranges.getJSONArray(i);
                int start = range.getInt(0);
                int end = range.length() > 1 ? range.getInt(1) : start;
                File output = new File(dir, "split-" + start + "-" + end + ".pdf");
                writePageRange(file, start, end, output);
                outputs.put(output.getAbsolutePath());
            }
            return outputs.toString();
        } catch (Exception e) {
            Log.e(TAG, "splitPdf failed", e);
            return error(e.getMessage());
        }
    }

    public static String extractPages(String filePath, String pageNumbersJson, String outputPath) {
        try {
            File file = requireFile(normalize(filePath));
            JSONArray pages = new JSONArray(pageNumbersJson == null ? "[]" : pageNumbersJson);
            PdfDocument extracted = new PdfDocument();
            try (ParcelFileDescriptor pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
                 PdfRenderer renderer = new PdfRenderer(pfd)) {
                int written = 0;
                for (int i = 0; i < pages.length(); i++) {
                    int pageIndex = pages.getInt(i);
                    if (pageIndex < 0 || pageIndex >= renderer.getPageCount()) {
                        continue;
                    }
                    PdfRenderer.Page page = renderer.openPage(pageIndex);
                    try {
                        copyRenderedPage(extracted, page, written);
                        written++;
                    } finally {
                        page.close();
                    }
                }
            }
            File output = outputFile(outputPath, file.getParentFile(), "extract");
            try {
                writePdf(extracted, output);
            } finally {
                extracted.close();
            }
            return output.getAbsolutePath();
        } catch (Exception e) {
            Log.e(TAG, "extractPages failed", e);
            return error(e.getMessage());
        }
    }

    public static boolean rotatePage(String filePath, int pageNumber, int degrees) {
        Log.w(TAG, "rotatePage is not implemented for " + filePath + " page " + pageNumber + " by " + degrees);
        return false;
    }

    public static boolean deletePage(String filePath, int pageNumber) {
        Log.w(TAG, "deletePage is not implemented for " + filePath + " page " + pageNumber);
        return false;
    }

    public static String compressPdf(String inputPath, String outputPath, int compressionLevel) {
        try {
            File input = requireFile(normalize(inputPath));
            File output = outputFile(outputPath, input.getParentFile(), "compressed");
            File parent = output.getParentFile();
            if (parent != null && !parent.exists()) {
                parent.mkdirs();
            }
            StreamingPDFProcessor processor = new StreamingPDFProcessor();
            StreamingPDFProcessor.CompressionResult result = processor.compressPDFStreaming(
                input,
                output,
                compressionLevel
            );
            JSONObject json = new JSONObject();
            json.put("success", true);
            json.put("originalSize", result.originalSize);
            json.put("compressedSize", result.compressedSize);
            json.put("durationMs", result.durationMs);
            json.put("compressionRatio", result.compressionRatio);
            json.put("spaceSavedPercent", result.spaceSavedPercent);
            json.put("outputPath", output.getAbsolutePath());
            return json.toString();
        } catch (Exception e) {
            Log.e(TAG, "compressPdf failed", e);
            return error(e.getMessage());
        }
    }

    private static io.legere.pdfiumandroid.PdfDocument openPdfium(String path) throws IOException {
        File file = requireFile(path);
        ParcelFileDescriptor pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
        PdfiumCore core = new PdfiumCore();
        return core.newDocument(pfd);
    }

    private static String textOnPage(io.legere.pdfiumandroid.PdfDocument doc, int pageIndex) {
        if (pageIndex < 0 || pageIndex >= doc.getPageCount()) {
            return "";
        }
        PdfPage page = doc.openPage(pageIndex);
        if (page == null) {
            return "";
        }
        try {
            PdfTextPage textPage = page.openTextPage();
            if (textPage == null) {
                return "";
            }
            try {
                int chars = textPage.textPageCountChars();
                if (chars <= 0) {
                    return "";
                }
                String text = textPage.textPageGetText(0, chars);
                return text != null ? text : "";
            } finally {
                textPage.close();
            }
        } catch (Exception e) {
            return "";
        } finally {
            page.close();
        }
    }

    private static String renderPageFile(File pdfFile, int pageIndex, float scale, File directory) throws IOException {
        float safeScale = scale > 0 ? scale : 1f;
        try (ParcelFileDescriptor pfd = ParcelFileDescriptor.open(pdfFile, ParcelFileDescriptor.MODE_READ_ONLY);
             PdfRenderer renderer = new PdfRenderer(pfd)) {
            if (pageIndex < 0 || pageIndex >= renderer.getPageCount()) {
                throw new IOException("Page index out of range: " + pageIndex);
            }
            PdfRenderer.Page page = renderer.openPage(pageIndex);
            Bitmap bitmap = null;
            try {
                int width = Math.max(1, Math.round(page.getWidth() * safeScale));
                int height = Math.max(1, Math.round(page.getHeight() * safeScale));
                bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
                Canvas canvas = new Canvas(bitmap);
                canvas.drawColor(Color.WHITE);
                page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                File output = new File(directory, pdfFile.getName() + "-page-" + pageIndex + ".jpg");
                try (FileOutputStream stream = new FileOutputStream(output)) {
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 90, stream);
                }
                return output.getAbsolutePath();
            } finally {
                if (bitmap != null) {
                    bitmap.recycle();
                }
                page.close();
            }
        }
    }

    private static void writePageRange(File source, int start, int end, File output) throws IOException {
        PdfDocument doc = new PdfDocument();
        try (ParcelFileDescriptor pfd = ParcelFileDescriptor.open(source, ParcelFileDescriptor.MODE_READ_ONLY);
             PdfRenderer renderer = new PdfRenderer(pfd)) {
            int written = 0;
            int last = Math.min(end, renderer.getPageCount() - 1);
            for (int pageIndex = Math.max(0, start); pageIndex <= last; pageIndex++) {
                PdfRenderer.Page page = renderer.openPage(pageIndex);
                try {
                    copyRenderedPage(doc, page, written);
                    written++;
                } finally {
                    page.close();
                }
            }
            writePdf(doc, output);
        } finally {
            doc.close();
        }
    }

    private static void copyRenderedPage(PdfDocument destination, PdfRenderer.Page page, int pageNumber) {
        PdfDocument.PageInfo info = new PdfDocument.PageInfo.Builder(
            page.getWidth(),
            page.getHeight(),
            pageNumber + 1
        ).create();
        PdfDocument.Page destPage = destination.startPage(info);
        Bitmap bitmap = Bitmap.createBitmap(page.getWidth(), page.getHeight(), Bitmap.Config.ARGB_8888);
        try {
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT);
            destPage.getCanvas().drawBitmap(bitmap, 0, 0, null);
        } finally {
            bitmap.recycle();
            destination.finishPage(destPage);
        }
    }

    private static void writePdf(PdfDocument document, File output) throws IOException {
        File parent = output.getParentFile();
        if (parent != null && !parent.exists()) {
            parent.mkdirs();
        }
        try (FileOutputStream stream = new FileOutputStream(output)) {
            document.writeTo(stream);
        }
    }

    private static File outputFile(String outputPath, File directory, String prefix) {
        if (outputPath != null && !outputPath.isEmpty()) {
            return new File(normalize(outputPath));
        }
        return new File(directory, prefix + "-" + System.currentTimeMillis() + ".pdf");
    }

    private static File requireFile(String path) throws IOException {
        File file = new File(path);
        if (!file.exists() || !file.canRead()) {
            throw new IOException("PDF file not found or unreadable: " + path);
        }
        return file;
    }

    private static String normalize(String filePath) {
        if (filePath != null && filePath.startsWith("file://")) {
            return filePath.substring(7);
        }
        return filePath;
    }

    private static String error(String message) {
        return "ERR:" + (message == null ? "unknown" : message);
    }

    private static void closeDoc(io.legere.pdfiumandroid.PdfDocument doc) {
        if (doc != null) {
            try {
                doc.close();
            } catch (Exception ignored) {
            }
        }
    }

    private static void closeQuietly(ParcelFileDescriptor pfd) {
        if (pfd != null) {
            try {
                pfd.close();
            } catch (IOException ignored) {
            }
        }
    }
}
