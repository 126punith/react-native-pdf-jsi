/**
 * Copyright (c) 2025-present, Punith M (punithm300@gmail.com)
 * PDF text extraction (PDFKit) and optional on-device OCR (Vision).
 */

#import <React/RCTBridgeModule.h>
#import <React/RCTLog.h>
#import <PDFKit/PDFKit.h>
#import <Vision/Vision.h>
#import <UIKit/UIKit.h>
#import <CoreGraphics/CoreGraphics.h>

@interface PDFTextModule : NSObject <RCTBridgeModule>
@end

@implementation PDFTextModule {
    dispatch_queue_t _queue;
}

RCT_EXPORT_MODULE(PDFTextModule);

+ (BOOL)requiresMainQueueSetup {
    return NO;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _queue = dispatch_queue_create("com.pdfjsi.text", DISPATCH_QUEUE_SERIAL);
    }
    return self;
}

- (NSString *)normalizePath:(NSString *)filePath {
    if (!filePath) return nil;
    if ([filePath hasPrefix:@"file://"]) {
        return [filePath substringFromIndex:7];
    }
    return filePath;
}

- (PDFDocument *)documentAtPath:(NSString *)filePath error:(NSError **)error {
    NSString *path = [self normalizePath:filePath];
    if (!path.length) {
        if (error) {
            *error = [NSError errorWithDomain:@"PDFTextModule" code:1
                                     userInfo:@{NSLocalizedDescriptionKey: @"File path is required"}];
        }
        return nil;
    }
    if (![[NSFileManager defaultManager] isReadableFileAtPath:path]) {
        if (error) {
            *error = [NSError errorWithDomain:@"PDFTextModule" code:2
                                     userInfo:@{NSLocalizedDescriptionKey: [NSString stringWithFormat:@"PDF file not found or unreadable: %@", path]}];
        }
        return nil;
    }
    PDFDocument *doc = [[PDFDocument alloc] initWithURL:[NSURL fileURLWithPath:path]];
    if (!doc) {
        if (error) {
            *error = [NSError errorWithDomain:@"PDFTextModule" code:3
                                     userInfo:@{NSLocalizedDescriptionKey: @"Failed to open PDF document"}];
        }
        return nil;
    }
    return doc;
}

- (NSString *)textForPage:(PDFPage *)page {
    if (!page) return @"";
    NSString *text = page.string;
    return text ?: @"";
}

- (UIImage *)renderPageImage:(PDFPage *)page dpi:(CGFloat)dpi {
    CGRect pageRect = [page boundsForBox:kPDFDisplayBoxMediaBox];
    CGFloat scale = MAX(1.0, dpi / 72.0);
    CGSize imageSize = CGSizeMake(pageRect.size.width * scale, pageRect.size.height * scale);
    UIGraphicsBeginImageContextWithOptions(imageSize, YES, 1.0);
    CGContextRef ctx = UIGraphicsGetCurrentContext();
    [[UIColor whiteColor] setFill];
    CGContextFillRect(ctx, CGRectMake(0, 0, imageSize.width, imageSize.height));
    CGContextScaleCTM(ctx, scale, scale);
    [page drawWithBox:kPDFDisplayBoxMediaBox toContext:ctx];
    UIImage *image = UIGraphicsGetImageFromCurrentImageContext();
    UIGraphicsEndImageContext();
    return image;
}

