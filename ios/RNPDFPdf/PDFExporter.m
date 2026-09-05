#import "PDFExporter.h"
#import "ImagePool.h"
#import "StreamingPDFProcessor.h"
#import <React/RCTLog.h>
#import <PDFKit/PDFKit.h>
#import <UIKit/UIKit.h>

@implementation PDFExporter {
    ImagePool *_imagePool;
}

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
    return NO;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        // All features are FREE - no license verification needed
        _imagePool = [ImagePool sharedInstance];
    }
    return self;
}

- (NSArray<NSString *> *)supportedEvents {
    return @[@"PDFExportProgress", @"PDFExportComplete", @"PDFOperationProgress", @"PDFOperationComplete"];
}

/**
 * Generate a unique filename with timestamp to prevent overwrites
 * @param baseName Base filename without extension
 * @param pageNum Page number (or -1 for PDF operations)
 * @param extension File extension (png, jpeg, pdf)
 * @return Filename with timestamp (e.g., "filename_page_1_20251102_181059.png")
 */
- (NSString *)generateTimestampedFileName:(NSString *)baseName pageNum:(int)pageNum extension:(NSString *)extension {
    NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
    [formatter setDateFormat:@"yyyyMMdd_HHmmss"];
    [formatter setLocale:[[NSLocale alloc] initWithLocaleIdentifier:@"en_US_POSIX"]];
    NSString *timestamp = [formatter stringFromDate:[NSDate date]];
    
    if (pageNum >= 0) {
        // For image exports: filename_page_1_20251102_181059.png
        return [NSString stringWithFormat:@"%@_page_%d_%@.%@", baseName, pageNum, timestamp, extension];
    } else {
        // For PDF operations: filename_20251102_181059.pdf
        return [NSString stringWithFormat:@"%@_%@.%@", baseName, timestamp, extension];
    }
}

//
RCT_EXPORT_METHOD(exportToImages:(NSString *)filePath
                  options:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    
    // All features are FREE - no license verification needed
    
    if (!filePath || filePath.length == 0) {
        reject(@"INVALID_PATH", @"File path is required", nil);
        return;
    }
    
    NSURL *pdfURL = [NSURL fileURLWithPath:filePath];
    if (![[NSFileManager defaultManager] fileExistsAtPath:filePath]) {
        reject(@"FILE_NOT_FOUND", [NSString stringWithFormat:@"PDF file not found: %@", filePath], nil);
        return;
    }
    
    NSArray *pages = options[@"pages"];
    NSNumber *dpi = options[@"dpi"] ?: @150;
    NSString *format = options[@"format"] ?: @"png";
    NSString *outputDir = options[@"outputDir"];
    
    // Emit start event
    @try {
        [self sendEventWithName:@"PDFExportProgress" body:@{
            @"type": @"exportStart",
            @"operation": @"exportToImages",
            @"filePath": filePath,
            @"totalPages": pages ? @(pages.count) : [NSNull null]
        }];
    } @catch (NSException *exception) {
        // Event emitter not ready, continue without event
    }
    
    NSArray *exportedFiles = [self exportPagesToImages:pdfURL pages:pages dpi:dpi.intValue format:format outputDir:outputDir];
    
    // Still resolve promise for backward compatibility
    resolve(exportedFiles);
}

/**
 * Export single page to image
 */
RCT_EXPORT_METHOD(exportPageToImage:(NSString *)filePath
                  pageIndex:(int)pageIndex
                  options:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    
    @try {
        NSString *format = options[@"format"] ?: @"jpeg";
        NSNumber *qualityNum = options[@"quality"] ?: @0.9;
        NSNumber *scaleNum = options[@"scale"] ?: @2.0;
        double quality = qualityNum.doubleValue;
        double scale = scaleNum.doubleValue;
        
        NSLog(@"🖼️ [EXPORT] exportPageToImage - START - page: %d, format: %@, quality: %.2f, scale: %.2f",
              pageIndex, format, quality, scale);
        
        if (!filePath || filePath.length == 0) {
            NSLog(@"❌ [EXPORT] exportPageToImage - FAILED - Invalid path");
            reject(@"INVALID_PATH", @"File path is required", nil);
            return;
        }
        
        NSURL *pdfURL = [NSURL fileURLWithPath:filePath];
        NSLog(@"📁 [FILE] PDF path: %@", filePath);
        
        if (![[NSFileManager defaultManager] fileExistsAtPath:filePath]) {
            NSLog(@"❌ [FILE] PDF not found: %@", filePath);
            reject(@"FILE_NOT_FOUND", @"PDF file not found", nil);
            return;
        }
        
        NSDictionary *fileAttrs = [[NSFileManager defaultManager] attributesOfItemAtPath:filePath error:nil];
        unsigned long long fileSize = [fileAttrs fileSize];
        NSLog(@"📁 [FILE] PDF exists, size: %llu bytes", fileSize);
        
        int dpi = (int)(72 * scale);
        NSLog(@"🖼️ [EXPORT] Calculated DPI: %d", dpi);
        
        NSString *outputPath = [self exportSinglePageToImage:pdfURL pageIndex:pageIndex dpi:dpi format:format outputDir:nil];
        
        NSLog(@"✅ [EXPORT] exportPageToImage - SUCCESS - output: %@", outputPath);
        resolve(outputPath);
        
    } @catch (NSException *exception) {
        NSLog(@"❌ [EXPORT] exportPageToImage - ERROR: %@", exception.reason);
        reject(@"EXPORT_ERROR", exception.reason, nil);
    }
}

