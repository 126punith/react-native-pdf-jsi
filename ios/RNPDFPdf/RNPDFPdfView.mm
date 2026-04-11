/**
 * Copyright (c) 2017-present, Wonday (@wonday.org)
 * All rights reserved.
 *
 * This source code is licensed under the MIT-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "RNPDFPdfView.h"
#import "SearchRegistry.h"

#import <Foundation/Foundation.h>
#import <QuartzCore/QuartzCore.h>
#import <PDFKit/PDFKit.h>

#if __has_include(<React/RCTAssert.h>)
#import <React/RCTBridgeModule.h>
#import <React/RCTEventDispatcher.h>
#import <React/UIView+React.h>
#import <React/RCTLog.h>
#import <React/RCTBlobManager.h>
#else
#import "RCTBridgeModule.h"
#import "RCTEventDispatcher.h"
#import "UIView+React.h"
#import "RCTLog.h"
#import <RCTBlobManager.h">
#endif

#ifdef RCT_NEW_ARCH_ENABLED
#import <React/RCTConversions.h>
#import <React/RCTFabricComponentsPlugins.h>
#import <react/renderer/components/rnpdf/ComponentDescriptors.h>
#import <react/renderer/components/rnpdf/Props.h>
#import <react/renderer/components/rnpdf/RCTComponentViewHelpers.h>

// Some RN private method hacking below similar to how it is done in RNScreens:
// https://github.com/software-mansion/react-native-screens/blob/90e548739f35b5ded2524a9d6410033fc233f586/ios/RNSScreenStackHeaderConfig.mm#L30
@interface RCTBridge (Private)
+ (RCTBridge *)currentBridge;
@end

#endif

#ifndef __OPTIMIZE__
// only output log when debug
#define DLog( s, ... ) NSLog( @"<%p %@:(%d)> %@", self, [[NSString stringWithUTF8String:__FILE__] lastPathComponent], __LINE__, [NSString stringWithFormat:(s), ##__VA_ARGS__] )
#else
#define DLog( s, ... )
#endif

// output log both debug and release
#define RLog( s, ... ) NSLog( @"<%p %@:(%d)> %@", self, [[NSString stringWithUTF8String:__FILE__] lastPathComponent], __LINE__, [NSString stringWithFormat:(s), ##__VA_ARGS__] )

const float MAX_SCALE = 3.0f;
const float MIN_SCALE = 1.0f;


/** Overlay that draws highlight rects on top of the PDF view. */
@interface HighlightOverlayView : UIView
@property (nonatomic, weak) PDFView *pdfView;
@property (nonatomic, copy) NSArray<NSDictionary *> *highlightRects;
@end

@implementation HighlightOverlayView
- (void)drawRect:(CGRect)rect {
    PDFView *pv = self.pdfView;
    NSArray *items = self.highlightRects;
    if (!pv || !pv.document || !items.count) return;
    PDFDocument *doc = pv.document;
    [[UIColor colorWithRed:1 green:1 blue:0 alpha:0.35] setFill];
    for (NSDictionary *item in items) {
        NSNumber *pageNum = item[@"page"];
        NSString *rectStr = item[@"rect"];
        if (!pageNum || !rectStr.length) continue;
        int page1 = pageNum.intValue;
        if (page1 < 1) continue;
        PDFPage *page = [doc pageAtIndex:(NSUInteger)(page1 - 1)];
        if (!page) continue;
        NSArray<NSString *> *parts = [rectStr componentsSeparatedByString:@","];
        if (parts.count != 4) continue;
        CGFloat left = parts[0].doubleValue, top = parts[1].doubleValue, right = parts[2].doubleValue, bottom = parts[3].doubleValue;
        CGRect pageRect = CGRectMake(left, bottom, right - left, top - bottom);
        CGRect viewRect = [pv convertRect:pageRect fromPage:page];
        CGContextFillRect(UIGraphicsGetCurrentContext(), viewRect);
    }
}
@end

@interface RNPDFScrollViewDelegateProxy : NSObject <UIScrollViewDelegate>
- (instancetype)initWithPrimary:(id<UIScrollViewDelegate>)primary secondary:(id<UIScrollViewDelegate>)secondary;
@end

@implementation RNPDFScrollViewDelegateProxy {
    __weak id<UIScrollViewDelegate> _primary;
    __weak id<UIScrollViewDelegate> _secondary;
}

- (instancetype)initWithPrimary:(id<UIScrollViewDelegate>)primary secondary:(id<UIScrollViewDelegate>)secondary {
    if (self = [super init]) {
        _primary = primary;
        _secondary = secondary;
    }
    return self;
}

- (BOOL)respondsToSelector:(SEL)aSelector {
    return [super respondsToSelector:aSelector]
        || (_primary && [_primary respondsToSelector:aSelector])
        || (_secondary && [_secondary respondsToSelector:aSelector]);
}

- (id)forwardingTargetForSelector:(SEL)aSelector {
    if (_primary && [_primary respondsToSelector:aSelector]) {
        return _primary;
    }
    if (_secondary && [_secondary respondsToSelector:aSelector]) {
        return _secondary;
    }
    return [super forwardingTargetForSelector:aSelector];
}

- (void)scrollViewDidScroll:(UIScrollView *)scrollView {
    if (_primary && [_primary respondsToSelector:@selector(scrollViewDidScroll:)]) {
        [_primary scrollViewDidScroll:scrollView];
    }
    if (_secondary && [_secondary respondsToSelector:@selector(scrollViewDidScroll:)]) {
        [_secondary scrollViewDidScroll:scrollView];
    }
}

- (UIView *)viewForZoomingInScrollView:(UIScrollView *)scrollView {
    // First check if primary delegate (PDFView's internal) handles it
    if (_primary && [_primary respondsToSelector:@selector(viewForZoomingInScrollView:)]) {
        UIView *zoomView = [_primary viewForZoomingInScrollView:scrollView];
        if (zoomView != nil) {
            NSLog(@"🔍 [iOS Zoom Delegate] Primary delegate returned zoom view: %@", NSStringFromClass([zoomView class]));
            return zoomView;
        }
    }

    // PDFKit's scroll view needs to zoom the PDFDocumentView
    // Search for it in the hierarchy
    for (UIView *subview in scrollView.subviews) {
        NSString *className = NSStringFromClass([subview class]);
        if ([className containsString:@"PDFDocumentView"] || [className containsString:@"PDFPage"]) {
            NSLog(@"🔍 [iOS Zoom Delegate] Found PDF view for zooming: %@", className);
            return subview;
        }
    }

    // Fallback to first subview if it exists
    UIView *fallback = scrollView.subviews.firstObject;
    if (fallback) {
        NSLog(@"🔍 [iOS Zoom Delegate] Using fallback zoom view: %@", NSStringFromClass([fallback class]));
    } else {
        NSLog(@"⚠️ [iOS Zoom Delegate] WARNING: No view found for zooming! Scroll view has %lu subviews", (unsigned long)scrollView.subviews.count);
    }
    return fallback;
}

@end

@interface RNPDFPdfView() <PDFDocumentDelegate, PDFViewDelegate
#ifdef RCT_NEW_ARCH_ENABLED
, RCTRNPDFPdfViewViewProtocol
#endif
>
@end

@implementation RNPDFPdfView
{
    RCTBridge *_bridge;
    PDFDocument *_pdfDocument;
    PDFView *_pdfView;
    UIScrollView *_internalScrollView;
    id<UIScrollViewDelegate> _originalScrollDelegate;
    RNPDFScrollViewDelegateProxy *_scrollDelegateProxy;
    PDFOutline *root;
    float _fixScaleFactor;
    bool _initialed;
    NSArray<NSString *> *_changedProps;
    UITapGestureRecognizer *_doubleTapRecognizer;
    UITapGestureRecognizer *_singleTapRecognizer;
    UILongPressGestureRecognizer *_longPressRecognizer;
    UITapGestureRecognizer *_doubleTapEmptyRecognizer;
    
    // Enhanced progressive loading properties
    BOOL _enableCaching;
    BOOL _enablePreloading;
    int _preloadRadius;
    BOOL _enableTextSelection;
    BOOL _showPerformanceMetrics;
    int _cacheSize;
    int _renderQuality;
    
    // Performance tracking
    CFAbsoluteTime _loadStartTime;
    CFAbsoluteTime _loadTime;
    int _pageCount;
    NSMutableDictionary *_pageCache;
    NSMutableSet *_preloadedPages;
    NSMutableDictionary *_performanceMetrics;
    NSMutableDictionary *_searchCache;
    NSString *_currentPdfId;
    NSOperationQueue *_preloadQueue;
    
    // Page navigation state tracking
    int _previousPage;
    BOOL _isNavigating;
    BOOL _documentLoaded;
    
    // Track usePageViewController state to prevent unnecessary reconfiguration
    BOOL _currentUsePageViewController;
    BOOL _usePageViewControllerStateInitialized;
    
    // Search and highlight (iOS parity with Android)
    NSString *_pdfId;
    NSArray *_highlightRects;
    HighlightOverlayView *_highlightOverlay;
    /// Local file path when document loaded (used for SearchRegistry; may differ from _path which can be URI)
    NSString *_lastLoadedPath;
}

#ifdef RCT_NEW_ARCH_ENABLED

using namespace facebook::react;

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  // Defensive check: Ensure the descriptor class exists before returning
  // This prevents nil object insertion in RCTThirdPartyComponentsProvider
  // The component name must match the codegen name: "RNPDFPdfView"
  // Using static to ensure the provider is initialized only once
  static ComponentDescriptorProvider provider = concreteComponentDescriptorProvider<RNPDFPdfViewComponentDescriptor>();
  return provider;
}

