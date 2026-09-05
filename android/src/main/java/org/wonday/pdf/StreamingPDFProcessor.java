/**
 * Copyright (c) 2025-present, Punith M (punithm300@gmail.com)
 * Streaming PDF Processor for Large File Operations
 * 
 * OPTIMIZATION: Constant O(1) memory usage regardless of PDF size, handles 1GB+ PDFs
 * Processes PDFs in chunks without loading entire file into memory
 */

package org.wonday.pdf;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.pdf.PdfDocument;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;
import android.util.Log;

import java.io.*;

public class StreamingPDFProcessor {
    private static final String TAG = "StreamingPDFProcessor";
    private static final int CHUNK_SIZE = 1024 * 1024; // 1MB chunks
    private static final int BUFFER_SIZE = 8192; // 8KB buffer for I/O
    
    /**
     * PDF-aware compression: rasterize each page at a level-scaled resolution,
     * JPEG-encode, and rebuild a valid PDF (#36). Level 0 copies unchanged.
     * If recompression is not smaller than the original, falls back to a copy.
     *
     * @param compressionLevel 0–9 (higher = smaller / lower quality)
     */
    public CompressionResult compressPDFStreaming(File inputFile, File outputFile,
                                                   int compressionLevel) throws IOException {
        long startTime = System.currentTimeMillis();
        long originalSize = inputFile.length();
        int level = Math.max(0, Math.min(9, compressionLevel));

        if (level == 0) {
            Log.d(TAG, "compressPDFStreaming: level 0 — streaming copy (no recompression)");
            CopyResult copy = copyPDFStreaming(inputFile, outputFile);
            return new CompressionResult(originalSize, copy.bytesCopied, copy.durationMs, 1.0);
        }

        float scale = 1.0f - (level / 9.0f) * 0.55f;          // 1.0 → ~0.45
        int jpegQuality = Math.round(92f - (level / 9.0f) * 57f); // 92 → ~35

        Log.d(TAG, String.format(
            "compressPDFStreaming: PDF-aware recompress level=%d scale=%.2f jpeg=%d: %s -> %s",
            level, scale, jpegQuality, inputFile.getName(), outputFile.getName()));

        File tempFile = new File(outputFile.getParent(),
            ".tmp_compress_" + System.currentTimeMillis() + "_" + outputFile.getName());

        try {
            recompressPdfPages(inputFile, tempFile, scale, jpegQuality);

            long compressedSize = tempFile.length();
            if (compressedSize <= 0 || compressedSize >= originalSize) {
                Log.d(TAG, String.format(
                    "compressPDFStreaming: recompress not smaller (%d >= %d) — falling back to copy",
                    compressedSize, originalSize));
                if (tempFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    tempFile.delete();
                }
                CopyResult copy = copyPDFStreaming(inputFile, outputFile);
                long duration = System.currentTimeMillis() - startTime;
                return new CompressionResult(originalSize, copy.bytesCopied, duration, 1.0);
            }

            if (outputFile.exists()) {
                //noinspection ResultOfMethodCallIgnored
                outputFile.delete();
            }
            if (!tempFile.renameTo(outputFile)) {
                copyPDFStreaming(tempFile, outputFile);
                //noinspection ResultOfMethodCallIgnored
                tempFile.delete();
            }

            long duration = System.currentTimeMillis() - startTime;
            double ratio = originalSize > 0 ? (double) compressedSize / (double) originalSize : 1.0;
            Log.d(TAG, String.format(
                "compressPDFStreaming: done %d -> %d bytes (%.1f%% saved) in %dms",
                originalSize, compressedSize, (1.0 - ratio) * 100.0, duration));
            return new CompressionResult(originalSize, compressedSize, duration, ratio);
        } catch (Exception e) {
            if (tempFile.exists()) {
                //noinspection ResultOfMethodCallIgnored
                tempFile.delete();
            }
            Log.e(TAG, "PDF-aware compression failed, falling back to copy", e);
            CopyResult copy = copyPDFStreaming(inputFile, outputFile);
            long duration = System.currentTimeMillis() - startTime;
            return new CompressionResult(originalSize, copy.bytesCopied, duration, 1.0);
        }
    }