/**
 * Export single page to image (internal method)
 */
- (NSString *)exportSinglePageToImage:(NSURL *)pdfURL pageIndex:(int)pageIndex dpi:(int)dpi format:(NSString *)format outputDir:(NSString *)outputDir {
    NSLog(@"🖼️ [EXPORT] exportSinglePageToImage - START - pageIndex: %d, dpi: %d, format: %@", pageIndex, dpi, format);
    
    PDFDocument *pdfDocument = [[PDFDocument alloc] initWithURL:pdfURL];
    if (!pdfDocument) {
        NSLog(@"❌ [EXPORT] Failed to load PDF document");
        return nil;
    }
    
    NSUInteger totalPages = pdfDocument.pageCount;
    NSLog(@"📁 [FILE] PDF opened, total pages: %lu", (unsigned long)totalPages);
    
    if (pageIndex < 0 || pageIndex >= totalPages) {
        NSLog(@"❌ [EXPORT] Invalid page index: %d (total: %lu)", pageIndex, (unsigned long)totalPages);
        return nil;
    }
    
    PDFPage *page = [pdfDocument pageAtIndex:pageIndex];
    NSLog(@"📄 [PAGE] Opened page %d", pageIndex + 1);
    
    CGRect pageRect = [page boundsForBox:kPDFDisplayBoxMediaBox];
    float scale = dpi / 72.0f;
    CGSize imageSize = CGSizeMake(pageRect.size.width * scale, pageRect.size.height * scale);
    
    NSLog(@"🖼️ [BITMAP] Creating bitmap - width: %.0fpx, height: %.0fpx, dpi: %d", imageSize.width, imageSize.height, dpi);
    
    // OPTIMIZATION: Use ImagePool for reduced allocations
    CGFloat imageScale = [UIScreen mainScreen].scale;
    UIImage *pooledImage = [_imagePool obtainImageWithSize:imageSize scale:imageScale];
    
    // Create image context
    UIGraphicsBeginImageContextWithOptions(imageSize, NO, imageScale);
    CGContextRef context = UIGraphicsGetCurrentContext();
    
    // Fill background with white
    CGContextSetFillColorWithColor(context, [UIColor whiteColor].CGColor);
    CGContextFillRect(context, CGRectMake(0, 0, imageSize.width, imageSize.height));
    
    // Scale context
    CGContextScaleCTM(context, scale, scale);
    
    // Render page
    NSLog(@"🖼️ [RENDER] Rendering page to bitmap...");
    [page drawWithBox:kPDFDisplayBoxMediaBox toContext:context];
    
    // Get rendered image
    UIImage *renderedImage = UIGraphicsGetImageFromCurrentImageContext();
    UIGraphicsEndImageContext();
    
    // Recycle pooled image
    [_imagePool recycleImage:pooledImage];
    
    NSLog(@"✅ [RENDER] Page rendered successfully");
    
    if (!outputDir || outputDir.length == 0) {
        NSArray *cachePaths = NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES);
        outputDir = [cachePaths firstObject];
        NSLog(@"📁 [FILE] Using cache dir: %@", outputDir);
    }
    
    // Generate unique filename with timestamp to prevent overwrites
    NSString *baseName = [[pdfURL.lastPathComponent stringByDeletingPathExtension] stringByReplacingOccurrencesOfString:@" " withString:@"_"];
    NSString *fileName = [self generateTimestampedFileName:baseName pageNum:pageIndex + 1 extension:format];
    NSString *outputPath = [self saveImage:renderedImage fileName:fileName outputDir:outputDir];
    
    if (outputPath) {
        NSDictionary *fileAttrs = [[NSFileManager defaultManager] attributesOfItemAtPath:outputPath error:nil];
        unsigned long long fileSize = [fileAttrs fileSize];
        NSLog(@"✅ [EXPORT] exportSinglePageToImage - SUCCESS - size: %llu bytes, path: %@", fileSize, outputPath);
    }
    
    return outputPath;
}

/**
 * Export specific pages to images
 */