- (NSDictionary *)runVisionOCROnImage:(UIImage *)image options:(NSDictionary *)options error:(NSError **)outError {
    if (@available(iOS 13.0, *)) {
        if (!image || !image.CGImage) {
            if (outError) {
                *outError = [NSError errorWithDomain:@"PDFTextModule" code:10
                                           userInfo:@{NSLocalizedDescriptionKey: @"Failed to decode image"}];
            }
            return nil;
        }

        __block NSMutableString *fullText = [NSMutableString string];
        __block NSMutableArray *blocks = [NSMutableArray array];
        __block NSError *requestError = nil;

        CGFloat imgW = image.size.width;
        CGFloat imgH = image.size.height;

        VNRecognizeTextRequest *request =
            [[VNRecognizeTextRequest alloc] initWithCompletionHandler:^(VNRequest *req, NSError *reqError) {
                if (reqError) {
                    requestError = reqError;
                    return;
                }
                NSArray<VNRecognizedTextObservation *> *observations =
                    (NSArray<VNRecognizedTextObservation *> *)req.results;
                for (VNRecognizedTextObservation *obs in observations) {
                    VNRecognizedText *top = [obs topCandidates:1].firstObject;
                    if (!top) continue;
                    NSString *line = top.string ?: @"";
                    if (fullText.length > 0) {
                        [fullText appendString:@"\n"];
                    }
                    [fullText appendString:line];

                    CGRect box = obs.boundingBox;
                    CGFloat left = box.origin.x * imgW;
                    CGFloat right = (box.origin.x + box.size.width) * imgW;
                    CGFloat bottom = box.origin.y * imgH;
                    CGFloat topY = (box.origin.y + box.size.height) * imgH;
                    CGFloat flippedTop = imgH - topY;
                    CGFloat flippedBottom = imgH - bottom;
                    NSString *rectStr = [NSString stringWithFormat:@"%g,%g,%g,%g",
                                         left, flippedTop, right, flippedBottom];
                    [blocks addObject:@{ @"text": line, @"rect": rectStr }];
                }
            }];

        request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
        BOOL useFast = options[@"fast"] != nil && [options[@"fast"] boolValue];
        if (useFast) {
            request.recognitionLevel = VNRequestTextRecognitionLevelFast;
        }
        if (options[@"languages"] != nil && [options[@"languages"] isKindOfClass:[NSArray class]]) {
            if (@available(iOS 16.0, *)) {
                request.recognitionLanguages = options[@"languages"];
            }
        }

        VNImageRequestHandler *handler =
            [[VNImageRequestHandler alloc] initWithCGImage:image.CGImage options:@{}];
        NSError *handlerError = nil;
        BOOL ok = [handler performRequests:@[request] error:&handlerError];
        if (!ok || requestError) {
            if (outError) {
                *outError = requestError ?: handlerError;
            }
            return nil;
        }

        return @{
            @"text": [fullText copy],
            @"blocks": blocks,
            @"engine": @"vision",
            @"imageWidth": @(imgW),
            @"imageHeight": @(imgH)
        };
    }
    if (outError) {
        *outError = [NSError errorWithDomain:@"PDFTextModule" code:11
                                 userInfo:@{NSLocalizedDescriptionKey: @"Vision OCR requires iOS 13 or later"}];
    }
    return nil;
}

RCT_EXPORT_METHOD(getCapabilities:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    BOOL ocr = NO;
    if (@available(iOS 13.0, *)) {
        ocr = YES;
    }
    resolve(@{
        @"textExtraction": @YES,
        @"ocr": @(ocr),
        @"customEngineSupported": @YES,
        @"recognizePage": @(ocr),
        @"searchablePdf": @YES,
        @"platform": @"ios",
        @"ocrBuildEnabled": @YES
    });
}

RCT_EXPORT_METHOD(isOCRAvailable:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    if (@available(iOS 13.0, *)) {
        resolve(@YES);
    } else {
        resolve(@NO);
    }
}

RCT_EXPORT_METHOD(getPageCount:(NSString *)filePath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    dispatch_async(_queue, ^{
        NSError *error = nil;
        PDFDocument *doc = [self documentAtPath:filePath error:&error];
        if (!doc) {
            reject(@"PAGE_COUNT_ERROR", error.localizedDescription, error);
            return;
        }
        resolve(@(doc.pageCount));
    });
}

RCT_EXPORT_METHOD(getPageSize:(NSString *)filePath
                  pageIndex:(NSInteger)pageIndex
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    dispatch_async(_queue, ^{
        NSError *error = nil;
        PDFDocument *doc = [self documentAtPath:filePath error:&error];
        if (!doc) {
            reject(@"PAGE_SIZE_ERROR", error.localizedDescription, error);
            return;
        }
        if (pageIndex < 0 || pageIndex >= (NSInteger)doc.pageCount) {
            reject(@"PAGE_SIZE_ERROR",
                   [NSString stringWithFormat:@"Page index out of range: %ld", (long)pageIndex],
                   nil);
            return;
        }
        PDFPage *page = [doc pageAtIndex:(NSUInteger)pageIndex];
        CGRect bounds = [page boundsForBox:kPDFDisplayBoxMediaBox];
        resolve(@{
            @"width": @(bounds.size.width),
            @"height": @(bounds.size.height)
        });
    });
}