    /**
     * Rebuild PDF by rendering each page to a downsampled JPEG-backed bitmap.
     * Processes one page at a time to keep peak memory bounded.
     */
    private void recompressPdfPages(File inputFile, File outputFile,
                                    float scale, int jpegQuality) throws IOException {
        PdfDocument outDoc = new PdfDocument();
        try (ParcelFileDescriptor fd = ParcelFileDescriptor.open(inputFile, ParcelFileDescriptor.MODE_READ_ONLY);
             PdfRenderer renderer = new PdfRenderer(fd)) {

            int pageCount = renderer.getPageCount();
            for (int i = 0; i < pageCount; i++) {
                PdfRenderer.Page page = renderer.openPage(i);
                try {
                    int pageWidth = Math.max(1, page.getWidth());
                    int pageHeight = Math.max(1, page.getHeight());
                    int renderW = Math.max(1, Math.round(pageWidth * scale));
                    int renderH = Math.max(1, Math.round(pageHeight * scale));

                    Bitmap bitmap = Bitmap.createBitmap(renderW, renderH, Bitmap.Config.ARGB_8888);
                    Canvas renderCanvas = new Canvas(bitmap);
                    renderCanvas.drawColor(Color.WHITE);
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);

                    ByteArrayOutputStream jpegStream = new ByteArrayOutputStream();
                    if (!bitmap.compress(Bitmap.CompressFormat.JPEG, jpegQuality, jpegStream)) {
                        bitmap.recycle();
                        throw new IOException("JPEG compress failed for page " + i);
                    }
                    bitmap.recycle();

                    byte[] jpegBytes = jpegStream.toByteArray();
                    Bitmap jpegBitmap = BitmapFactory.decodeByteArray(jpegBytes, 0, jpegBytes.length);
                    if (jpegBitmap == null) {
                        throw new IOException("Failed to decode JPEG for page " + i);
                    }

                    PdfDocument.PageInfo pageInfo = new PdfDocument.PageInfo.Builder(
                        pageWidth, pageHeight, i + 1
                    ).create();
                    PdfDocument.Page outPage = outDoc.startPage(pageInfo);
                    outPage.getCanvas().drawBitmap(
                        jpegBitmap,
                        null,
                        new Rect(0, 0, pageWidth, pageHeight),
                        null
                    );
                    outDoc.finishPage(outPage);
                    jpegBitmap.recycle();
                } finally {
                    page.close();
                }
            }
        }