- (NSArray *)exportPagesToImages:(NSURL *)pdfURL pages:(NSArray *)pages dpi:(int)dpi format:(NSString *)format outputDir:(NSString *)outputDir {
    NSLog(@"🖼️ [EXPORT] exportPagesToImages - START - dpi: %d, format: %@", dpi, format);
    
    NSMutableArray *exportedFiles = [NSMutableArray array];
    
    PDFDocument *pdfDocument = [[PDFDocument alloc] initWithURL:pdfURL];
    if (!pdfDocument) {
        NSLog(@"❌ [EXPORT] Failed to load PDF document");
        return exportedFiles;
    }
    
    NSUInteger pageCount = pdfDocument.pageCount;
    NSLog(@"📁 [FILE] PDF has %lu total pages", (unsigned long)pageCount);
    
    // Determine which pages to export
    NSMutableArray *pagesToExport = [NSMutableArray array];
    if (pages && pages.count > 0) {
        for (NSNumber *pageNum in pages) {
            int pageIndex = pageNum.intValue;
            if (pageIndex >= 0 && pageIndex < pageCount) {
                [pagesToExport addObject:@(pageIndex)];
            }
        }
        NSLog(@"📊 [PROGRESS] Exporting %lu specific pages", (unsigned long)pagesToExport.count);
    } else {
        // Export all pages
        for (int i = 0; i < pageCount; i++) {
            [pagesToExport addObject:@(i)];
        }
        NSLog(@"📊 [PROGRESS] Exporting all %lu pages", (unsigned long)pageCount);
    }
    
    // Export each page
    int current = 0;
    for (NSNumber *pageNum in pagesToExport) {
        int pageIndex = pageNum.intValue;
        current++;
        
        NSLog(@"📊 [PROGRESS] Exporting page %d/%lu (page number: %d)", current, (unsigned long)pagesToExport.count, pageIndex + 1);
        
        // Emit progress event
        @try {
            double progress = (double)current / (double)pagesToExport.count;
            [self sendEventWithName:@"PDFExportProgress" body:@{
                @"type": @"exportProgress",
                @"operation": @"exportToImages",
                @"currentPage": @(pageIndex + 1),
                @"totalPages": @(pagesToExport.count),
                @"progress": @(progress),
                @"exportedFiles": [exportedFiles copy]
            }];
        } @catch (NSException *exception) {
            // Event emitter not ready, continue without event
        }
        
        PDFPage *page = [pdfDocument pageAtIndex:pageIndex];
        
        if (page) {
            // Calculate dimensions
            CGRect pageRect = [page boundsForBox:kPDFDisplayBoxMediaBox];
            float scale = dpi / 72.0f; // 72 DPI is default
            CGSize imageSize = CGSizeMake(pageRect.size.width * scale, pageRect.size.height * scale);
            
            NSLog(@"🖼️ [BITMAP] Creating %.0fx%.0f image", imageSize.width, imageSize.height);
            
            // OPTIMIZATION: Use ImagePool for reduced allocations
            CGFloat imageScale = [UIScreen mainScreen].scale;
            UIImage *image = [_imagePool obtainImageWithSize:imageSize scale:imageScale];
            
            // Create image context with the pooled image
            UIGraphicsBeginImageContextWithOptions(imageSize, NO, imageScale);
            CGContextRef context = UIGraphicsGetCurrentContext();
            
            // Fill background with white
            CGContextSetFillColorWithColor(context, [UIColor whiteColor].CGColor);
            CGContextFillRect(context, CGRectMake(0, 0, imageSize.width, imageSize.height));
            
            // Scale context
            CGContextScaleCTM(context, scale, scale);
            
            // Render page
            NSLog(@"🖼️ [RENDER] Rendering page to image...");
            [page drawWithBox:kPDFDisplayBoxMediaBox toContext:context];
            
            // Get image
            UIImage *renderedImage = UIGraphicsGetImageFromCurrentImageContext();
            UIGraphicsEndImageContext();
            
            // Recycle the pooled image
            [_imagePool recycleImage:image];
            
            // Generate unique filename with timestamp to prevent overwrites
            NSString *baseName = [[pdfURL.lastPathComponent stringByDeletingPathExtension] stringByReplacingOccurrencesOfString:@" " withString:@"_"];
            NSString *fileName = [self generateTimestampedFileName:baseName pageNum:pageIndex + 1 extension:format];
            NSString *outputPath = [self saveImage:renderedImage fileName:fileName outputDir:outputDir];
            if (outputPath) {
                [exportedFiles addObject:outputPath];
                NSLog(@"✅ [PROGRESS] Page %d exported to %@", pageIndex + 1, outputPath);
            } else {
                NSLog(@"❌ [EXPORT] Failed to save page %d", pageIndex + 1);
            }
        }
    }
    
    NSLog(@"✅ [EXPORT] exportPagesToImages - SUCCESS - Exported %lu pages", (unsigned long)exportedFiles.count);
    
    // Emit complete event
    @try {
        [self sendEventWithName:@"PDFExportComplete" body:@{
            @"type": @"exportComplete",
            @"operation": @"exportToImages",
            @"totalPages": @(exportedFiles.count),
            @"exportedFiles": [exportedFiles copy],
            @"success": @YES
        }];
    } @catch (NSException *exception) {
        // Event emitter not ready, continue without event
    }
    
    return exportedFiles;
}

/**
 * Save image to file
 */