// Needed because of this: https://github.com/facebook/react-native/pull/37274
+ (void)load
{
  [super load];
  
  // Force class to be loaded before React Native tries to register it
  // This ensures RNPDFPdfViewCls() returns a valid class, preventing nil insertion
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    // Force class initialization by accessing the class
    Class cls = [self class];
    if (cls == nil) {
      RCTLogError(@"RNPDFPdfView: Class is nil in +load");
      return;
    }
    
    // Ensure component name is properly set for registration
    // This helps React Native's RCTThirdPartyComponentsProvider find the component
    // The component name must match the codegen name: "RNPDFPdfView"
    NSString *componentName = NSStringFromClass(cls);
    if (componentName == nil || componentName.length == 0) {
      RCTLogError(@"RNPDFPdfView: Component name is nil or empty");
    } else if (![componentName isEqualToString:@"RNPDFPdfView"]) {
      RCTLogWarn(@"RNPDFPdfView: Component name mismatch. Expected 'RNPDFPdfView', got '%@'", componentName);
    }
    
    // Verify class is accessible (RNPDFPdfViewCls is defined later, so we just verify the class itself)
    if (cls != RNPDFPdfView.class) {
      RCTLogError(@"RNPDFPdfView: Class mismatch in +load");
    }
  });
}

- (instancetype)initWithFrame:(CGRect)frame
{
    if (self = [super initWithFrame:frame]) {
        static const auto defaultProps = std::make_shared<const RNPDFPdfViewProps>();
        _props = defaultProps;
        [self initCommonProps];
    }
    return self;
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
    const auto &newProps = *std::static_pointer_cast<const RNPDFPdfViewProps>(props);
    NSMutableArray<NSString *> *updatedPropNames = [NSMutableArray new];
    if (_path != RCTNSStringFromStringNilIfEmpty(newProps.path)) {
        _path = RCTNSStringFromStringNilIfEmpty(newProps.path);
        [updatedPropNames addObject:@"path"];
    }
    if (_page != newProps.page) {
        _page = newProps.page;
        [updatedPropNames addObject:@"page"];
    }
    if (_scale != newProps.scale) {
        _scale = newProps.scale;
        [updatedPropNames addObject:@"scale"];
    }
    if (_minScale != newProps.minScale) {
        _minScale = newProps.minScale;
        [updatedPropNames addObject:@"minScale"];
    }
    if (_maxScale != newProps.maxScale) {
        _maxScale = newProps.maxScale;
        [updatedPropNames addObject:@"maxScale"];
    }
    if (_horizontal != newProps.horizontal) {
        RCTLogInfo(@"🔄 [iOS Scroll] Horizontal prop changed: %d -> %d", _horizontal, newProps.horizontal);
        _horizontal = newProps.horizontal;
        [updatedPropNames addObject:@"horizontal"];
    }
    if (_enablePaging != newProps.enablePaging) {
        _enablePaging = newProps.enablePaging;
        [updatedPropNames addObject:@"enablePaging"];
    }
    if (_enableRTL != newProps.enableRTL) {
        _enableRTL = newProps.enableRTL;
        [updatedPropNames addObject:@"enableRTL"];
    }
    if (_enableAnnotationRendering != newProps.enableAnnotationRendering) {
        _enableAnnotationRendering = newProps.enableAnnotationRendering;
        [updatedPropNames addObject:@"enableAnnotationRendering"];
    }
    if (_enableDoubleTapZoom != newProps.enableDoubleTapZoom) {
        _enableDoubleTapZoom = newProps.enableDoubleTapZoom;
        [updatedPropNames addObject:@"enableDoubleTapZoom"];
    }
    if (_fitPolicy != newProps.fitPolicy) {
        _fitPolicy = newProps.fitPolicy;
        [updatedPropNames addObject:@"fitPolicy"];
    }
    if (_spacing != newProps.spacing) {
        _spacing = newProps.spacing;
        [updatedPropNames addObject:@"spacing"];
    }
    if (_password != RCTNSStringFromStringNilIfEmpty(newProps.password)) {
        _password = RCTNSStringFromStringNilIfEmpty(newProps.password);
        [updatedPropNames addObject:@"password"];
    }
    if (_singlePage != newProps.singlePage) {
        RCTLogInfo(@"🔄 [iOS Scroll] SinglePage prop changed: %d -> %d", _singlePage, newProps.singlePage);
        _singlePage = newProps.singlePage;
        [updatedPropNames addObject:@"singlePage"];
    }
    if (_showsHorizontalScrollIndicator != newProps.showsHorizontalScrollIndicator) {
        _showsHorizontalScrollIndicator = newProps.showsHorizontalScrollIndicator;
        [updatedPropNames addObject:@"showsHorizontalScrollIndicator"];
    }
    if (_showsVerticalScrollIndicator != newProps.showsVerticalScrollIndicator) {
        _showsVerticalScrollIndicator = newProps.showsVerticalScrollIndicator;
        [updatedPropNames addObject:@"showsVerticalScrollIndicator"];
    }

    if (_scrollEnabled != newProps.scrollEnabled) {
        _scrollEnabled = newProps.scrollEnabled;
        [updatedPropNames addObject:@"scrollEnabled"];
    }
    NSString *newPdfId = RCTNSStringFromStringNilIfEmpty(newProps.pdfId);
    if (_pdfId != newPdfId && ![newPdfId isEqualToString:_pdfId]) {
        if (_pdfId.length) [SearchRegistry unregisterPath:_pdfId];
        _pdfId = [newPdfId copy];
        [updatedPropNames addObject:@"pdfId"];
        // Only register local file paths; never register URIs - onDocumentChanged will register when we have local path
        NSString *pathToRegister = nil;
        if (_lastLoadedPath.length > 0) {
            pathToRegister = _lastLoadedPath;
        } else if (_path.length > 0 && [_path hasPrefix:@"/"]) {
            pathToRegister = _path;
        }
        if (_pdfId.length && pathToRegister.length > 0) {
            [SearchRegistry registerPath:_pdfId path:pathToRegister];
            RCTLogInfo(@"✅ [iOS] SearchRegistry registered path for pdfId: %@ (from updateProps)", _pdfId);
        }
    }
    // Convert codegen vector of {page, rect} to NSArray for setHighlightRects
    NSMutableArray *newHighlightRects = [NSMutableArray array];
    for (const auto &item : newProps.highlightRects) {
      [newHighlightRects addObject:@{ @"page": @(item.page), @"rect": [NSString stringWithUTF8String:item.rect.c_str()] }];
    }
    [self setHighlightRects:[newHighlightRects copy]];
    [updatedPropNames addObject:@"highlightRects"];
    
    [super updateProps:props oldProps:oldProps];
    [self didSetProps:updatedPropNames];
}

// already added in case https://github.com/facebook/react-native/pull/35378 has been merged
- (BOOL)shouldBeRecycled
{
    return NO;
}

- (void)prepareForRecycle
{
    [super prepareForRecycle];
    if (_pdfId.length) [SearchRegistry unregisterPath:_pdfId];
    [_pdfView removeFromSuperview];
    _pdfDocument = Nil;
    _pdfView = Nil;
    _highlightOverlay = Nil;
    //Remove notifications
    [[NSNotificationCenter defaultCenter] removeObserver:self name:@"PDFViewDocumentChangedNotification" object:nil];
    [[NSNotificationCenter defaultCenter] removeObserver:self name:@"PDFViewPageChangedNotification" object:nil];
    [[NSNotificationCenter defaultCenter] removeObserver:self name:@"PDFViewScaleChangedNotification" object:nil];

    // remove old recognizers before adding new ones
    [self removeGestureRecognizer:_doubleTapRecognizer];
    [self removeGestureRecognizer:_singleTapRecognizer];
    [self removeGestureRecognizer:_longPressRecognizer];
    [self removeGestureRecognizer:_doubleTapEmptyRecognizer];

    [self initCommonProps];
}