        try (FileOutputStream fos = new FileOutputStream(outputFile)) {
            outDoc.writeTo(fos);
        } finally {
            outDoc.close();
        }
    }
    
    /**
     * Stream PDF copy without loading entire file
     * @param sourceFile Source PDF
     * @param destFile Destination PDF
     * @return Copy statistics
     * @throws IOException if operation fails
     */
    public CopyResult copyPDFStreaming(File sourceFile, File destFile) throws IOException {
        long startTime = System.currentTimeMillis();
        long bytesCopied = 0;
        
        Log.d(TAG, String.format("Starting streaming copy: %s -> %s",
            sourceFile.getName(), destFile.getName()));
        
        try (FileInputStream fis = new FileInputStream(sourceFile);
             FileOutputStream fos = new FileOutputStream(destFile);
             BufferedInputStream bis = new BufferedInputStream(fis, BUFFER_SIZE);
             BufferedOutputStream bos = new BufferedOutputStream(fos, BUFFER_SIZE)) {
            
            byte[] buffer = new byte[CHUNK_SIZE];
            int bytesInChunk;
            
            while ((bytesInChunk = bis.read(buffer)) != -1) {
                bos.write(buffer, 0, bytesInChunk);
                bytesCopied += bytesInChunk;
            }
            
            bos.flush();
            
            long duration = System.currentTimeMillis() - startTime;
            double throughputMBps = duration > 0 ? (bytesCopied / (1024.0 * 1024.0)) / (duration / 1000.0) : 0;
            
            Log.d(TAG, String.format(
                "Streaming copy complete: %d MB in %dms (%.1f MB/s)",
                bytesCopied / (1024 * 1024),
                duration,
                throughputMBps
            ));
            
            return new CopyResult(bytesCopied, duration, throughputMBps);
            
        } catch (IOException e) {
            Log.e(TAG, "Error in streaming copy", e);
            throw e;
        }
    }
    
    /**
     * Extract pages streaming (without loading full PDF)
     * Note: This is a simplified version - real implementation would need PDF parsing
     * @param sourceFile Source PDF
     * @param outputFile Output PDF
     * @param startPage Start page (0-indexed)
     * @param endPage End page (0-indexed)
     * @return Extraction result
     * @throws IOException if operation fails
     */
    public ExtractionResult extractPagesStreaming(File sourceFile, File outputFile,
                                                   int startPage, int endPage) throws IOException {
        long startTime = System.currentTimeMillis();
        
        Log.d(TAG, String.format("Starting streaming page extraction: pages %d-%d",
            startPage, endPage));
        
        // For now, use simple copy as placeholder
        // Real implementation would parse PDF structure and extract specific pages
        CopyResult copyResult = copyPDFStreaming(sourceFile, outputFile);
        
        long duration = System.currentTimeMillis() - startTime;
        
        Log.d(TAG, String.format("Page extraction complete in %dms", duration));
        
        return new ExtractionResult(
            copyResult.bytesCopied,
            duration,
            endPage - startPage + 1
        );
    }
    
    /**
     * Result class for compression operations
     */
    public static class CompressionResult {
        public final long originalSize;
        public final long compressedSize;
        public final long durationMs;
        public final double compressionRatio;
        public final double spaceSavedPercent;
        
        public CompressionResult(long originalSize, long compressedSize, 
                                long durationMs, double compressionRatio) {
            this.originalSize = originalSize;
            this.compressedSize = compressedSize;
            this.durationMs = durationMs;
            this.compressionRatio = compressionRatio;
            this.spaceSavedPercent = (1.0 - compressionRatio) * 100;
        }
        
        @Override
        public String toString() {
            return String.format(
                "Compression: %d MB -> %d MB (%.1f%% saved) in %dms",
                originalSize / (1024 * 1024),
                compressedSize / (1024 * 1024),
                spaceSavedPercent,
                durationMs
            );
        }
    }
    
    /**
     * Result class for copy operations
     */
    public static class CopyResult {
        public final long bytesCopied;
        public final long durationMs;
        public final double throughputMBps;
        
        public CopyResult(long bytesCopied, long durationMs, double throughputMBps) {
            this.bytesCopied = bytesCopied;
            this.durationMs = durationMs;
            this.throughputMBps = throughputMBps;
        }
        
        @Override
        public String toString() {
            return String.format(
                "Copy: %d MB in %dms (%.1f MB/s)",
                bytesCopied / (1024 * 1024),
                durationMs,
                throughputMBps
            );
        }
    }
    
    /**
     * Result class for extraction operations
     */
    public static class ExtractionResult {
        public final long bytesExtracted;
        public final long durationMs;
        public final int pagesExtracted;
        
        public ExtractionResult(long bytesExtracted, long durationMs, int pagesExtracted) {
            this.bytesExtracted = bytesExtracted;
            this.durationMs = durationMs;
            this.pagesExtracted = pagesExtracted;
        }
        
        @Override
        public String toString() {
            return String.format(
                "Extraction: %d pages, %d MB in %dms",
                pagesExtracted,
                bytesExtracted / (1024 * 1024),
                durationMs
            );
        }
    }
    
    /**
     * Get chunk size used for streaming
     * @return Chunk size in bytes
     */
    public static int getChunkSize() {
        return CHUNK_SIZE;
    }
    
    /**
     * Calculate optimal chunk size based on available memory
     * @param availableMemoryMB Available memory in MB
     * @return Optimal chunk size in bytes
     */
    public static int calculateOptimalChunkSize(long availableMemoryMB) {
        // Use 10% of available memory or default chunk size, whichever is smaller
        long optimalSize = Math.min(
            (availableMemoryMB * 1024 * 1024) / 10,
            CHUNK_SIZE
        );
        
        // Ensure minimum chunk size of 256KB
        return (int) Math.max(optimalSize, 256 * 1024);
    }
}