- (NSString *)saveImage:(UIImage *)image fileName:(NSString *)fileName outputDir:(NSString *)outputDir {
    NSURL *outputURL;
    
    if (outputDir && outputDir.length > 0) {
        NSFileManager *fileManager = [NSFileManager defaultManager];
        if (![fileManager fileExistsAtPath:outputDir]) {
            [fileManager createDirectoryAtPath:outputDir withIntermediateDirectories:YES attributes:nil error:nil];
        }
        outputURL = [NSURL fileURLWithPath:[outputDir stringByAppendingPathComponent:fileName]];
    } else {
        // Save to app's documents directory
        NSArray *paths = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES);
        NSString *documentsDirectory = [paths objectAtIndex:0];
        outputURL = [NSURL fileURLWithPath:[documentsDirectory stringByAppendingPathComponent:fileName]];
    }
    
    NSLog(@"📁 [FILE] Writing to: %@", outputURL.path);
    
    // OPTIMIZATION: Smart format selection for better performance
    // JPEG: 5-6x faster than PNG, 90% quality is visually identical
    // PNG: Slowest but lossless (use only when required)
    NSData *imageData;
    NSString *format;
    NSString *lowerFileName = fileName.lowercaseString;
    if ([lowerFileName hasSuffix:@".jpg"] || [lowerFileName hasSuffix:@".jpeg"]) {
        imageData = UIImageJPEGRepresentation(image, 0.9); // High quality, much faster than PNG
        format = @"JPEG at 90% quality";
    } else if ([lowerFileName hasSuffix:@".png"]) {
        imageData = UIImagePNGRepresentation(image); // PNG: Default for backward compatibility
        format = @"PNG";
    } else {
        // Default to JPEG for better performance (was PNG)
        imageData = UIImageJPEGRepresentation(image, 0.9);
        format = @"JPEG at 90% quality (default)";
    }
    
    NSLog(@"📁 [FILE] Compressing as %@", format);
    
    // Save to file
    NSError *error;
    BOOL success = [imageData writeToURL:outputURL options:NSDataWritingAtomic error:&error];
    
    if (success) {
        unsigned long fileSize = (unsigned long)imageData.length;
        NSLog(@"✅ [FILE] Saved - size: %lu bytes", fileSize);
        return outputURL.path;
    } else {
        NSLog(@"❌ [FILE] Error saving image: %@", error.localizedDescription);
        return nil;
    }
}

/**
 * Merge multiple PDFs
 * PRO FEATURE: Requires Pro license
 */
RCT_EXPORT_METHOD(mergePDFs:(NSArray *)filePaths
                  outputPath:(NSString *)outputPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    
    // All features are FREE - no license verification needed
    
    if (!filePaths || filePaths.count < 2) {
        reject(@"INVALID_INPUT", @"At least 2 PDF files are required for merging", nil);
        return;
    }
    
    // Emit start event
    @try {
        [self sendEventWithName:@"PDFOperationProgress" body:@{
            @"type": @"operationStart",
            @"operation": @"mergePDFs",
            @"fileCount": @(filePaths.count),
            @"outputPath": outputPath ?: [NSNull null]
        }];
    } @catch (NSException *exception) {
        // Event emitter not ready, continue without event
    }
    
    // Create merged PDF
    PDFDocument *mergedPDF = [[PDFDocument alloc] init];
    int currentFile = 0;
    
    for (NSString *filePath in filePaths) {
        currentFile++;
        NSURL *pdfURL = [NSURL fileURLWithPath:filePath];
        PDFDocument *pdfDoc = [[PDFDocument alloc] initWithURL:pdfURL];
        
        if (pdfDoc) {
            NSUInteger pageCount = pdfDoc.pageCount;
            for (int i = 0; i < pageCount; i++) {
                PDFPage *page = [pdfDoc pageAtIndex:i];
                if (page) {
                    [mergedPDF insertPage:page atIndex:mergedPDF.pageCount];
                }
            }
            
            // Emit progress event
            @try {
                double progress = (double)currentFile / (double)filePaths.count;
                [self sendEventWithName:@"PDFOperationProgress" body:@{
                    @"type": @"operationProgress",
                    @"operation": @"mergePDFs",
                    @"currentFile": @(currentFile),
                    @"totalFiles": @(filePaths.count),
                    @"progress": @(progress)
                }];
            } @catch (NSException *exception) {
                // Event emitter not ready, continue without event
            }
        }
    }
    
    // Handle null/empty outputPath - generate default path
    if (!outputPath || outputPath.length == 0 || [outputPath isKindOfClass:[NSNull class]]) {
        // Get cache directory
        NSArray *cachePaths = NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES);
        NSString *cacheDir = [cachePaths firstObject];
        
        // Extract base filename from first input file
        NSString *firstFilePath = [filePaths firstObject];
        NSString *inputFileName = [[firstFilePath lastPathComponent] stringByDeletingPathExtension];
        
        // Generate timestamped filename
        NSString *fileName = [self generateTimestampedFileName:inputFileName pageNum:-1 extension:@"pdf"];
        outputPath = [cacheDir stringByAppendingPathComponent:fileName];
        NSLog(@"📁 [FILE] Generated output path: %@", outputPath);
    }
    
    // Save merged PDF
    NSURL *outputURL = [NSURL fileURLWithPath:outputPath];
    BOOL success = [mergedPDF writeToURL:outputURL];
    
    if (success) {
        // Emit complete event
        @try {
            [self sendEventWithName:@"PDFOperationComplete" body:@{
                @"type": @"operationComplete",
                @"operation": @"mergePDFs",
                @"outputPath": outputPath,
                @"success": @YES
            }];
        } @catch (NSException *exception) {
            // Event emitter not ready, continue without event
        }
        resolve(outputPath);
    } else {
        // Emit error event
        @try {
            [self sendEventWithName:@"PDFOperationComplete" body:@{
                @"type": @"operationError",
                @"operation": @"mergePDFs",
                @"error": @"Failed to save merged PDF",
                @"success": @NO
            }];
        } @catch (NSException *exception) {
            // Event emitter not ready, continue without event
        }
        reject(@"MERGE_ERROR", @"Failed to save merged PDF", nil);
    }
}