- (void)updateLayoutMetrics:(const facebook::react::LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const facebook::react::LayoutMetrics &)oldLayoutMetrics
{
    // Fabric equivalent of `reactSetFrame` method
    [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
    _pdfView.frame = CGRectMake(0, 0, layoutMetrics.frame.size.width, layoutMetrics.frame.size.height);

    NSMutableArray *mProps = [_changedProps mutableCopy];
    if (_initialed) {
        [mProps removeObject:@"path"];
    }
    _initialed = YES;

    [self didSetProps:mProps];
    
    // Configure scroll view after layout to ensure it's found
    // This is important because PDFKit creates the scroll view lazily
    if (_documentLoaded && _pdfDocument) {
        dispatch_async(dispatch_get_main_queue(), ^{
            RCTLogInfo(@"🔍 [iOS Scroll] updateLayoutMetrics called, configuring scroll view after layout");
            [self configureScrollView:self->_pdfView enabled:self->_scrollEnabled depth:0];
        });
    }
}

- (void)handleCommand:(const NSString *)commandName args:(const NSArray *)args
{
  RCTRNPDFPdfViewHandleCommand(self, commandName, args);
}

- (void)setNativePage:(NSInteger)page
{
    // #13: Imperative setNativePage must navigate even when page number equals _previousPage
    _previousPage = -1;
    _page = (int)page;
    [self didSetProps:[NSArray arrayWithObject:@"page"]];
}

#endif

- (instancetype)initWithBridge:(RCTBridge *)bridge
{
    self = [super init];
    if (self) {
        _bridge = bridge;
        [self initCommonProps];
    }

    return self;
}

- (void)initCommonProps
{
    _page = 1;
    _scale = 1;
    _minScale = MIN_SCALE;
    _maxScale = MAX_SCALE;
    _horizontal = NO;
    _enablePaging = NO;
    _enableRTL = NO;
    _enableAnnotationRendering = YES;
    _enableDoubleTapZoom = YES;
    _fitPolicy = 2;
    _spacing = 10;
    _singlePage = NO;
    _showsHorizontalScrollIndicator = YES;
    _showsVerticalScrollIndicator = YES;
    _scrollEnabled = YES;
    
    // Initialize page navigation state
    _previousPage = -1;
    _isNavigating = NO;
    _documentLoaded = NO;
    
    // Initialize usePageViewController state tracking
    _currentUsePageViewController = NO;
    _usePageViewControllerStateInitialized = NO;
    
    // Enhanced properties
    _enableCaching = YES;
    _enablePreloading = YES;
    _preloadRadius = 3;
    _enableTextSelection = NO;
    _showPerformanceMetrics = NO;
    _cacheSize = 32768; // 32MB
    _renderQuality = 2; // High quality

    // Initialize enhanced features
    _pageCache = [NSMutableDictionary dictionary];
    _preloadedPages = [NSMutableSet set];
    _performanceMetrics = [NSMutableDictionary dictionary];
    _searchCache = [NSMutableDictionary dictionary];
    
    // Create preload queue
    _preloadQueue = [[NSOperationQueue alloc] init];
    _preloadQueue.maxConcurrentOperationCount = 3;
    _preloadQueue.qualityOfService = NSQualityOfServiceBackground;

    _pdfId = nil;
    _highlightRects = nil;
    _lastLoadedPath = nil;
    _highlightOverlay = nil;

    // init and config PDFView
    _pdfView = [[PDFView alloc] initWithFrame:CGRectMake(0, 0, 500, 500)];
    _pdfView.displayMode = kPDFDisplaySinglePageContinuous;
    _pdfView.autoScales = YES;
    _pdfView.displaysPageBreaks = YES;
    _pdfView.displayBox = kPDFDisplayBoxCropBox;
    _pdfView.backgroundColor = [UIColor clearColor];

    _fixScaleFactor = -1.0f;
    _initialed = NO;
    _changedProps = NULL;

    [self addSubview:_pdfView];


    // register notification
    NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
    [center addObserver:self selector:@selector(onDocumentChanged:) name:PDFViewDocumentChangedNotification object:_pdfView];
    [center addObserver:self selector:@selector(onPageChanged:) name:PDFViewPageChangedNotification object:_pdfView];
    [center addObserver:self selector:@selector(onScaleChanged:) name:PDFViewScaleChangedNotification object:_pdfView];

    [[_pdfView document] setDelegate: self];
    [_pdfView setDelegate: self];

    // Only disable double-tap recognizers to avoid conflicts with custom double-tap
    // Leave all other gestures (including pinch) enabled
    for (UIGestureRecognizer *recognizer in _pdfView.gestureRecognizers) {
        if ([recognizer isKindOfClass:[UITapGestureRecognizer class]]) {
            UITapGestureRecognizer *tapGesture = (UITapGestureRecognizer *)recognizer;
            if (tapGesture.numberOfTapsRequired == 2) {
                recognizer.enabled = NO;
            }
        }
    }

    [self bindTap];
}

// #13: Paper — re-applying the same `page` must still run navigation (controlled lists / setNativeProps)
- (void)setPage:(int)pageValue
{
    if (_documentLoaded && pageValue == _page) {
        _previousPage = -1;
    }
    _page = pageValue;
}

- (void)PDFViewWillClickOnLink:(PDFView *)sender withURL:(NSURL *)url
{
    NSString *_url = url.absoluteString;
    [self notifyOnChangeWithMessage:
                     [[NSString alloc] initWithString:
                      [NSString stringWithFormat:
                       @"linkPressed|%s", _url.UTF8String]]];
}

- (void)didSetProps:(NSArray<NSString *> *)changedProps
{
    if (!_initialed) {

        _changedProps = changedProps;

    } else {
        // Log all didSetProps calls to understand what's triggering reconfigurations
        RCTLogInfo(@"📥 [iOS Scroll] didSetProps called - changedProps=%@, initialized=%d, currentUsePageVC=%d", 
                  changedProps, _usePageViewControllerStateInitialized, _currentUsePageViewController);

        // Create filtered changedProps array - remove "path" if it hasn't actually changed
        // This prevents unnecessary reconfigurations when path is in changedProps but value unchanged
        NSArray<NSString *> *effectiveChangedProps = changedProps;
        BOOL pathActuallyChanged = NO;

        if ([changedProps containsObject:@"path"]) {
            // CRITICAL FIX: Only reset state if the path actually changed
            // React Native sometimes includes path in changedProps even when only page changes
            
            if (_pdfDocument != Nil && _pdfDocument.documentURL != nil) {
                // Compare new path with existing document's path
                NSString *currentPath = _pdfDocument.documentURL.path;
                NSString *newPath = _path;
                // Normalize paths for comparison (remove trailing slashes, resolve symlinks, etc.)
                if (![currentPath isEqualToString:newPath]) {
                    pathActuallyChanged = YES;
                }
            } else {
                // No existing document, so this is a new path (or initial load)
                pathActuallyChanged = YES;
            }
            
            RCTLogInfo(@"🔄 [iOS Scroll] Path prop in changedProps - hadDocument=%d, pathActuallyChanged=%d", 
                      (_pdfDocument != Nil), pathActuallyChanged);
            
            // Filter out "path" from effectiveChangedProps if it hasn't actually changed
            if (!pathActuallyChanged) {
                RCTLogInfo(@"⏭️ [iOS Scroll] Path value unchanged, filtering out 'path' from effectiveChangedProps");
                NSMutableArray<NSString *> *filtered = [changedProps mutableCopy];
                [filtered removeObject:@"path"];
                effectiveChangedProps = filtered;
            } else {
                // Path actually changed, use changedProps as-is
                effectiveChangedProps = changedProps;
            }
            
            if (!pathActuallyChanged) {
                RCTLogInfo(@"⏭️ [iOS Scroll] Path value unchanged, skipping document reload");
                // Skip the rest of path handling
            } else {
                // Reset document load state when path actually changes
                _documentLoaded = NO;
                _previousPage = -1;
                _isNavigating = NO;

                // Release old doc if it exists
            if (_pdfDocument != Nil) {
                _pdfDocument = Nil;
                    _usePageViewControllerStateInitialized = NO;
                    _currentUsePageViewController = NO;
                    RCTLogInfo(@"🔄 [iOS Scroll] Reset usePageViewController state - path changed (hadDocument=YES)");
                } else {
                    RCTLogInfo(@"⏭️ [iOS Scroll] No previous document to reset");
            }
            
            if ([_path hasPrefix:@"blob:"]) {
                RCTBlobManager *blobManager = [
#ifdef RCT_NEW_ARCH_ENABLED
        [RCTBridge currentBridge]
#else
        _bridge
#endif // RCT_NEW_ARCH_ENABLED
                    moduleForName:@"BlobModule"];
                NSURL *blobURL = [NSURL URLWithString:_path];
                NSData *blobData = [blobManager resolveURL:blobURL];
                if (blobData != nil) {
                    _pdfDocument = [[PDFDocument alloc] initWithData:blobData];
                }
            } else {
            
                // decode file path
                _path = (__bridge_transfer NSString *)CFURLCreateStringByReplacingPercentEscapes(NULL, (CFStringRef)_path, CFSTR(""));
                NSURL *fileURL = [NSURL fileURLWithPath:_path];
                _pdfDocument = [[PDFDocument alloc] initWithURL:fileURL];
            }

            if (_pdfDocument) {

                //check need password or not
                if (_pdfDocument.isLocked && ![_pdfDocument unlockWithPassword:_password]) {

                    [self notifyOnChangeWithMessage:@"error|Password required or incorrect password."];

                    _pdfDocument = Nil;
                    return;
                }

                _pdfView.document = _pdfDocument;
                _documentLoaded = YES;
                
                // Configure scroll view after document is set
                // PDFKit creates the scroll view lazily, so we need to wait a bit
                dispatch_async(dispatch_get_main_queue(), ^{
                    RCTLogInfo(@"🔍 [iOS Scroll] Document set, searching for scroll view");
                    [self configureScrollView:self->_pdfView enabled:self->_scrollEnabled depth:0];
                    
                    // Retry after a short delay to catch cases where scroll view is created asynchronously
                    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.1 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
                        RCTLogInfo(@"🔍 [iOS Scroll] Retry search for scroll view after delay");
                        [self configureScrollView:self->_pdfView enabled:self->_scrollEnabled depth:0];
                    });
                });
            } else {

                [self notifyOnChangeWithMessage:[[NSString alloc] initWithString:[NSString stringWithFormat:@"error|Load pdf failed. path=%s",_path.UTF8String]]];

                _pdfDocument = Nil;
                return;
                }
            }
        }

        if (_pdfDocument && ([effectiveChangedProps containsObject:@"path"] || [changedProps containsObject:@"spacing"])) {
            if (_horizontal) {
                _pdfView.pageBreakMargins = UIEdgeInsetsMake(0,_spacing,0,0);
                if (_spacing==0) {
                    if (@available(iOS 12.0, *)) {
                        _pdfView.pageShadowsEnabled = NO;
                    }
                } else {
                    if (@available(iOS 12.0, *)) {
                        _pdfView.pageShadowsEnabled = YES;
                    }
                }
            } else {
                _pdfView.pageBreakMargins = UIEdgeInsetsMake(0,0,_spacing,0);
                if (_spacing==0) {
                    if (@available(iOS 12.0, *)) {
                        _pdfView.pageShadowsEnabled = NO;
                    }
                } else {
                    if (@available(iOS 12.0, *)) {
                        _pdfView.pageShadowsEnabled = YES;
                    }
                }
            }
        }

        if (_pdfDocument && ([effectiveChangedProps containsObject:@"path"] || [changedProps containsObject:@"enableRTL"])) {
            _pdfView.displaysRTL = _enableRTL;
        }

        if (_pdfDocument && ([effectiveChangedProps containsObject:@"path"] || [changedProps containsObject:@"enableAnnotationRendering"])) {
            if (!_enableAnnotationRendering) {
                for (unsigned long i=0; i<_pdfView.document.pageCount; i++) {
                    PDFPage *pdfPage = [_pdfView.document pageAtIndex:i];
                    for (unsigned long j=0; j<pdfPage.annotations.count; j++) {
                        pdfPage.annotations[j].shouldDisplay = _enableAnnotationRendering;
                    }
                }
            }
        }

        if (_pdfDocument && ([effectiveChangedProps containsObject:@"path"] || [changedProps containsObject:@"fitPolicy"] || [changedProps containsObject:@"minScale"] || [changedProps containsObject:@"maxScale"])) {

            PDFPage *pdfPage = _pdfView.currentPage ? _pdfView.currentPage : [_pdfDocument pageAtIndex:_pdfDocument.pageCount-1];
            CGRect pdfPageRect = [pdfPage boundsForBox:kPDFDisplayBoxCropBox];

            // some pdf with rotation, then adjust it
            if (pdfPage.rotation == 90 || pdfPage.rotation == 270) {
                pdfPageRect = CGRectMake(0, 0, pdfPageRect.size.height, pdfPageRect.size.width);
            }

            if (_fitPolicy == 0) {
                _fixScaleFactor = self.frame.size.width/pdfPageRect.size.width;
                _pdfView.scaleFactor = _scale * _fixScaleFactor;
                _pdfView.minScaleFactor = _fixScaleFactor*_minScale;
                _pdfView.maxScaleFactor = _fixScaleFactor*_maxScale;
            } else if (_fitPolicy == 1) {
                _fixScaleFactor = self.frame.size.height/pdfPageRect.size.height;
                _pdfView.scaleFactor = _scale * _fixScaleFactor;
                _pdfView.minScaleFactor = _fixScaleFactor*_minScale;
                _pdfView.maxScaleFactor = _fixScaleFactor*_maxScale;
            } else {
                float pageAspect = pdfPageRect.size.width/pdfPageRect.size.height;
                float reactViewAspect = self.frame.size.width/self.frame.size.height;
                if (reactViewAspect>pageAspect) {
                    _fixScaleFactor = self.frame.size.height/pdfPageRect.size.height;
                    _pdfView.scaleFactor = _scale * _fixScaleFactor;
                    _pdfView.minScaleFactor = _fixScaleFactor*_minScale;
                    _pdfView.maxScaleFactor = _fixScaleFactor*_maxScale;
                } else {
                    _fixScaleFactor = self.frame.size.width/pdfPageRect.size.width;
                    _pdfView.scaleFactor = _scale * _fixScaleFactor;
                    _pdfView.minScaleFactor = _fixScaleFactor*_minScale;
                    _pdfView.maxScaleFactor = _fixScaleFactor*_maxScale;
                }
            }
            
            // CRITICAL: Also configure the internal scroll view zoom scales
            // This must be done AFTER _fixScaleFactor is set above
            if (_internalScrollView && _fixScaleFactor > 0) {
                _internalScrollView.minimumZoomScale = _fixScaleFactor * _minScale;
                _internalScrollView.maximumZoomScale = _fixScaleFactor * _maxScale;
                _internalScrollView.zoomScale = _pdfView.scaleFactor;
                RCTLogInfo(@"🔍 [iOS Zoom] Configured internal scroll view zoom scales - min=%f, max=%f, current=%f", 
                          _internalScrollView.minimumZoomScale, 
                          _internalScrollView.maximumZoomScale, 
                          _internalScrollView.zoomScale);
            }

        }

        if (_pdfDocument && ([effectiveChangedProps containsObject:@"path"] || [changedProps containsObject:@"scale"])) {
            _pdfView.scaleFactor = _scale * _fixScaleFactor;
            if (_pdfView.scaleFactor>_pdfView.maxScaleFactor) _pdfView.scaleFactor = _pdfView.maxScaleFactor;
            if (_pdfView.scaleFactor<_pdfView.minScaleFactor) _pdfView.scaleFactor = _pdfView.minScaleFactor;
            
            // Also update internal scroll view zoom scale when scale changes
            if (_internalScrollView && _fixScaleFactor > 0) {
                _internalScrollView.zoomScale = _pdfView.scaleFactor;
                RCTLogInfo(@"🔍 [iOS Zoom] Updated internal scroll view zoom scale to %f", _internalScrollView.zoomScale);
            }
        }

        if (_pdfDocument && ([effectiveChangedProps containsObject:@"path"] || [changedProps containsObject:@"horizontal"])) {
            if (_horizontal) {
                _pdfView.displayDirection = kPDFDisplayDirectionHorizontal;
                _pdfView.pageBreakMargins = UIEdgeInsetsMake(0,_spacing,0,0);
                RCTLogInfo(@"➡️ [iOS Scroll] Set display direction to HORIZONTAL (spacing=%d)", _spacing);
            } else {
                _pdfView.displayDirection = kPDFDisplayDirectionVertical;
                _pdfView.pageBreakMargins = UIEdgeInsetsMake(0,0,_spacing,0);
                RCTLogInfo(@"⬇️ [iOS Scroll] Set display direction to VERTICAL (spacing=%d)", _spacing);
            }
        }

        // CRITICAL FIX: Only configure usePageViewController when path changes (document loading)
        // This prevents unnecessary reconfigurations during scrolling and layout updates
        // Once configured, usePageViewController doesn't need to be reconfigured unless the document changes
        if (_pdfDocument && [effectiveChangedProps containsObject:@"path"]) {
            // Fix: Disable usePageViewController when horizontal is true, as it conflicts with horizontal scrolling
            // UIPageViewController doesn't work well with horizontal PDFView display direction
            BOOL shouldUsePageViewController = _enablePaging && !_horizontal;
            
            RCTLogInfo(@"🔄 [iOS Scroll] Configuring usePageViewController on document load - enablePaging=%d, horizontal=%d, usePageVC=%d", 
                      _enablePaging, _horizontal, shouldUsePageViewController);
            
            // Set state immediately
            _currentUsePageViewController = shouldUsePageViewController;
            _usePageViewControllerStateInitialized = YES;
            
            // Configure usePageViewController - this only happens on document load
            if (shouldUsePageViewController) {
                // Only use page view controller for vertical orientation
                [_pdfView usePageViewController:YES withViewOptions:@{UIPageViewControllerOptionSpineLocationKey:@(UIPageViewControllerSpineLocationMin),UIPageViewControllerOptionInterPageSpacingKey:@(_spacing)}];
                RCTLogInfo(@"✅ [iOS Scroll] Enabled UIPageViewController (vertical paging mode)");
            } else {
                // For horizontal or when paging is disabled, use regular scrolling
                [_pdfView usePageViewController:NO withViewOptions:Nil];
                RCTLogInfo(@"✅ [iOS Scroll] Disabled UIPageViewController (using regular scrolling)");
            }
            
            // Reconfigure scroll view after usePageViewController changes
            // PDFView's internal scroll view hierarchy changes when usePageViewController is toggled
            dispatch_async(dispatch_get_main_queue(), ^{
                // Reset scroll view references to allow reconfiguration
                RCTLogInfo(@"🔄 [iOS Scroll] Resetting scroll view references for reconfiguration");
                self->_internalScrollView = nil;
                self->_originalScrollDelegate = nil;
                self->_scrollDelegateProxy = nil;
                
                // Reconfigure scroll view after view hierarchy updates
                dispatch_async(dispatch_get_main_queue(), ^{
                    RCTLogInfo(@"🔧 [iOS Scroll] Reconfiguring scroll view after usePageViewController change (scrollEnabled=%d)", self->_scrollEnabled);
                    [self configureScrollView:self->_pdfView enabled:self->_scrollEnabled depth:0];
                });
            });
        }

        if (_pdfDocument && ([effectiveChangedProps containsObject:@"path"] || [changedProps containsObject:@"singlePage"])) {
            if (_singlePage) {
                _pdfView.displayMode = kPDFDisplaySinglePage;
                _pdfView.userInteractionEnabled = NO;
                RCTLogInfo(@"📄 [iOS Scroll] Set to SINGLE PAGE mode (userInteractionEnabled=NO)");
            } else {
                _pdfView.displayMode = kPDFDisplaySinglePageContinuous;
                _pdfView.userInteractionEnabled = YES;
                RCTLogInfo(@"📄 [iOS Scroll] Set to CONTINUOUS PAGE mode (userInteractionEnabled=YES)");
            }
        }

        if (_pdfDocument && ([effectiveChangedProps containsObject:@"path"] || [changedProps containsObject:@"showsHorizontalScrollIndicator"] || [changedProps containsObject:@"showsVerticalScrollIndicator"])) {
            [self setScrollIndicators:self horizontal:_showsHorizontalScrollIndicator vertical:_showsVerticalScrollIndicator depth:0];
        }

        // Configure scroll view (scrollEnabled)
        if (_pdfDocument && ([effectiveChangedProps containsObject:@"path"] || 
                             [changedProps containsObject:@"scrollEnabled"])) {
            RCTLogInfo(@"🔧 [iOS Scroll] Configuring scroll enabled=%d (path changed=%d, scrollEnabled changed=%d)", 
                      _scrollEnabled, 
                      [effectiveChangedProps containsObject:@"path"], 
                      [changedProps containsObject:@"scrollEnabled"]);
            
            // If path changed, restore original delegate before reconfiguring
            if ([effectiveChangedProps containsObject:@"path"] && _internalScrollView) {
                RCTLogInfo(@"🔄 [iOS Scroll] Restoring original scroll delegate (path changed)");
                if (_originalScrollDelegate) {
                    _internalScrollView.delegate = _originalScrollDelegate;
                } else {
                    _internalScrollView.delegate = nil;
                }
                _internalScrollView = nil;
                _originalScrollDelegate = nil;
                _scrollDelegateProxy = nil;
            }
            
            // Use dispatch_async to ensure view hierarchy is fully set up after document load
            dispatch_async(dispatch_get_main_queue(), ^{
                // Search within _pdfView's hierarchy for scroll views
                RCTLogInfo(@"🔍 [iOS Scroll] Starting scroll view search in PDFView hierarchy");
                [self configureScrollView:self->_pdfView enabled:self->_scrollEnabled depth:0];
            });
        }

        // Separate page navigation logic - only navigate when page prop actually changes
        // Skip navigation on initial load (when path changes) to avoid conflicts
        BOOL shouldNavigateToPage = _documentLoaded && 
                                     [changedProps containsObject:@"page"] && 
                                     !_isNavigating &&
                                     _page != _previousPage &&
                                     _page > 0 &&
                                     _page <= (int)_pdfDocument.pageCount;
        
        if (shouldNavigateToPage) {
            _isNavigating = YES;
            PDFPage *pdfPage = [_pdfDocument pageAtIndex:_page-1];
            
            if (pdfPage) {
                // Use smooth navigation instead of instant jump to prevent full rerender
                dispatch_async(dispatch_get_main_queue(), ^{
                    if (!self->_enablePaging) {
                        // For non-paging mode, use animated navigation
                        CGRect pdfPageRect = [pdfPage boundsForBox:kPDFDisplayBoxCropBox];
                        
                        // Handle page rotation
                        if (pdfPage.rotation == 90 || pdfPage.rotation == 270) {
                            pdfPageRect = CGRectMake(0, 0, pdfPageRect.size.height, pdfPageRect.size.width);
                        }
                        
                        CGPoint pointLeftTop = CGPointMake(0, pdfPageRect.size.height);
                        PDFDestination *pdfDest = [[PDFDestination alloc] initWithPage:pdfPage atPoint:pointLeftTop];
                        
                        // Use goToDestination for smooth navigation
                        [self->_pdfView goToDestination:pdfDest];
                        self->_pdfView.scaleFactor = self->_fixScaleFactor * self->_scale;
                    } else {
                        // For paging mode, use goToRect for better page alignment
                        if (self->_page == 1) {
                            // Special case for first page
                            [self->_pdfView goToRect:CGRectMake(0, NSUIntegerMax, 1, 1) onPage:pdfPage];
                        } else {
                            CGRect pdfPageRect = [pdfPage boundsForBox:kPDFDisplayBoxCropBox];
                            if (pdfPage.rotation == 90 || pdfPage.rotation == 270) {
                                pdfPageRect = CGRectMake(0, 0, pdfPageRect.size.height, pdfPageRect.size.width);
                            }
                            CGPoint pointLeftTop = CGPointMake(0, pdfPageRect.size.height);
                            PDFDestination *pdfDest = [[PDFDestination alloc] initWithPage:pdfPage atPoint:pointLeftTop];
                            [self->_pdfView goToDestination:pdfDest];
                            self->_pdfView.scaleFactor = self->_fixScaleFactor * self->_scale;
                        }
                    }
                    
                    self->_previousPage = self->_page;
                    self->_isNavigating = NO;
                });
            } else {
                _isNavigating = NO;
            }
        }
        
        // Handle initial page on document load (only when path changes)
        // This handles the case where the document was just loaded and we need to navigate to the initial page
        // Use pathActuallyChanged instead of checking changedProps to ensure we only handle initial page when path actually changed
        if (_pdfDocument && pathActuallyChanged && _documentLoaded) {
            PDFPage *pdfPage = [_pdfDocument pageAtIndex:_page-1];
            if (pdfPage && _page == 1) {
                // Special case workaround for first page alignment
                dispatch_async(dispatch_get_main_queue(), ^{
                    [self->_pdfView goToRect:CGRectMake(0, NSUIntegerMax, 1, 1) onPage:pdfPage];
                    self->_previousPage = self->_page;
                });
            } else if (pdfPage) {
                CGRect pdfPageRect = [pdfPage boundsForBox:kPDFDisplayBoxCropBox];
                if (pdfPage.rotation == 90 || pdfPage.rotation == 270) {
                    pdfPageRect = CGRectMake(0, 0, pdfPageRect.size.height, pdfPageRect.size.width);
                }
                CGPoint pointLeftTop = CGPointMake(0, pdfPageRect.size.height);
                PDFDestination *pdfDest = [[PDFDestination alloc] initWithPage:pdfPage atPoint:pointLeftTop];
                [_pdfView goToDestination:pdfDest];
                _pdfView.scaleFactor = _fixScaleFactor*_scale;
                _previousPage = _page;
            }
        }

        _pdfView.backgroundColor = [UIColor clearColor];
        [_pdfView layoutDocumentView];
        [self setNeedsDisplay];
    }
}


