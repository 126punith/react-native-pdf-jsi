/**
 * Copyright (c) 2025-present, Enhanced PDF JSI Manager for iOS
 * All rights reserved.
 * 
 * JSI Manager for high-performance PDF operations on iOS
 * Provides React Native bridge integration for JSI PDF functions
 */

 #import <Foundation/Foundation.h>
 #import <React/RCTBridgeModule.h>
 #import <React/RCTEventEmitter.h>
 
 @interface PDFJSIManager : RCTEventEmitter <RCTBridgeModule>
 
 // JSI Method Declarations
 - (void)renderPageDirect:(NSString *)pdfId
               pageNumber:(NSInteger)pageNumber
                    scale:(double)scale
               base64Data:(NSString *)base64Data
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject;
 
 - (void)getPageMetrics:(NSString *)pdfId
             pageNumber:(NSInteger)pageNumber
               resolver:(RCTPromiseResolveBlock)resolve
               rejecter:(RCTPromiseRejectBlock)reject;
 
 - (void)preloadPagesDirect:(NSString *)pdfId
                  startPage:(NSInteger)startPage
                    endPage:(NSInteger)endPage
                   resolver:(RCTPromiseResolveBlock)resolve
                   rejecter:(RCTPromiseRejectBlock)reject;
 
 - (void)getCacheMetrics:(NSString *)pdfId
                resolver:(RCTPromiseResolveBlock)resolve
                rejecter:(RCTPromiseRejectBlock)reject;
 
 - (void)clearCacheDirect:(NSString *)pdfId
                cacheType:(NSString *)cacheType
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject;
 
 - (void)optimizeMemory:(NSString *)pdfId
               resolver:(RCTPromiseResolveBlock)resolve
               rejecter:(RCTPromiseRejectBlock)reject;
 
 - (void)searchTextDirect:(NSString *)pdfId
               searchTerm:(NSString *)searchTerm
                startPage:(NSInteger)startPage
                  endPage:(NSInteger)endPage
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject;
 
 - (void)getPerformanceMetrics:(NSString *)pdfId
                      resolver:(RCTPromiseResolveBlock)resolve
                      rejecter:(RCTPromiseRejectBlock)reject;
 
 - (void)setRenderQuality:(NSString *)pdfId
                  quality:(NSInteger)quality
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject;
 
 - (void)check16KBSupport:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject;

+ (BOOL)registerPathForSearchSync:(NSString *)pdfId path:(NSString *)path;
+ (NSArray<NSDictionary *> *)searchTextDirectSync:(NSString *)pdfId
                                       searchTerm:(NSString *)searchTerm
                                        startPage:(NSInteger)startPage
                                          endPage:(NSInteger)endPage;
+ (NSString *)nitroPageMetrics:(NSString *)pdfId pageNumber:(NSInteger)pageNumber;
+ (NSString *)nitroRenderPage:(NSString *)pdfId pageNumber:(NSInteger)pageNumber scale:(double)scale;
+ (NSString *)nitroPageCount:(NSString *)filePath;
+ (NSString *)nitroPageSize:(NSString *)filePath pageIndex:(NSInteger)pageIndex;
+ (NSString *)nitroTextFromPage:(NSString *)filePath pageIndex:(NSInteger)pageIndex;
+ (NSString *)nitroTextFromPages:(NSString *)filePath pageIndicesJson:(NSString *)pageIndicesJson;
+ (NSString *)nitroAllText:(NSString *)filePath;
+ (NSString *)nitroExportPageToImage:(NSString *)filePath pageIndex:(NSInteger)pageIndex scale:(double)scale;
+ (NSString *)nitroExportToImages:(NSString *)filePath scale:(double)scale;
+ (NSString *)nitroMergePDFs:(NSString *)filePathsJson outputPath:(NSString *)outputPath;
+ (NSString *)nitroSplitPDF:(NSString *)filePath pageRangesJson:(NSString *)pageRangesJson outputDir:(NSString *)outputDir;
+ (NSString *)nitroExtractPages:(NSString *)filePath pageNumbersJson:(NSString *)pageNumbersJson outputPath:(NSString *)outputPath;
+ (BOOL)nitroRotatePage:(NSString *)filePath pageNumber:(NSInteger)pageNumber degrees:(NSInteger)degrees;
+ (BOOL)nitroDeletePage:(NSString *)filePath pageNumber:(NSInteger)pageNumber;
+ (NSString *)nitroCompressPDF:(NSString *)inputPath outputPath:(NSString *)outputPath compressionLevel:(int)compressionLevel;

@end
 