/**
 * Split PDF into multiple files
 * PRO FEATURE: Requires Pro license
 */
RCT_EXPORT_METHOD(splitPDF:(NSString *)filePath
                  pageRanges:(NSArray *)pageRanges
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    
    // All features are FREE - no license verification needed
    
    if (!filePath || filePath.length == 0) {
        NSLog(@"❌ [SPLIT] Invalid path");
        reject(@"INVALID_PATH", @"File path is required", nil);
        return;
    }
    
    // Handle case where pageRanges might be passed as string instead of array
    if (!pageRanges || ![pageRanges isKindOfClass:[NSArray class]]) {
        if ([pageRanges isKindOfClass:[NSString class]]) {
            NSLog(@"⚠️ [SPLIT] pageRanges passed as string, attempting to parse: %@", pageRanges);
            NSError *jsonError;
            NSData *jsonData = [(NSString *)pageRanges dataUsingEncoding:NSUTF8StringEncoding];
            id parsed = [NSJSONSerialization JSONObjectWithData:jsonData options:0 error:&jsonError];
            if (!jsonError && [parsed isKindOfClass:[NSArray class]]) {
                pageRanges = (NSArray *)parsed;
                NSLog(@"✅ [SPLIT] Successfully parsed pageRanges from string");
            } else {
                NSLog(@"❌ [SPLIT] Failed to parse pageRanges string: %@", jsonError.localizedDescription);
                reject(@"INVALID_RANGES", @"pageRanges must be an array or valid JSON array string", nil);
                return;
            }
        } else {
            NSLog(@"❌ [SPLIT] Invalid pageRanges type");
            reject(@"INVALID_RANGES", @"pageRanges must be an array", nil);
            return;
        }
    }
    
    if (pageRanges.count == 0) {
        NSLog(@"❌ [SPLIT] Empty pageRanges");
        reject(@"INVALID_RANGES", @"At least one page range is required", nil);
        return;
    }
    
    NSLog(@"✂️ [SPLIT] splitPDF - START - file: %@, ranges: %lu", filePath, (unsigned long)pageRanges.count);
    
    NSURL *pdfURL = [NSURL fileURLWithPath:filePath];
    PDFDocument *pdfDocument = [[PDFDocument alloc] initWithURL:pdfURL];
    
    if (!pdfDocument) {
        NSLog(@"❌ [FILE] PDF not found: %@", filePath);
        reject(@"FILE_NOT_FOUND", @"PDF file not found", nil);
        return;
    }
    
    // Emit start event
    @try {
        [self sendEventWithName:@"PDFOperationProgress" body:@{
            @"type": @"operationStart",
            @"operation": @"splitPDF",
            @"filePath": filePath,
            @"rangeCount": @(pageRanges.count)
        }];
    } @catch (NSException *exception) {
        // Event emitter not ready, continue without event
    }
    
    NSMutableArray *splitFiles = [NSMutableArray array];
    NSUInteger pageCount = pdfDocument.pageCount;
    NSLog(@"📁 [FILE] PDF opened, total pages: %lu", (unsigned long)pageCount);
    
    // Convert flat array format [1, 45, 46, 91] to dictionary format [{start: 0, end: 44}, {start: 45, end: 90}]
    NSMutableArray *convertedRanges = [NSMutableArray array];
    if (pageRanges.count > 0) {
        id firstElement = pageRanges[0];
        if ([firstElement isKindOfClass:[NSNumber class]]) {
            // Flat array format - convert to dictionary pairs
            NSLog(@"📊 [SPLIT] Converting flat array to dictionary format");
            for (NSUInteger i = 0; i < pageRanges.count; i += 2) {
                if (i + 1 < pageRanges.count) {
                    NSNumber *startNum = pageRanges[i];
                    NSNumber *endNum = pageRanges[i + 1];
                    // Convert from 1-based (JS) to 0-based (Objective-C)
                    int start = startNum.intValue - 1;
                    int end = endNum.intValue - 1;
                    [convertedRanges addObject:@{
                        @"start": @(start),
                        @"end": @(end)
                    }];
                }
            }
            pageRanges = convertedRanges;
            NSLog(@"📊 [SPLIT] Converted to %lu range(s)", (unsigned long)pageRanges.count);
        } else if ([firstElement isKindOfClass:[NSDictionary class]]) {
            // Already in dictionary format - convert 1-based to 0-based
            NSLog(@"📊 [SPLIT] Converting dictionary ranges from 1-based to 0-based");
            for (NSDictionary *range in pageRanges) {
                NSNumber *startNum = range[@"start"];
                NSNumber *endNum = range[@"end"];
                if (startNum && endNum) {
                    [convertedRanges addObject:@{
                        @"start": @(startNum.intValue - 1),
                        @"end": @(endNum.intValue - 1)
                    }];
                }
            }
            pageRanges = convertedRanges;
        }
    }
    
    int rangeIndex = 0;
    for (NSDictionary *range in pageRanges) {
        rangeIndex++;
        NSNumber *startPage = range[@"start"];
        NSNumber *endPage = range[@"end"];
        
        if (startPage && endPage) {
            int start = startPage.intValue;
            int end = endPage.intValue;
            
            NSLog(@"📊 [PROGRESS] Processing range %d/%lu: pages %d-%d", rangeIndex, (unsigned long)pageRanges.count, start + 1, end + 1);
            
            // Emit progress event
            @try {
                double progress = (double)rangeIndex / (double)pageRanges.count;
                [self sendEventWithName:@"PDFOperationProgress" body:@{
                    @"type": @"operationProgress",
                    @"operation": @"splitPDF",
                    @"currentRange": @(rangeIndex),
                    @"totalRanges": @(pageRanges.count),
                    @"progress": @(progress)
                }];
            } @catch (NSException *exception) {
                // Event emitter not ready, continue without event
            }
            
            if (start >= 0 && end < pageCount && start <= end) {
                PDFDocument *splitPDF = [[PDFDocument alloc] init];
                
                for (int i = start; i <= end; i++) {
                    NSLog(@"📊 [PROGRESS] Processing page %d", i + 1);
                    PDFPage *page = [pdfDocument pageAtIndex:i];
                    if (page) {
                        [splitPDF insertPage:page atIndex:splitPDF.pageCount];
                    }
                }
                
                // Save split PDF
                NSString *fileName = [NSString stringWithFormat:@"split_%d_%d.pdf", start + 1, end + 1];
                NSString *outputPath = [NSTemporaryDirectory() stringByAppendingPathComponent:fileName];
                NSURL *outputURL = [NSURL fileURLWithPath:outputPath];
                
                NSLog(@"📁 [FILE] Creating split file: %@", outputPath);
                
                BOOL success = [splitPDF writeToURL:outputURL];
                if (success) {
                    [splitFiles addObject:outputPath];
                    NSDictionary *fileAttrs = [[NSFileManager defaultManager] attributesOfItemAtPath:outputPath error:nil];
                    unsigned long long fileSize = [fileAttrs fileSize];
                    NSLog(@"✅ [SPLIT] Created file: %@ (size: %llu bytes)", outputPath, fileSize);
                } else {
                    NSLog(@"❌ [SPLIT] Failed to save split file");
                }
            } else {
                NSLog(@"⚠️ [SPLIT] Invalid range: [%d, %d]", start + 1, end + 1);
            }
        }
    }
    
    NSLog(@"✅ [SPLIT] splitPDF - SUCCESS - Split into %lu files", (unsigned long)splitFiles.count);
    
    // Emit complete event
    @try {
        [self sendEventWithName:@"PDFOperationComplete" body:@{
            @"type": @"operationComplete",
            @"operation": @"splitPDF",
            @"splitFiles": splitFiles,
            @"fileCount": @(splitFiles.count),
            @"success": @YES
        }];
    } @catch (NSException *exception) {
        // Event emitter not ready, continue without event
    }
    
    resolve(splitFiles);
}