- (void)reactSetFrame:(CGRect)frame
{
    [super reactSetFrame:frame];
    _pdfView.frame = CGRectMake(0, 0, frame.size.width, frame.size.height);

    NSMutableArray *mProps = [_changedProps mutableCopy];
    if (_initialed) {
        [mProps removeObject:@"path"];
    }
    _initialed = YES;

    [self didSetProps:mProps];
    
    // Configure scroll view after layout to ensure it's found
    // This is important because PDFKit creates the scroll view lazily
    if (_documentLoaded && _pdfDocument) {
        dispatch_async(dispatch_get_main_queue(), ^{
            RCTLogInfo(@"🔍 [iOS Scroll] reactSetFrame called, configuring scroll view after layout");
            [self configureScrollView:self->_pdfView enabled:self->_scrollEnabled depth:0];
        });
    }
}


- (void)notifyOnChangeWithMessage:(NSString *)message
{
#ifdef RCT_NEW_ARCH_ENABLED
    if (_eventEmitter != nullptr) {
             std::dynamic_pointer_cast<const RNPDFPdfViewEventEmitter>(_eventEmitter)
                 ->onChange(RNPDFPdfViewEventEmitter::OnChange{.message = RCTStringFromNSString(message)});
           }
#else
    _onChange(@{ @"message": message});
#endif
}

