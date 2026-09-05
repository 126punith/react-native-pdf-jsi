/**
 * Copyright (c) 2025-present, Punith M (punithm300@gmail.com)
 * Streaming PDF Processor for Large File Operations
 * All rights reserved.
 * 
 * OPTIMIZATION: Constant O(1) memory usage regardless of PDF size, handles 1GB+ PDFs
 * Processes PDFs in chunks without loading entire file into memory
 */

#import <Foundation/Foundation.h>

@interface CompressionResult : NSObject
@property (nonatomic, assign) unsigned long long originalSize;
@property (nonatomic, assign) unsigned long long compressedSize;
@property (nonatomic, assign) NSTimeInterval durationMs;
@property (nonatomic, assign) double compressionRatio;
@property (nonatomic, assign) double spaceSavedPercent;
@end

@interface CopyResult : NSObject
@property (nonatomic, assign) unsigned long long bytesCopied;
@property (nonatomic, assign) NSTimeInterval durationMs;
@property (nonatomic, assign) double throughputMBps;
@end

@interface ExtractionResult : NSObject
@property (nonatomic, assign) unsigned long long bytesExtracted;
@property (nonatomic, assign) NSTimeInterval durationMs;
@property (nonatomic, assign) NSUInteger pagesExtracted;
@end

@interface StreamingPDFProcessor : NSObject

+ (instancetype)sharedInstance;

/**
 * PDF-aware compression: rasterize pages at a level-scaled resolution, JPEG-encode,
 * and rebuild a valid PDF (#36). Level 0 copies unchanged. Falls back to copy if not smaller.
 * @param inputPath Input PDF file path
 * @param outputPath Output compressed file path
 * @param compressionLevel Compression level (0-9, 9 is best / smallest)
 * @return CompressionResult or nil if operation fails
 */
- (CompressionResult *)compressPDFStreaming:(NSString *)inputPath
                                  outputPath:(NSString *)outputPath
                            compressionLevel:(int)compressionLevel
                                       error:(NSError **)error;

/**
 * Stream PDF copy without loading entire file
 * @param sourcePath Source PDF path
 * @param destPath Destination PDF path
 * @return CopyResult or nil if operation fails
 */
- (CopyResult *)copyPDFStreaming:(NSString *)sourcePath
                         destPath:(NSString *)destPath
                            error:(NSError **)error;

/**
 * Extract pages streaming (without loading full PDF)
 * @param sourcePath Source PDF path
 * @param outputPath Output PDF path
 * @param startPage Start page (0-indexed)
 * @param endPage End page (0-indexed)
 * @return ExtractionResult or nil if operation fails
 */
- (ExtractionResult *)extractPagesStreaming:(NSString *)sourcePath
                                  outputPath:(NSString *)outputPath
                                   startPage:(int)startPage
                                     endPage:(int)endPage
                                       error:(NSError **)error;

/**
 * Get chunk size used for streaming
 * @return Chunk size in bytes
 */
+ (NSUInteger)getChunkSize;

/**
 * Calculate optimal chunk size based on available memory
 * @param availableMemoryMB Available memory in MB
 * @return Optimal chunk size in bytes
 */
+ (NSUInteger)calculateOptimalChunkSize:(NSUInteger)availableMemoryMB;

@end