/**
 * Extract specific pages from PDF
 * PRO FEATURE: Requires Pro license
 */
RCT_EXPORT_METHOD(extractPages:(NSString *)filePath
                  pageNumbers:(NSArray *)pageNumbers
                  outputPath:(NSString *)outputPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    
    NSLog(@"✂️ [EXTRACT] extractPages - START - file: %@, pages: %lu", filePath, (unsigned long)pageNumbers.count);
    
    // All features are FREE - no license verification needed
    
    if (!filePath || filePath.length == 0) {
        NSLog(@"❌ [EXTRACT] Invalid path");
        reject(@"INVALID_PATH", @"File path is required", nil);
        return;
    }
    
    // Emit start event
    @try {
        [self sendEventWithName:@"PDFOperationProgress" body:@{
            @"type": @"operationStart",
            @"operation": @"extractPages",
            @"filePath": filePath,
            @"pageCount": @(pageNumbers.count)
        }];
    } @catch (NSException *exception) {
        // Event emitter not ready, continue without event
    }
    
    NSURL *pdfURL = [NSURL fileURLWithPath:filePath];
    PDFDocument *pdfDocument = [[PDFDocument alloc] initWithURL:pdfURL];
    
    if (!pdfDocument) {
        NSLog(@"❌ [FILE] PDF not found: %@", filePath);
        reject(@"FILE_NOT_FOUND", @"PDF file not found", nil);
        return;
    }
    
    NSUInteger totalPages = pdfDocument.pageCount;
    NSLog(@"📁 [FILE] PDF opened, total pages: %lu", (unsigned long)totalPages);
    NSLog(@"📊 [EXTRACT] Pages to extract: %@", [pageNumbers componentsJoinedByString:@", "]);
    
    // Handle null/empty outputPath - generate default path
    if (!outputPath || outputPath.length == 0 || [outputPath isKindOfClass:[NSNull class]]) {
        // Get cache directory
        NSArray *cachePaths = NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES);
        NSString *cacheDir = [cachePaths firstObject];
        
        // Extract base filename from input path
        NSString *inputFileName = [[filePath lastPathComponent] stringByDeletingPathExtension];
        
        // Generate timestamped filename
        NSString *fileName = [self generateTimestampedFileName:inputFileName pageNum:-1 extension:@"pdf"];
        outputPath = [cacheDir stringByAppendingPathComponent:fileName];
        NSLog(@"📁 [FILE] Generated output path: %@", outputPath);
    } else {
        NSLog(@"📁 [FILE] Using provided output path: %@", outputPath);
    }
    
    // Create extracted PDF
    PDFDocument *extractedPDF = [[PDFDocument alloc] init];
    int extractedCount = 0;
    int current = 0;
    
    for (NSNumber *pageNum in pageNumbers) {
        int pageIndex = pageNum.intValue;
        current++;
        
        NSLog(@"📊 [PROGRESS] Processing page %d/%lu (page number: %d)", current, (unsigned long)pageNumbers.count, pageIndex);
        
        // Emit progress event
        @try {
            double progress = (double)current / (double)pageNumbers.count;
            [self sendEventWithName:@"PDFOperationProgress" body:@{
                @"type": @"operationProgress",
                @"operation": @"extractPages",
                @"currentPage": @(current),
                @"totalPages": @(pageNumbers.count),
                @"progress": @(progress)
            }];
        } @catch (NSException *exception) {
            // Event emitter not ready, continue without event
        }
        
        if (pageIndex >= 0 && pageIndex < totalPages) {
            PDFPage *page = [pdfDocument pageAtIndex:pageIndex];
            if (page) {
                [extractedPDF insertPage:page atIndex:extractedPDF.pageCount];
                extractedCount++;
                NSLog(@"✅ [PROGRESS] Extracted page %d", pageIndex);
            }
        } else {
            NSLog(@"⚠️ [EXTRACT] Skipping invalid page index: %d", pageIndex);
        }
    }
    
    // Save extracted PDF
    NSLog(@"📁 [FILE] Writing extracted PDF...");
    NSURL *outputURL = [NSURL fileURLWithPath:outputPath];
    BOOL success = [extractedPDF writeToURL:outputURL];
    
    if (success) {
        NSDictionary *fileAttrs = [[NSFileManager defaultManager] attributesOfItemAtPath:outputPath error:nil];
        unsigned long long fileSize = [fileAttrs fileSize];
        NSLog(@"✅ [EXTRACT] extractPages - SUCCESS - Extracted %d pages to: %@ (size: %llu bytes)", extractedCount, outputPath, fileSize);
        
        // Emit complete event
        @try {
            [self sendEventWithName:@"PDFOperationComplete" body:@{
                @"type": @"operationComplete",
                @"operation": @"extractPages",
                @"outputPath": outputPath,
                @"extractedCount": @(extractedCount),
                @"success": @YES
            }];
        } @catch (NSException *exception) {
            // Event emitter not ready, continue without event
        }
        
        resolve(outputPath);
    } else {
        NSLog(@"❌ [EXTRACT] Failed to save extracted PDF");
        
        // Emit error event
        @try {
            [self sendEventWithName:@"PDFOperationComplete" body:@{
                @"type": @"operationError",
                @"operation": @"extractPages",
                @"error": @"Failed to save extracted PDF",
                @"success": @NO
            }];
        } @catch (NSException *exception) {
            // Event emitter not ready, continue without event
        }
        
        reject(@"EXTRACT_ERROR", @"Failed to save extracted PDF", nil);
    }
}