RCT_EXPORT_METHOD(extractTextFromPage:(NSString *)filePath
                  pageIndex:(NSInteger)pageIndex
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    dispatch_async(_queue, ^{
        NSError *error = nil;
        PDFDocument *doc = [self documentAtPath:filePath error:&error];
        if (!doc) {
            reject(@"EXTRACT_TEXT_ERROR", error.localizedDescription, error);
            return;
        }
        if (pageIndex < 0 || pageIndex >= (NSInteger)doc.pageCount) {
            reject(@"EXTRACT_TEXT_ERROR",
                   [NSString stringWithFormat:@"Page index out of range: %ld (count=%lu)",
                    (long)pageIndex, (unsigned long)doc.pageCount],
                   nil);
            return;
        }
        PDFPage *page = [doc pageAtIndex:(NSUInteger)pageIndex];
        resolve([self textForPage:page]);
    });
}

RCT_EXPORT_METHOD(extractTextFromPages:(NSString *)filePath
                  pageIndices:(NSArray *)pageIndices
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    dispatch_async(_queue, ^{
        NSError *error = nil;
        PDFDocument *doc = [self documentAtPath:filePath error:&error];
        if (!doc) {
            reject(@"EXTRACT_TEXT_ERROR", error.localizedDescription, error);
            return;
        }
        NSMutableDictionary *out = [NSMutableDictionary dictionary];
        for (id raw in pageIndices) {
            NSInteger pageIndex = [raw integerValue];
            NSString *key = [NSString stringWithFormat:@"%ld", (long)pageIndex];
            if (pageIndex < 0 || pageIndex >= (NSInteger)doc.pageCount) {
                out[key] = @"";
                continue;
            }
            PDFPage *page = [doc pageAtIndex:(NSUInteger)pageIndex];
            out[key] = [self textForPage:page];
        }
        resolve(out);
    });
}

RCT_EXPORT_METHOD(extractAllText:(NSString *)filePath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    dispatch_async(_queue, ^{
        NSError *error = nil;
        PDFDocument *doc = [self documentAtPath:filePath error:&error];
        if (!doc) {
            reject(@"EXTRACT_TEXT_ERROR", error.localizedDescription, error);
            return;
        }
        NSMutableDictionary *out = [NSMutableDictionary dictionary];
        for (NSUInteger i = 0; i < doc.pageCount; i++) {
            PDFPage *page = [doc pageAtIndex:i];
            out[[NSString stringWithFormat:@"%lu", (unsigned long)i]] = [self textForPage:page];
        }
        resolve(out);
    });
}

RCT_EXPORT_METHOD(recognizeImage:(NSString *)imagePath
                  options:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    dispatch_async(_queue, ^{
        NSString *path = [self normalizePath:imagePath];
        if (!path.length || ![[NSFileManager defaultManager] isReadableFileAtPath:path]) {
            reject(@"OCR_IMAGE_ERROR", @"Image file not found or unreadable", nil);
            return;
        }
        UIImage *image = [UIImage imageWithContentsOfFile:path];
        NSError *error = nil;
        NSDictionary *result = [self runVisionOCROnImage:image options:options error:&error];
        if (!result) {
            reject(@"OCR_ERROR", error.localizedDescription ?: @"Vision OCR failed", error);
            return;
        }
        resolve(result);
    });
}

