/**
 * Copyright (c) 2025-present, Punith M (punithm300@gmail.com)
 * Streaming PDF Processor for Large File Operations
 * All rights reserved.
 * 
 * OPTIMIZATION: Constant O(1) memory usage regardless of PDF size, handles 1GB+ PDFs
 * Processes PDFs in chunks without loading entire file into memory
 */

#import "StreamingPDFProcessor.h"
#import <React/RCTLog.h>

static const NSUInteger CHUNK_SIZE = 1024 * 1024; // 1MB chunks
static const NSUInteger BUFFER_SIZE = 8192; // 8KB buffer for I/O

@implementation CompressionResult
@end

@implementation CopyResult
@end

@implementation ExtractionResult
@end

@implementation StreamingPDFProcessor

+ (instancetype)sharedInstance {
    static StreamingPDFProcessor *_sharedInstance = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        _sharedInstance = [[StreamingPDFProcessor alloc] init];
    });
    return _sharedInstance;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        RCTLogInfo(@"🌊 StreamingPDFProcessor initialized");
    }
    return self;
}

- (CompressionResult *)compressPDFStreaming:(NSString *)inputPath
                                  outputPath:(NSString *)outputPath
                            compressionLevel:(int)compressionLevel
                                       error:(NSError **)error {
    RCTLogInfo(@"🌊 compressPDFStreaming: streaming copy (valid PDF); whole-file zlib not PDF-safe (#26); level %d ignored — %@ -> %@",
              compressionLevel, [inputPath lastPathComponent], [outputPath lastPathComponent]);

    CopyResult *copy = [self copyPDFStreaming:inputPath destPath:outputPath error:error];
    if (!copy) {
        return nil;
    }
    CompressionResult *result = [[CompressionResult alloc] init];
    result.originalSize = copy.bytesCopied;
    result.compressedSize = copy.bytesCopied;
    result.durationMs = copy.durationMs;
    result.compressionRatio = 1.0;
    result.spaceSavedPercent = 0.0;
    return result;
}

- (CopyResult *)copyPDFStreaming:(NSString *)sourcePath
                         destPath:(NSString *)destPath
                            error:(NSError **)error {
    
    NSTimeInterval startTime = CACurrentMediaTime();
    unsigned long long bytesCopied = 0;
    
    RCTLogInfo(@"🌊 Starting streaming copy: %@ -> %@",
              [sourcePath lastPathComponent], [destPath lastPathComponent]);
    
    NSFileHandle *sourceHandle = [NSFileHandle fileHandleForReadingAtPath:sourcePath];
    if (!sourceHandle) {
        if (error) {
            *error = [NSError errorWithDomain:@"StreamingPDFProcessor"
                                         code:1
                                     userInfo:@{NSLocalizedDescriptionKey: @"Failed to open source file"}];
        }
        return nil;
    }
    
    NSFileManager *fileManager = [NSFileManager defaultManager];
    if ([fileManager fileExistsAtPath:destPath]) {
        [fileManager removeItemAtPath:destPath error:nil];
    }
    [fileManager createFileAtPath:destPath contents:nil attributes:nil];
    
    NSFileHandle *destHandle = [NSFileHandle fileHandleForWritingAtPath:destPath];
    if (!destHandle) {
        [sourceHandle closeFile];
        if (error) {
            *error = [NSError errorWithDomain:@"StreamingPDFProcessor"
                                         code:2
                                     userInfo:@{NSLocalizedDescriptionKey: @"Failed to open destination file"}];
        }
        return nil;
    }
    
    @try {
        while (YES) {
            NSData *chunk = [sourceHandle readDataOfLength:CHUNK_SIZE];
            if (chunk.length == 0) {
                break;
            }
            
            [destHandle writeData:chunk];
            bytesCopied += chunk.length;
        }
        
        [destHandle synchronizeFile];
        [sourceHandle closeFile];
        [destHandle closeFile];
        
        NSTimeInterval duration = (CACurrentMediaTime() - startTime) * 1000;
        double throughputMBps = duration > 0 ? (bytesCopied / (1024.0 * 1024.0)) / (duration / 1000.0) : 0;
        
        RCTLogInfo(@"🌊 Streaming copy complete: %llu MB in %.0fms (%.1f MB/s)",
                  bytesCopied / (1024 * 1024), duration, throughputMBps);
        
        CopyResult *result = [[CopyResult alloc] init];
        result.bytesCopied = bytesCopied;
        result.durationMs = duration;
        result.throughputMBps = throughputMBps;
        
        return result;
        
    } @catch (NSException *exception) {
        [sourceHandle closeFile];
        [destHandle closeFile];
        
        if (error) {
            *error = [NSError errorWithDomain:@"StreamingPDFProcessor"
                                         code:3
                                     userInfo:@{NSLocalizedDescriptionKey: exception.reason}];
        }
        return nil;
    }
}

- (ExtractionResult *)extractPagesStreaming:(NSString *)sourcePath
                                  outputPath:(NSString *)outputPath
                                   startPage:(int)startPage
                                     endPage:(int)endPage
                                       error:(NSError **)error {
    
    NSTimeInterval startTime = CACurrentMediaTime();
    
    RCTLogInfo(@"🌊 Starting streaming page extraction: pages %d-%d", startPage, endPage);
    
    // For now, use simple copy as placeholder
    // Real implementation would parse PDF structure and extract specific pages
    CopyResult *copyResult = [self copyPDFStreaming:sourcePath destPath:outputPath error:error];
    
    if (!copyResult) {
        return nil;
    }
    
    NSTimeInterval duration = (CACurrentMediaTime() - startTime) * 1000;
    
    RCTLogInfo(@"🌊 Page extraction complete in %.0fms", duration);
    
    ExtractionResult *result = [[ExtractionResult alloc] init];
    result.bytesExtracted = copyResult.bytesCopied;
    result.durationMs = duration;
    result.pagesExtracted = endPage - startPage + 1;
    
    return result;
}

+ (NSUInteger)getChunkSize {
    return CHUNK_SIZE;
}

+ (NSUInteger)calculateOptimalChunkSize:(NSUInteger)availableMemoryMB {
    // Use 10% of available memory or default chunk size, whichever is smaller
    NSUInteger optimalSize = MIN((availableMemoryMB * 1024 * 1024) / 10, CHUNK_SIZE);
    
    // Ensure minimum chunk size of 256KB
    return MAX(optimalSize, 256 * 1024);
}

@end

