/**
 * Copyright (c) 2025-present, Punith M (punithm300@gmail.com)
 * Streaming PDF Processor for Large File Operations
 * 
 * OPTIMIZATION: Constant O(1) memory usage regardless of PDF size, handles 1GB+ PDFs
 * Processes PDFs in chunks without loading entire file into memory
 */

package org.wonday.pdf;

import android.util.Log;

import java.io.*;

public class StreamingPDFProcessor {
    private static final String TAG = "StreamingPDFProcessor";
    private static final int CHUNK_SIZE = 1024 * 1024; // 1MB chunks
    private static final int BUFFER_SIZE = 8192; // 8KB buffer for I/O
    
    /**
     * Writes a valid PDF to {@code outputFile} using a streaming copy.
     * Whole-file zlib is not PDF-safe (produces a zlib stream, not a PDF); see #26.
     *
     * @param compressionLevel ignored (kept for API compatibility)
     */
    public CompressionResult compressPDFStreaming(File inputFile, File outputFile,
                                                   int compressionLevel) throws IOException {
        Log.d(TAG, String.format(
            "compressPDFStreaming: streaming copy (valid PDF); zlib whole-file not supported: %s -> %s (level %d ignored)",
            inputFile.getName(), outputFile.getName(), compressionLevel));
        CopyResult copy = copyPDFStreaming(inputFile, outputFile);
        return new CompressionResult(
            copy.bytesCopied,
            copy.bytesCopied,
            copy.durationMs,
            1.0
        );
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