- (void)dealloc{
    [_preloadQueue cancelAllOperations];
    _preloadQueue = nil;
    
    // Clear caches
    [_pageCache removeAllObjects];
    [_preloadedPages removeAllObjects];
    [_performanceMetrics removeAllObjects];
    [_searchCache removeAllObjects];

    _pdfDocument = Nil;
    _pdfView = Nil;

    //Remove notifications
    [[NSNotificationCenter defaultCenter] removeObserver:self name:@"PDFViewDocumentChangedNotification" object:nil];
    [[NSNotificationCenter defaultCenter] removeObserver:self name:@"PDFViewPageChangedNotification" object:nil];
    [[NSNotificationCenter defaultCenter] removeObserver:self name:@"PDFViewScaleChangedNotification" object:nil];

    _doubleTapRecognizer = nil;
    _singleTapRecognizer = nil;
    _longPressRecognizer = nil;
    _doubleTapEmptyRecognizer = nil;
}

#pragma mark notification process
- (void)onDocumentChanged:(NSNotification *)noti
{

    if (_pdfDocument) {

        unsigned long numberOfPages = _pdfDocument.pageCount;
        PDFPage *page = [_pdfDocument pageAtIndex:_pdfDocument.pageCount-1];
        CGSize pageSize = [_pdfView rowSizeForPage:page];
        NSString *jsonString = [self getTableContents];
        
        // Include path in loadComplete message for consistency with Android and reliable path access in JS
        // Format: loadComplete|numberOfPages|width|height|path|tableContents
        NSString *pathValue = @"";
        if (_path != nil && _path.length > 0) {
            pathValue = _path;
        } else if (_pdfDocument.documentURL != nil) {
            // Fallback: try to get path from document URL
            pathValue = _pdfDocument.documentURL.path;
        }
        
        // Debug logging to verify path is being included (using RCTLog so it shows in all builds)
        RCTLogInfo(@"🔍 [iOS] loadComplete: numberOfPages=%lu, width=%f, height=%f, path='%@', pathLength=%lu", 
                   numberOfPages, pageSize.width, pageSize.height, pathValue, (unsigned long)pathValue.length);
        
        // Ensure path is always included in message (even if empty) for consistent parsing
        // Format: loadComplete|numberOfPages|width|height|path|tableContents
        // Use explicit format to ensure path segment is always present
        NSString *message = [NSString stringWithFormat:@"loadComplete|%lu|%f|%f|%@|%@", 
                            numberOfPages, pageSize.width, pageSize.height, 
                            (pathValue != nil ? pathValue : @""), jsonString];
        
        RCTLogInfo(@"🔍 [iOS] loadComplete message: %@", message);
        
        [self notifyOnChangeWithMessage:message];
        
        // Store local path so we can register when pdfId is set (Fabric may set pdfId after document load)
        _lastLoadedPath = [pathValue copy];
        // Register path for searchTextDirect (iOS parity with Android)
        if (_pdfId.length && pathValue.length) {
            [SearchRegistry registerPath:_pdfId path:pathValue];
            RCTLogInfo(@"✅ [iOS] SearchRegistry registered path for pdfId: %@ (from onDocumentChanged)", _pdfId);
        }
    }

}

- (void)setPdfId:(NSString *)pdfId {
    if (_pdfId.length && ![pdfId isEqualToString:_pdfId]) {
        [SearchRegistry unregisterPath:_pdfId];
    }
    _pdfId = [pdfId copy];
    // If document already loaded, register path now (Fabric may set pdfId after path/document load).
    // Only register local file paths; never register URIs (http/https) - PDFDocument needs file path.
    NSString *pathToRegister = nil;
    if (_lastLoadedPath.length > 0) {
        pathToRegister = _lastLoadedPath;
    } else if (_path.length > 0 && [_path hasPrefix:@"/"]) {
        pathToRegister = _path;
    }
    if (_pdfId.length && pathToRegister.length > 0) {
        [SearchRegistry registerPath:_pdfId path:pathToRegister];
        RCTLogInfo(@"✅ [iOS] SearchRegistry registered path for pdfId: %@ (from setPdfId)", _pdfId);
    }
}