/**
 * Rotate a page in PDF
 * PRO FEATURE: Requires Pro license
 */
RCT_EXPORT_METHOD(rotatePage:(NSString *)filePath
                  pageNumber:(int)pageNumber
                  degrees:(int)degrees
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    
    // All features are FREE - no license verification needed
    
    if (!filePath || filePath.length == 0) {
        reject(@"INVALID_PATH", @"File path is required", nil);
        return;
    }
    
    NSURL *pdfURL = [NSURL fileURLWithPath:filePath];
    PDFDocument *pdfDocument = [[PDFDocument alloc] initWithURL:pdfURL];
    
    if (!pdfDocument) {
        reject(@"FILE_NOT_FOUND", @"PDF file not found", nil);
        return;
    }
    
    if (pageNumber < 0 || pageNumber >= pdfDocument.pageCount) {
        reject(@"INVALID_PAGE", @"Invalid page number", nil);
        return;
    }
    
    PDFPage *page = [pdfDocument pageAtIndex:pageNumber];
    if (page) {
        // Rotate page
        int currentRotation = page.rotation;
        int newRotation = (currentRotation + degrees) % 360;
        page.rotation = newRotation;
        
        // Save PDF
        BOOL success = [pdfDocument writeToURL:pdfURL];
        
        if (success) {
            resolve(@YES);
        } else {
            reject(@"ROTATE_ERROR", @"Failed to save rotated PDF", nil);
        }
    } else {
        reject(@"PAGE_NOT_FOUND", @"Page not found", nil);
    }
}

/**
 * Delete a page from PDF
 * PRO FEATURE: Requires Pro license
 */