RCT_EXPORT_METHOD(recognizePage:(NSString *)filePath
                  pageIndex:(NSInteger)pageIndex
                  options:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    dispatch_async(_queue, ^{
        NSError *error = nil;
        PDFDocument *doc = [self documentAtPath:filePath error:&error];
        if (!doc) {
            reject(@"OCR_ERROR", error.localizedDescription, error);
            return;
        }
        if (pageIndex < 0 || pageIndex >= (NSInteger)doc.pageCount) {
            reject(@"OCR_ERROR",
                   [NSString stringWithFormat:@"Page index out of range: %ld", (long)pageIndex],
                   nil);
            return;
        }
        CGFloat dpi = 200.0;
        if (options[@"dpi"] != nil) {
            dpi = [options[@"dpi"] doubleValue];
        }
        PDFPage *page = [doc pageAtIndex:(NSUInteger)pageIndex];
        UIImage *image = [self renderPageImage:page dpi:dpi];
        NSDictionary *result = [self runVisionOCROnImage:image options:options error:&error];
        if (!result) {
            reject(@"OCR_ERROR", error.localizedDescription ?: @"Vision OCR failed", error);
            return;
        }
        resolve(result);
    });
}

RCT_EXPORT_METHOD(createSearchablePDF:(NSArray *)pages
                  outputPath:(NSString *)outputPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    dispatch_async(_queue, ^{
        NSString *out = [self normalizePath:outputPath];
        if (!pages.count || !out.length) {
            reject(@"SEARCHABLE_PDF_ERROR", @"pages and outputPath are required", nil);
            return;
        }

        NSString *dir = [out stringByDeletingLastPathComponent];
        if (dir.length) {
            [[NSFileManager defaultManager] createDirectoryAtPath:dir
                                      withIntermediateDirectories:YES
                                                       attributes:nil
                                                            error:nil];
        }

        UIGraphicsBeginPDFContextToFile(out, CGRectZero, nil);
        for (NSDictionary *pageMap in pages) {
            NSString *imagePath = [self normalizePath:pageMap[@"imagePath"]];
            CGFloat widthPt = [pageMap[@"widthPt"] doubleValue];
            CGFloat heightPt = [pageMap[@"heightPt"] doubleValue];
            if (widthPt <= 0) widthPt = 612;
            if (heightPt <= 0) heightPt = 792;

            UIImage *pageImage = [UIImage imageWithContentsOfFile:imagePath];
            if (!pageImage) {
                UIGraphicsEndPDFContext();
                reject(@"SEARCHABLE_PDF_ERROR",
                       [NSString stringWithFormat:@"Failed to decode page image: %@", imagePath],
                       nil);
                return;
            }

            CGRect pageRect = CGRectMake(0, 0, widthPt, heightPt);
            UIGraphicsBeginPDFPageWithInfo(pageRect, nil);
            [pageImage drawInRect:pageRect];

            CGFloat imgW = pageImage.size.width;
            CGFloat imgH = pageImage.size.height;
            CGFloat sx = widthPt / MAX(imgW, 1);
            CGFloat sy = heightPt / MAX(imgH, 1);

            NSArray *blocks = pageMap[@"blocks"];
            if ([blocks isKindOfClass:[NSArray class]]) {
                for (NSDictionary *block in blocks) {
                    NSString *text = block[@"text"] ?: @"";
                    if (!text.length) continue;
                    NSString *rectStr = block[@"rect"];
                    CGFloat left = 0, top = 0, right = imgW, bottom = imgH;
                    if ([rectStr isKindOfClass:[NSString class]] && [rectStr containsString:@","]) {
                        NSArray *parts = [rectStr componentsSeparatedByString:@","];
                        if (parts.count >= 4) {
                            left = [parts[0] doubleValue];
                            top = [parts[1] doubleValue];
                            right = [parts[2] doubleValue];
                            bottom = [parts[3] doubleValue];
                        }
                    }
                    // Image top-left → PDF UIKit page (origin top-left in UIGraphics PDF)
                    CGFloat x = left * sx;
                    CGFloat y = top * sy;
                    CGFloat w = MAX(8, fabs(right - left) * sx);
                    CGFloat h = MAX(8, fabs(bottom - top) * sy);
                    CGRect drawRect = CGRectMake(x, y, w, h);
                    NSDictionary *attrs = @{
                        NSFontAttributeName: [UIFont systemFontOfSize:MAX(6, h * 0.85)],
                        NSForegroundColorAttributeName: [[UIColor blackColor] colorWithAlphaComponent:0.01]
                    };
                    [text drawInRect:drawRect withAttributes:attrs];
                }
            }
        }
        UIGraphicsEndPDFContext();

        resolve(@{
            @"outputPath": out,
            @"pageCount": @(pages.count)
        });
    });
}

@end