- (void)setHighlightRects:(NSArray *)highlightRects {
    _highlightRects = [highlightRects copy];
    if (!_pdfView) return;
    if (_highlightRects.count > 0) {
        if (!_highlightOverlay) {
            _highlightOverlay = [[HighlightOverlayView alloc] initWithFrame:_pdfView.bounds];
            _highlightOverlay.backgroundColor = [UIColor clearColor];
            _highlightOverlay.userInteractionEnabled = NO;
            _highlightOverlay.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
            _highlightOverlay.pdfView = _pdfView;
            [_pdfView addSubview:_highlightOverlay];
            [_pdfView bringSubviewToFront:_highlightOverlay];
        }
        _highlightOverlay.highlightRects = _highlightRects;
        [_highlightOverlay setNeedsDisplay];
    } else if (_highlightOverlay) {
        _highlightOverlay.highlightRects = @[];
        [_highlightOverlay setNeedsDisplay];
    }
}

-(NSString *) getTableContents
{

    NSMutableArray<PDFOutline *> *arrTableOfContents = [[NSMutableArray alloc] init];

    if (_pdfDocument.outlineRoot) {

        PDFOutline *currentRoot = _pdfDocument.outlineRoot;
        NSMutableArray<PDFOutline *> *stack = [[NSMutableArray alloc] init];

        [stack addObject:currentRoot];

        while (stack.count > 0) {

            PDFOutline *currentOutline = stack.lastObject;
            [stack removeLastObject];

            if (currentOutline.label.length > 0){
                [arrTableOfContents addObject:currentOutline];
            }

            for ( NSInteger i= currentOutline.numberOfChildren; i > 0; i-- )
            {
                [stack addObject:[currentOutline childAtIndex:i-1]];
            }
        }
    }

    NSMutableArray *arrParentsContents = [[NSMutableArray alloc] init];

    for ( NSInteger i= 0; i < arrTableOfContents.count; i++ )
    {
        PDFOutline *currentOutline = [arrTableOfContents objectAtIndex:i];

        NSInteger indentationLevel = -1;

        PDFOutline *parentOutline = currentOutline.parent;

        while (parentOutline != nil) {
            indentationLevel += 1;
            parentOutline = parentOutline.parent;
        }

        if (indentationLevel == 0) {

            NSMutableDictionary *DXParentsContent = [[NSMutableDictionary alloc] init];

            [DXParentsContent setObject:[[NSMutableArray alloc] init] forKey:@"children"];
            [DXParentsContent setObject:@"" forKey:@"mNativePtr"];
            [DXParentsContent setObject:[NSString stringWithFormat:@"%lu", [_pdfDocument indexForPage:currentOutline.destination.page]] forKey:@"pageIdx"];
            [DXParentsContent setObject:currentOutline.label forKey:@"title"];

            //currentOutlin
            //mNativePtr
            [arrParentsContents addObject:DXParentsContent];
        }
        else {
            NSMutableDictionary *DXParentsContent = [arrParentsContents lastObject];

            NSMutableArray *arrChildren = [DXParentsContent valueForKey:@"children"];

            while (indentationLevel > 1) {
                NSMutableDictionary *DXchild = [arrChildren lastObject];
                arrChildren = [DXchild valueForKey:@"children"];
                indentationLevel--;
            }

            NSMutableDictionary *DXChildContent = [[NSMutableDictionary alloc] init];
            [DXChildContent setObject:[[NSMutableArray alloc] init] forKey:@"children"];
            [DXChildContent setObject:@"" forKey:@"mNativePtr"];
            [DXChildContent setObject:[NSString stringWithFormat:@"%lu", [_pdfDocument indexForPage:currentOutline.destination.page]] forKey:@"pageIdx"];
            [DXChildContent setObject:currentOutline.label forKey:@"title"];
            [arrChildren addObject:DXChildContent];

        }
    }

    NSError *error;
    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:arrParentsContents options:NSJSONWritingPrettyPrinted error:&error];

    NSString *jsonString = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];

    return jsonString;

}

- (void)onPageChanged:(NSNotification *)noti
{

    if (_pdfDocument) {
        PDFPage *currentPage = _pdfView.currentPage;
        unsigned long page = [_pdfDocument indexForPage:currentPage];
        unsigned long numberOfPages = _pdfDocument.pageCount;

        // Update current page for preloading
        int newPage = (int)page + 1;
        
        // CRITICAL FIX: Update _previousPage to the new page value when page changes from PDFView notifications
        // This prevents updateProps from triggering programmatic navigation when React Native
        // receives the pageChanged notification and updates the page prop back to us.
        // By setting _previousPage = newPage, when updateProps checks _page != _previousPage,
        // they will be equal (since the page prop will match the new page), and navigation will be skipped.
        if (newPage != _page) {
            _previousPage = newPage;  // Set to newPage to prevent navigation loop
            _page = newPage;
        } else {
            // If page didn't actually change, just ensure _previousPage matches to prevent navigation
            _previousPage = _page;
        }
        
        _pageCount = (int)numberOfPages;
        if (_enablePreloading) {
            [self preloadAdjacentPages:_page];
        }

        RLog(@"Enhanced PDF: Navigated to page %d", _page);
        [self notifyOnChangeWithMessage:[[NSString alloc] initWithString:[NSString stringWithFormat:@"pageChanged|%lu|%lu", page+1, numberOfPages]]];
        if (_highlightOverlay) [_highlightOverlay setNeedsDisplay];
    }

}

- (void)onScaleChanged:(NSNotification *)noti
{
    if (_initialed && _fixScaleFactor>0) {
        float newScale = _pdfView.scaleFactor/_fixScaleFactor;
        // Only notify if scale changed significantly (threshold of 0.01 to prevent excessive callbacks)
        if (fabs(_scale - newScale) > 0.01f) {
            _scale = newScale;
            [self notifyOnChangeWithMessage:[[NSString alloc] initWithString:[NSString stringWithFormat:@"scaleChanged|%f", _scale]]];
        }
    }
    if (_highlightOverlay) [_highlightOverlay setNeedsDisplay];
}

#pragma mark gesture process

/**
 *  Empty double tap handler
 *
 *
 */
- (void)handleDoubleTapEmpty:(UITapGestureRecognizer *)recognizer {}

/**
 *  Tap
 *  zoom reset or zoom in
 *
 *  @param recognizer The tap gesture recognizer
 */
- (void)handleDoubleTap:(UITapGestureRecognizer *)recognizer
{

    // Prevent double tap from selecting text.
    dispatch_async(dispatch_get_main_queue(), ^{
        [self->_pdfView clearSelection];
    });

    // Event appears to be consumed; broadcast for JS.
    // _onChange(@{ @"message": @"pageDoubleTap" });

    if (!_enableDoubleTapZoom) {
        return;
    }

    // Cycle through min/mid/max scale factors to be consistent with Android
    float min = self->_pdfView.minScaleFactor/self->_fixScaleFactor;
    float max = self->_pdfView.maxScaleFactor/self->_fixScaleFactor;
    float mid = (max - min) / 2 + min;
    float scale = self->_scale;
    if (self->_scale < mid) {
        scale = mid;
    } else if (self->_scale < max) {
        scale = max;
    } else {
        scale = min;
    }

    CGFloat newScale = scale * self->_fixScaleFactor;
    CGPoint tapPoint = [recognizer locationInView:self->_pdfView];

    PDFPage *tappedPdfPage = [_pdfView pageForPoint:tapPoint nearest:NO];
    PDFPage *pageRef;
    if (tappedPdfPage) {
        pageRef = tappedPdfPage;
    }   else {
        pageRef = self->_pdfView.currentPage;
    }
    tapPoint = [self->_pdfView convertPoint:tapPoint toPage:pageRef];

    CGRect tempZoomRect = CGRectZero;
    tempZoomRect.size.width = self->_pdfView.frame.size.width;
    tempZoomRect.size.height = 1;
    tempZoomRect.origin = tapPoint;

    dispatch_async(dispatch_get_main_queue(), ^{
        [UIView animateWithDuration:0.3 animations:^{
            [self->_pdfView setScaleFactor:newScale];

            [self->_pdfView goToRect:tempZoomRect onPage:pageRef];
            CGPoint defZoomOrigin = [self->_pdfView convertPoint:tempZoomRect.origin fromPage:pageRef];
            defZoomOrigin.x = defZoomOrigin.x - self->_pdfView.frame.size.width / 2;
            defZoomOrigin.y = defZoomOrigin.y - self->_pdfView.frame.size.height / 2;
            defZoomOrigin = [self->_pdfView convertPoint:defZoomOrigin toPage:pageRef];
            CGRect defZoomRect =  CGRectOffset(
                tempZoomRect,
                defZoomOrigin.x - tempZoomRect.origin.x,
                defZoomOrigin.y - tempZoomRect.origin.y
            );
            [self->_pdfView goToRect:defZoomRect onPage:pageRef];

            [self setNeedsDisplay];
            [self onScaleChanged:Nil];
        }];
    });
}

/**
 *  Single Tap
 *  stop zoom
 *
 *  @param sender The tap gesture recognizer
 */
- (void)handleSingleTap:(UITapGestureRecognizer *)sender
{
    //_pdfView.scaleFactor = _pdfView.minScaleFactor;

    CGPoint point = [sender locationInView:self];
    PDFPage *pdfPage = [_pdfView pageForPoint:point nearest:NO];
    if (pdfPage) {
        unsigned long page = [_pdfDocument indexForPage:pdfPage];
        [self notifyOnChangeWithMessage:
         [[NSString alloc] initWithString:[NSString stringWithFormat:@"pageSingleTap|%lu|%f|%f", page+1, point.x, point.y]]];
    }

    //[self setNeedsDisplay];
    //[self onScaleChanged:Nil];


}

/**
 *  Do nothing on long Press
 *
 *
 */