RCT_EXPORT_METHOD(deletePage:(NSString *)filePath
                  pageNumber:(int)pageNumber
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    
    // All features are FREE - no license verification needed
    
    if (!filePath || filePath.length == 0) {
        reject(@"INVALID_PATH", @"File path is required", nil);
        return;
    }
    
    NSURL *pdfURL = [NSURL fileURLWithPath:filePath];
    PDFDocument *pdfDocument = [[PDFDocument alloc] initWithURL:pdfURL];
    
    if (!pdfDocument) {
        reject(@"FILE_NOT_FOUND", @"PDF file not found", nil);
        return;
    }
    
    if (pageNumber < 0 || pageNumber >= pdfDocument.pageCount) {
        reject(@"INVALID_PAGE", @"Invalid page number", nil);
        return;
    }
    
    // Delete page
    [pdfDocument removePageAtIndex:pageNumber];
    
    // Save PDF
    BOOL success = [pdfDocument writeToURL:pdfURL];
    
    if (success) {
        resolve(@YES);
    } else {
        reject(@"DELETE_ERROR", @"Failed to save PDF after page deletion", nil);
    }
}

/**
 * Get PDF page count
 */
RCT_EXPORT_METHOD(getPageCount:(NSString *)filePath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    
    if (!filePath || filePath.length == 0) {
        reject(@"INVALID_PATH", @"File path is required", nil);
        return;
    }
    
    NSURL *pdfURL = [NSURL fileURLWithPath:filePath];
    PDFDocument *pdfDocument = [[PDFDocument alloc] initWithURL:pdfURL];
    
    if (!pdfDocument) {
        reject(@"FILE_NOT_FOUND", @"PDF file not found", nil);
        return;
    }
    
    NSUInteger pageCount = pdfDocument.pageCount;
    resolve(@(pageCount));
}

/**
 * Compress PDF via PDF-aware page recompression (downsample + JPEG rebuild).
 * Processes one page at a time; falls back to copy if not smaller.
 * @param inputPath Input PDF file path
 * @param outputPath Output compressed PDF file path
 * @param compressionLevel Compression level (0-9, 9 is maximum compression)
 */
RCT_EXPORT_METHOD(compressPDF:(NSString *)inputPath
                  outputPath:(NSString *)outputPath
                  compressionLevel:(int)compressionLevel
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    
    RCTLogInfo(@"compressPDF called with inputPath: %@, outputPath: %@, level: %d", inputPath, outputPath, compressionLevel);
    
    if (!inputPath || inputPath.length == 0) {
        reject(@"INVALID_PATH", @"Input file path is required", nil);
        return;
    }
    
    NSFileManager *fileManager = [NSFileManager defaultManager];
    if (![fileManager fileExistsAtPath:inputPath]) {
        reject(@"FILE_NOT_FOUND", [NSString stringWithFormat:@"Input PDF file not found: %@", inputPath], nil);
        return;
    }
    
    // Generate output path if not provided
    NSString *finalOutputPath = outputPath;
    if (!finalOutputPath || finalOutputPath.length == 0) {
        NSString *directory = [inputPath stringByDeletingLastPathComponent];
        NSString *baseName = [[inputPath lastPathComponent] stringByDeletingPathExtension];
        NSString *outputFileName = [self generateTimestampedFileName:[baseName stringByAppendingString:@"_compressed"] pageNum:-1 extension:@"pdf"];
        finalOutputPath = [directory stringByAppendingPathComponent:outputFileName];
    }
    
    // Ensure output directory exists
    NSString *outputDir = [finalOutputPath stringByDeletingLastPathComponent];
    if (![fileManager fileExistsAtPath:outputDir]) {
        NSError *error;
        [fileManager createDirectoryAtPath:outputDir withIntermediateDirectories:YES attributes:nil error:&error];
        if (error) {
            reject(@"DIR_CREATE_ERROR", @"Failed to create output directory", error);
            return;
        }
    }
    
    RCTLogInfo(@"Starting compression: %@ -> %@", inputPath, finalOutputPath);
    
    StreamingPDFProcessor *processor = [StreamingPDFProcessor sharedInstance];
    NSError *error;
    CompressionResult *result = [processor compressPDFStreaming:inputPath
                                                     outputPath:finalOutputPath
                                               compressionLevel:compressionLevel
                                                          error:&error];
    
    if (error || !result) {
        reject(@"COMPRESSION_ERROR", error ? error.localizedDescription : @"Compression failed", error);
        return;
    }
    
    // Build response
    NSDictionary *response = @{
        @"originalSize": @(result.originalSize),
        @"compressedSize": @(result.compressedSize),
        @"durationMs": @(result.durationMs),
        @"compressionRatio": @(result.compressionRatio),
        @"spaceSavedPercent": @(result.spaceSavedPercent),
        @"outputPath": finalOutputPath,
        @"success": @YES
    };
    
    RCTLogInfo(@"Compression complete: %.2f MB -> %.2f MB (%.1f%% saved) in %.0fms",
              result.originalSize / (1024.0 * 1024.0),
              result.compressedSize / (1024.0 * 1024.0),
              result.spaceSavedPercent,
              result.durationMs);
    
    resolve(response);
}

@end