- (void)handleLongPress:(UILongPressGestureRecognizer *)sender{

}

/**
 *  Bind tap
 *
 *
 */
- (void)bindTap
{
    UITapGestureRecognizer *doubleTapRecognizer = [[UITapGestureRecognizer alloc] initWithTarget:self
                                                                                          action:@selector(handleDoubleTap:)];
    //trigger by one finger and double touch
    doubleTapRecognizer.numberOfTapsRequired = 2;
    doubleTapRecognizer.numberOfTouchesRequired = 1;
    doubleTapRecognizer.delegate = self;

    [self addGestureRecognizer:doubleTapRecognizer];
    _doubleTapRecognizer = doubleTapRecognizer;

    UITapGestureRecognizer *singleTapRecognizer = [[UITapGestureRecognizer alloc] initWithTarget:self
                                                                                          action:@selector(handleSingleTap:)];
    //trigger by one finger and one touch
    singleTapRecognizer.numberOfTapsRequired = 1;
    singleTapRecognizer.numberOfTouchesRequired = 1;
    singleTapRecognizer.delegate = self;

    [self addGestureRecognizer:singleTapRecognizer];
    _singleTapRecognizer = singleTapRecognizer;

    [singleTapRecognizer requireGestureRecognizerToFail:doubleTapRecognizer];

    UILongPressGestureRecognizer *longPressRecognizer = [[UILongPressGestureRecognizer alloc] initWithTarget:self
                                                                                            action:@selector(handleLongPress:)];
    // Making sure the allowable movement isn not too narrow
    longPressRecognizer.allowableMovement=100;
    // Important: The duration must be long enough to allow taps but not longer than the period in which view opens the magnifying glass
    longPressRecognizer.minimumPressDuration=0.3;

    [self addGestureRecognizer:longPressRecognizer];
    _longPressRecognizer = longPressRecognizer;

    // Override the _pdfView double tap gesture recognizer so that it doesn't confilict with custom double tap
    UITapGestureRecognizer *doubleTapEmptyRecognizer = [[UITapGestureRecognizer alloc] initWithTarget:self
                                                                                          action:@selector(handleDoubleTapEmpty:)];
    doubleTapEmptyRecognizer.numberOfTapsRequired = 2;
    [_pdfView addGestureRecognizer:doubleTapEmptyRecognizer];
    _doubleTapEmptyRecognizer = doubleTapEmptyRecognizer;
}

- (BOOL)gestureRecognizerShouldBegin:(UIGestureRecognizer *)gestureRecognizer

{
    return !_singlePage;
}

- (BOOL)gestureRecognizer:(UIGestureRecognizer *)gestureRecognizer shouldRecognizeSimultaneouslyWithGestureRecognizer:(UIGestureRecognizer *)otherGestureRecognizer
{
    return !_singlePage;
}

- (void)setScrollIndicators:(UIView *)view horizontal:(BOOL)horizontal vertical:(BOOL)vertical depth:(int)depth {
    // max depth, prevent infinite loop
    if (depth > 10) {
        return;
    }
    
    if ([view isKindOfClass:[UIScrollView class]]) {
        UIScrollView *scrollView = (UIScrollView *)view;
        scrollView.showsHorizontalScrollIndicator = horizontal;
        scrollView.showsVerticalScrollIndicator = vertical;
    }
    
    for (UIView *subview in view.subviews) {
        [self setScrollIndicators:subview horizontal:horizontal vertical:vertical depth:depth + 1];
    }
}

- (void)configureScrollView:(UIView *)view enabled:(BOOL)enabled depth:(int)depth {
    // Log entry to track all calls
    if (depth == 0) {
        RCTLogInfo(@"🚀 [iOS Scroll] configureScrollView called - enabled=%d, view=%@", enabled, NSStringFromClass([view class]));
    }
    
    // max depth, prevent infinite loop
    if (depth > 10) {
        RCTLogWarn(@"⚠️ [iOS Scroll] Max depth reached in configureScrollView (depth=%d)", depth);
        return;
    }
    
    if ([view isKindOfClass:[UIScrollView class]]) {
        UIScrollView *scrollView = (UIScrollView *)view;
        RCTLogInfo(@"📱 [iOS Scroll] Found UIScrollView at depth=%d, frame=%@, contentSize=%@, enabled=%d", 
                  depth, 
                  NSStringFromCGRect(scrollView.frame),
                  NSStringFromCGSize(scrollView.contentSize),
                  enabled);
        
        // Since we're starting the recursion from _pdfView, all scroll views found are within its hierarchy
        // Configure scroll properties
        BOOL previousScrollEnabled = scrollView.scrollEnabled;
        scrollView.scrollEnabled = enabled;
        
        if (previousScrollEnabled != enabled) {
            RCTLogInfo(@"🔄 [iOS Scroll] Changed scrollEnabled: %d -> %d", previousScrollEnabled, enabled);
        }
        
        // Conditionally set horizontal bouncing based on scroll direction
        // Allow horizontal bounce when horizontal scrolling is enabled
        BOOL previousAlwaysBounceHorizontal = scrollView.alwaysBounceHorizontal;
        if (_horizontal) {
            scrollView.alwaysBounceHorizontal = YES;
        } else {
            // Disable horizontal bouncing for vertical scrolling to prevent interference with navigation swipe-back
        scrollView.alwaysBounceHorizontal = NO;
        }
        
        if (previousAlwaysBounceHorizontal != scrollView.alwaysBounceHorizontal) {
            RCTLogInfo(@"🔄 [iOS Scroll] Changed alwaysBounceHorizontal: %d -> %d (horizontal=%d)", 
                      previousAlwaysBounceHorizontal, 
                      scrollView.alwaysBounceHorizontal,
                      _horizontal);
        }
        
        // Keep vertical bounce enabled for natural scrolling feel
        scrollView.bounces = YES;
        
        // Configure scroll view zoom scales to match PDFView's scale factors
        // This enables native pinch-to-zoom gestures
        if (_fixScaleFactor > 0) {
            scrollView.minimumZoomScale = _fixScaleFactor * _minScale;
            scrollView.maximumZoomScale = _fixScaleFactor * _maxScale;
            scrollView.zoomScale = _pdfView.scaleFactor;
            RCTLogInfo(@"🔍 [iOS Zoom] Configured zoom scales - min=%f, max=%f, current=%f", 
                      scrollView.minimumZoomScale, 
                      scrollView.maximumZoomScale, 
                      scrollView.zoomScale);
        }
        
        RCTLogInfo(@"📊 [iOS Scroll] ScrollView config - scrollEnabled=%d, alwaysBounceHorizontal=%d, bounces=%d, delegate=%@", 
                  scrollView.scrollEnabled,
                  scrollView.alwaysBounceHorizontal,
                  scrollView.bounces,
                  scrollView.delegate != nil ? @"set" : @"nil");
        
        // IMPORTANT: PDFKit relies on the scrollView delegate for pinch-zoom (viewForZoomingInScrollView).
        // Install a proxy delegate that forwards to the original delegate, while still letting us observe scroll events.
        // CRITICAL FIX: Always set up delegate for new scroll views (PDFView may recreate scroll view on document load)
        if (!_internalScrollView || _internalScrollView != scrollView) {
            RCTLogInfo(@"✅ [iOS Scroll] Setting up scroll view delegate (new=%d)", _internalScrollView == nil);
            _internalScrollView = scrollView;
            
            // Get the current delegate (might be PDFView's internal delegate)
            id<UIScrollViewDelegate> currentDelegate = scrollView.delegate;
            
            // Only capture original delegate if it's not us or our proxy
            if (currentDelegate && currentDelegate != self && ![currentDelegate isKindOfClass:[RNPDFScrollViewDelegateProxy class]]) {
                _originalScrollDelegate = currentDelegate;
                RCTLogInfo(@"📝 [iOS Scroll] Captured original scroll delegate: %@", NSStringFromClass([currentDelegate class]));
            }
            
            if (_originalScrollDelegate) {
                _scrollDelegateProxy = [[RNPDFScrollViewDelegateProxy alloc] initWithPrimary:_originalScrollDelegate secondary:(id<UIScrollViewDelegate>)self];
                scrollView.delegate = (id<UIScrollViewDelegate>)_scrollDelegateProxy;
                RCTLogInfo(@"🔗 [iOS Scroll] Installed scroll delegate proxy");
            } else {
                scrollView.delegate = self;
                RCTLogInfo(@"🔗 [iOS Scroll] Set self as scroll delegate (no original delegate)");
            }
        } else {
            RCTLogInfo(@"⚠️ [iOS Scroll] Same scroll view, delegate already configured");
        }
    }
    
    for (UIView *subview in view.subviews) {
        [self configureScrollView:subview enabled:enabled depth:depth + 1];
    }
    
    // Log at root level if no scroll view was found
    if (depth == 0 && !_internalScrollView) {
        RCTLogWarn(@"⚠️ [iOS Scroll] No UIScrollView found in view hierarchy (view=%@, subviewCount=%lu)", 
                  NSStringFromClass([view class]), 
                  (unsigned long)[view.subviews count]);
    }
}

#pragma mark - UIScrollViewDelegate

- (void)scrollViewDidScroll:(UIScrollView *)scrollView {
    // Redraw highlight overlay so rects stay aligned when user scrolls (pan)
    if (_highlightOverlay) [_highlightOverlay setNeedsDisplay];
    static int scrollEventCount = 0;
    scrollEventCount++;

    // Log scroll events periodically (every 10th event to avoid spam)
    if (scrollEventCount % 10 == 0) {
        RCTLogInfo(@"📜 [iOS Scroll] scrollViewDidScroll #%d - offset=(%.2f, %.2f), contentSize=(%.2f, %.2f), bounds=(%.2f, %.2f), scrollEnabled=%d", 
                  scrollEventCount,
                  scrollView.contentOffset.x,
                  scrollView.contentOffset.y,
                  scrollView.contentSize.width,
                  scrollView.contentSize.height,
                  scrollView.bounds.size.width,
                  scrollView.bounds.size.height,
                  scrollView.scrollEnabled);
    }

    if (!_pdfDocument || _singlePage) {
        if (scrollEventCount % 10 == 0) {
            RCTLogInfo(@"⏭️ [iOS Scroll] Skipping scroll handling - pdfDocument=%d, singlePage=%d", 
                      _pdfDocument != nil, _singlePage);
        }
        return;
    }
    
    // Calculate visible page based on scroll position
    // Use the center point of the visible viewport
    CGPoint centerPoint = CGPointMake(
        scrollView.contentOffset.x + scrollView.bounds.size.width / 2,
        scrollView.contentOffset.y + scrollView.bounds.size.height / 2
    );
    
    // Convert to PDFView coordinates
    CGPoint pdfPoint = [scrollView convertPoint:centerPoint toView:_pdfView];
    PDFPage *visiblePage = [_pdfView pageForPoint:pdfPoint nearest:YES];
    
    if (visiblePage) {
        unsigned long pageIndex = [_pdfDocument indexForPage:visiblePage];
        int newPage = (int)pageIndex + 1;
        
        // Only update if page actually changed and is valid
        if (newPage != _page && newPage > 0 && newPage <= (int)_pdfDocument.pageCount) {
            RCTLogInfo(@"📄 [iOS Scroll] Page changed: %d -> %d (from scroll position)", _page, newPage);
            
            // CRITICAL FIX: Update _previousPage to the new page value when page changes from user scrolling
            // This prevents updateProps from triggering programmatic navigation when React Native
            // receives the pageChanged notification and updates the page prop back to us.
            // By setting _previousPage = newPage, when updateProps checks _page != _previousPage,
            // they will be equal (since React Native will set _page = newPage), and navigation will be skipped.
            int oldPage = _page;
            _page = newPage;
            _previousPage = newPage;  // Set to newPage to prevent navigation loop
            _pageCount = (int)_pdfDocument.pageCount;
            
            // Trigger preloading if enabled
            if (_enablePreloading) {
                [self preloadAdjacentPages:_page];
            }
            
            // Notify about page change
            [self notifyOnChangeWithMessage:[[NSString alloc] initWithString:[NSString stringWithFormat:@"pageChanged|%d|%lu", newPage, _pdfDocument.pageCount]]];
        }
    } else {
        if (scrollEventCount % 50 == 0) {
            RCTLogWarn(@"⚠️ [iOS Scroll] No visible page found for scroll position (%.2f, %.2f)", 
                      pdfPoint.x, pdfPoint.y);
        }
    }
}

#pragma mark - UIScrollViewDelegate Zoom Support

- (void)scrollViewDidZoom:(UIScrollView *)scrollView {
    // Called during pinch-to-zoom — redraw highlight overlay so rects stay aligned with zoomed content
    if (_highlightOverlay) [_highlightOverlay setNeedsDisplay];
    if (_fixScaleFactor > 0 && _pdfView.scaleFactor > 0) {
        float newScale = _pdfView.scaleFactor / _fixScaleFactor;

        // Only notify if scale changed significantly (prevent spam)
        if (fabs(_scale - newScale) > 0.01f) {
            _scale = newScale;
            RCTLogInfo(@"🔍 [iOS Zoom] Pinch zoom - scale changed to %f", _scale);
            [self notifyOnChangeWithMessage:[[NSString alloc] initWithString:
                [NSString stringWithFormat:@"scaleChanged|%f", _scale]]];
        }
    }
}

// CRITICAL: Return the view that should be zoomed
- (UIView *)viewForZoomingInScrollView:(UIScrollView *)scrollView {
    // Search for PDFDocumentView in the scroll view's hierarchy
    for (UIView *subview in scrollView.subviews) {
        NSString *className = NSStringFromClass([subview class]);
        if ([className containsString:@"PDFDocumentView"] || [className containsString:@"PDFPage"]) {
            RCTLogInfo(@"🔍 [iOS Zoom] viewForZoomingInScrollView returning: %@", className);
            return subview;
        }
    }
    
    // Fallback to first subview
    UIView *fallback = scrollView.subviews.firstObject;
    if (fallback) {
        RCTLogInfo(@"🔍 [iOS Zoom] viewForZoomingInScrollView using fallback: %@", NSStringFromClass([fallback class]));
        return fallback;
    }
    
    RCTLogInfo(@"⚠️ [iOS Zoom] viewForZoomingInScrollView returning NIL - no view to zoom!");
    return nil;
}

- (void)scrollViewWillBeginZooming:(UIScrollView *)scrollView withView:(UIView *)view {
    // Optional: Track zoom start
    RCTLogInfo(@"🔍 [iOS Zoom] Will begin zooming");
}

- (void)scrollViewDidEndZooming:(UIScrollView *)scrollView
                        withView:(UIView *)view
                         atScale:(CGFloat)scale {
    // Redraw highlight overlay so rects match final zoom level
    if (_highlightOverlay) [_highlightOverlay setNeedsDisplay];
    RCTLogInfo(@"🔍 [iOS Zoom] Did end zooming at scale %f", scale);
}

// Enhanced progressive loading methods
- (void)preloadAdjacentPages:(int)currentPage
{
    if (!_enablePreloading || !_pdfDocument) {
        return;
    }
    
    int startPage = MAX(1, currentPage - _preloadRadius);
    int endPage = MIN((int)_pdfDocument.pageCount, currentPage + _preloadRadius);
    
    for (int page = startPage; page <= endPage; page++) {
        if (![_preloadedPages containsObject:@(page)]) {
            [_preloadedPages addObject:@(page)];
            
            // Add preload operation to queue
            NSBlockOperation *preloadOp = [NSBlockOperation blockOperationWithBlock:^{
                // Preload page content (this is a simplified version)
                // In a real implementation, you might preload page thumbnails or other content
                RLog(@"Enhanced PDF: Preloading page %d", page);
            }];
            
            [_preloadQueue addOperation:preloadOp];
        }
    }
}

- (NSDictionary *)getPerformanceMetrics
{
    NSMutableDictionary *metrics = [_performanceMetrics mutableCopy];
    metrics[@"cacheHitCount"] = @([_pageCache count]);
    metrics[@"preloadedPages"] = @([_preloadedPages count]);
    metrics[@"cacheSize"] = @(_cacheSize);
    return metrics;
}

- (void)clearCache
{
    [_pageCache removeAllObjects];
    [_preloadedPages removeAllObjects];
    [_searchCache removeAllObjects];
    RLog(@"Enhanced PDF: Cache cleared");
}

- (void)preloadPagesFrom:(int)startPage to:(int)endPage
{
    if (!_enablePreloading || !_pdfDocument) {
        return;
    }
    
    int actualStartPage = MAX(1, startPage);
    int actualEndPage = MIN((int)_pdfDocument.pageCount, endPage);
    
    for (int page = actualStartPage; page <= actualEndPage; page++) {
        if (![_preloadedPages containsObject:@(page)]) {
            [_preloadedPages addObject:@(page)];
            RLog(@"Enhanced PDF: Preloading page %d", page);
        }
    }
}

- (NSDictionary *)searchText:(NSString *)searchTerm
{
    if (!searchTerm || searchTerm.length == 0 || !_pdfDocument) {
        return @{@"totalMatches": @0, @"results": @[]};
    }
    
    // Check cache first
    NSString *cacheKey = [NSString stringWithFormat:@"%@_%@", _currentPdfId, searchTerm];
    if (_searchCache[cacheKey]) {
        RLog(@"Enhanced PDF: Search cache hit for '%@'", searchTerm);
        return _searchCache[cacheKey];
    }
    
    NSMutableArray *results = [NSMutableArray array];
    int totalMatches = 0;
    
    for (int pageIndex = 0; pageIndex < _pdfDocument.pageCount; pageIndex++) {
        PDFPage *page = [_pdfDocument pageAtIndex:pageIndex];
        
        // Search for text in the page
        PDFSelection *selection = [page selectionForRange:NSMakeRange(0, page.string.length)];
        if (selection && selection.string.length > 0) {
            NSString *text = selection.string;
            if ([text localizedCaseInsensitiveContainsString:searchTerm]) {
                // Get the bounds of the selection
                CGRect selectionBounds = [selection boundsForPage:page];
                
                [results addObject:@{
                    @"page": @(pageIndex + 1),
                    @"text": text,
                    @"rect": NSStringFromCGRect(selectionBounds)
                }];
                totalMatches++;
            }
        }
    }
    
    NSDictionary *searchResults = @{
        @"totalMatches": @(totalMatches),
        @"results": results
    };
    
    // Cache the results
    _searchCache[cacheKey] = searchResults;
    
    RLog(@"Enhanced PDF: Search completed for '%@', found %d matches", searchTerm, totalMatches);
    return searchResults;
}

@end

#ifdef RCT_NEW_ARCH_ENABLED

#ifdef __cplusplus
extern "C" {
#endif

Class<RCTComponentViewProtocol> RNPDFPdfViewCls(void)
{
    // Defensive check: Ensure class is loaded and valid before returning
    // This prevents nil object insertion in RCTThirdPartyComponentsProvider
    Class cls = RNPDFPdfView.class;
    if (cls == nil) {
        RCTLogError(@"RNPDFPdfView: Class is nil in RNPDFPdfViewCls");
        // Return a fallback to prevent crash, though this shouldn't happen
        return [RCTViewComponentView class];
    }
    return cls;
}

// Alias function based on codegen name "rnpdf" - ensures codegen can find the function
// even if it uses the codegen name instead of componentProvider name
Class<RCTComponentViewProtocol> rnpdfCls(void)
{
    return RNPDFPdfViewCls();
}

#ifdef __cplusplus
}
#endif

#endif
