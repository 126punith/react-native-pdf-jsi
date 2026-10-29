#import "RNPDFPdfView.h"

#import <PDFKit/PDFKit.h>
#import <React/RCTConversions.h>
#import <React/RCTFabricComponentsPlugins.h>
#import <react/renderer/components/rnpdf/ComponentDescriptors.h>
#import <react/renderer/components/rnpdf/EventEmitters.h>
#import <react/renderer/components/rnpdf/Props.h>
#import <react/renderer/components/rnpdf/RCTComponentViewHelpers.h>

using namespace facebook::react;

/// Scale events and the final page check wait this long after the last scroll or zoom change.
static const NSTimeInterval kSettleDelay = 0.15;

static void *kScrollOffsetContext = &kScrollOffsetContext;

static NSString *NormalizePath(NSString *path)
{
  if ([path hasPrefix:@"file://"]) {
    NSURL *url = [NSURL URLWithString:path];
    return url.path ?: [path substringFromIndex:7];
  }
  return path;
}

/// Display space: points from the top-left of the crop box as shown, rotation applied.
/// Same mapping as `PdfPageSpace` in HybridPdfDocument.swift.
static CGSize DisplaySize(PDFPage *page)
{
  CGRect box = [page boundsForBox:kPDFDisplayBoxCropBox];
  NSInteger rotation = ((page.rotation % 360) + 360) % 360;
  return rotation % 180 == 0 ? box.size : CGSizeMake(box.size.height, box.size.width);
}

static CGPoint PageToDisplay(PDFPage *page, CGPoint point)
{
  CGPoint rotated = CGPointApplyAffineTransform(point, [page transformForBox:kPDFDisplayBoxCropBox]);
  return CGPointMake(rotated.x, DisplaySize(page).height - rotated.y);
}

static CGRect DisplayToPage(PDFPage *page, CGRect rect)
{
  CGFloat height = DisplaySize(page).height;
  CGRect flipped = CGRectMake(rect.origin.x, height - rect.origin.y - rect.size.height, rect.size.width, rect.size.height);
  return CGRectApplyAffineTransform(flipped, CGAffineTransformInvert([page transformForBox:kPDFDisplayBoxCropBox]));
}

@interface RNPDFPdfView () <RCTRNPDFPdfViewViewProtocol, PDFViewDelegate, UIGestureRecognizerDelegate>
@end

@implementation RNPDFPdfView {
  PDFView *_pdfView;
  UITapGestureRecognizer *_tap;

  NSString *_path;
  NSString *_password;
  int _initialPage;
  float _initialScale;
  float _minScale;
  float _maxScale;
  BOOL _horizontal;
  BOOL _paging;
  BOOL _rtl;
  BOOL _singlePage;
  int _fitPolicy;
  int _spacing;
  BOOL _doubleTapZoom;
  BOOL _scrollEnabled;
  BOOL _annotations;
  BOOL _showsHorizontalIndicator;
  BOOL _showsVerticalIndicator;
  NSArray<NSDictionary *> *_highlights;

  NSUInteger _generation;
  PDFDocument *_document;
  NSMutableArray<PDFAnnotation *> *_highlightAnnotations;
  CGFloat _baseScale;
  BOOL _positioned;
  int _lastPage;
  float _lastScale;
  NSMutableArray<NSDictionary *> *_pendingEvents;
  UIScrollView *_observedScroll;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<RNPDFPdfViewComponentDescriptor>();
}

+ (BOOL)shouldBeRecycled
{
  return NO;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const RNPDFPdfViewProps>();
    _props = defaultProps;

    _initialScale = 1;
    _minScale = 1;
    _maxScale = 4;
    _spacing = 8;
    _doubleTapZoom = YES;
    _scrollEnabled = YES;
    _annotations = YES;
    _showsHorizontalIndicator = YES;
    _showsVerticalIndicator = YES;
    _highlights = @[];
    _highlightAnnotations = [NSMutableArray new];
    _pendingEvents = [NSMutableArray new];
    _lastPage = -1;
    _lastScale = NAN;

    _pdfView = [[PDFView alloc] initWithFrame:self.bounds];
    _pdfView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    _pdfView.backgroundColor = UIColor.clearColor;
    _pdfView.autoScales = NO;
    _pdfView.displayMode = kPDFDisplaySinglePageContinuous;
    _pdfView.displayBox = kPDFDisplayBoxCropBox;
    _pdfView.delegate = self;
    [self addSubview:_pdfView];

    _tap = [[UITapGestureRecognizer alloc] initWithTarget:self action:@selector(handleTap:)];
    _tap.delegate = self;
    [_pdfView addGestureRecognizer:_tap];

    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    [center addObserver:self selector:@selector(viewportChanged) name:PDFViewPageChangedNotification object:_pdfView];
    [center addObserver:self selector:@selector(viewportChanged) name:PDFViewScaleChangedNotification object:_pdfView];
    [center addObserver:self selector:@selector(viewportChanged) name:PDFViewVisiblePagesChangedNotification object:_pdfView];
  }
  return self;
}

- (void)dealloc
{
  [self stopObservingScroll];
  [NSNotificationCenter.defaultCenter removeObserver:self];
  [NSObject cancelPreviousPerformRequestsWithTarget:self];
}

#pragma mark - Props

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &next = *std::static_pointer_cast<const RNPDFPdfViewProps>(props);

  NSString *path = RCTNSStringFromStringNilIfEmpty(next.path);
  NSString *password = RCTNSStringFromStringNilIfEmpty(next.password);
  BOOL reload = !((path == _path || [path isEqualToString:_path]) &&
                  (password == _password || [password isEqualToString:_password]));
  BOOL relayout = _horizontal != next.horizontal || _paging != next.enablePaging || _rtl != next.enableRTL ||
      _singlePage != next.singlePage || _fitPolicy != next.fitPolicy || _spacing != next.spacing ||
      (_singlePage && _initialPage != next.initialPage);
  BOOL annotationsChanged = _annotations != next.enableAnnotationRendering;
  BOOL limitsChanged = _minScale != next.minScale || _maxScale != next.maxScale;

  _path = path;
  _password = password;
  _initialPage = MAX(0, next.initialPage);
  _initialScale = next.initialScale > 0 ? next.initialScale : 1;
  _minScale = next.minScale > 0 ? next.minScale : 1;
  _maxScale = next.maxScale > 0 ? next.maxScale : 4;
  _horizontal = next.horizontal;
  _paging = next.enablePaging;
  _rtl = next.enableRTL;
  _singlePage = next.singlePage;
  _fitPolicy = next.fitPolicy;
  _spacing = MAX(0, next.spacing);
  _doubleTapZoom = next.enableDoubleTapZoom;
  _scrollEnabled = next.scrollEnabled;
  _annotations = next.enableAnnotationRendering;
  _showsHorizontalIndicator = next.showsHorizontalScrollIndicator;
  _showsVerticalIndicator = next.showsVerticalScrollIndicator;

  NSMutableArray<NSDictionary *> *highlights = [NSMutableArray arrayWithCapacity:next.highlightRects.size()];
  for (const auto &rect : next.highlightRects) {
    [highlights addObject:@{
      @"page" : @(rect.page),
      @"rect" : [NSValue valueWithCGRect:CGRectMake(rect.x, rect.y, rect.width, rect.height)],
    }];
  }
  BOOL highlightsChanged = ![highlights isEqualToArray:_highlights];
  _highlights = highlights;

  [super updateProps:props oldProps:oldProps];

  if (reload) {
    [self load];
    return;
  }
  [self applyInteraction];
  if (relayout) {
    [self applyDisplay];
  } else if (limitsChanged) {
    [self applyScaleLimits];
  }
  if (annotationsChanged) {
    [self applyAnnotationVisibility];
  }
  if (highlightsChanged) {
    [self applyHighlights];
  }
}

#pragma mark - Commands

- (void)handleCommand:(const NSString *)commandName args:(const NSArray *)args
{
  RCTRNPDFPdfViewHandleCommand(self, commandName, args);
}

- (void)goToPage:(NSInteger)page animated:(BOOL)animated
{
  if (_document == nil || _document.pageCount == 0) {
    return;
  }
  NSInteger index = MIN(MAX(page, 0), (NSInteger)_document.pageCount - 1);
  PDFPage *target = [_document pageAtIndex:index];
  void (^go)(void) = ^{
    [self->_pdfView goToPage:target];
  };
  if (animated) {
    [UIView animateWithDuration:0.25 animations:go completion:^(BOOL finished) { [self scheduleSettle]; }];
  } else {
    go();
    [self scheduleSettle];
  }
}

- (void)zoomTo:(float)scale animated:(BOOL)animated
{
  if (_document == nil || _baseScale <= 0) {
    return;
  }
  CGFloat target = _baseScale * MIN(MAX(scale, _minScale), _maxScale);
  if (animated) {
    [UIView animateWithDuration:0.25 animations:^{ self->_pdfView.scaleFactor = target; }
                     completion:^(BOOL finished) { [self scheduleSettle]; }];
  } else {
    _pdfView.scaleFactor = target;
    [self scheduleSettle];
  }
}

#pragma mark - Document

- (void)load
{
  NSUInteger token = ++_generation;
  [self closeDocument];
  NSString *path = _path.length > 0 ? NormalizePath(_path) : nil;
  if (path == nil) {
    return;
  }
  NSString *password = _password;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSString *code = nil;
    NSString *message = nil;
    PDFDocument *document = nil;
    if (![NSFileManager.defaultManager fileExistsAtPath:path]) {
      code = @"invalid-source";
      message = [NSString stringWithFormat:@"File not found: %@", path];
    } else if ((document = [[PDFDocument alloc] initWithURL:[NSURL fileURLWithPath:path]]) == nil) {
      code = @"unsupported-pdf";
      message = [NSString stringWithFormat:@"Not a PDF or the file is damaged: %@", path];
    } else if (document.isLocked && ![document unlockWithPassword:@""]) {
      if (password.length == 0) {
        code = @"password-required";
      } else if (![document unlockWithPassword:password]) {
        code = @"password-incorrect";
      }
    }
    if (code == nil && document.pageCount == 0) {
      code = @"unsupported-pdf";
      message = @"The document has no pages";
    }
    dispatch_async(dispatch_get_main_queue(), ^{
      if (token != self->_generation) {
        return;
      }
      if ([code isEqualToString:@"password-required"] || [code isEqualToString:@"password-incorrect"]) {
        [self emit:@{@"type" : @"passwordRequired", @"incorrect" : @([code isEqualToString:@"password-incorrect"])}];
      } else if (code != nil) {
        [self emit:@{@"type" : @"error", @"code" : code, @"message" : message ?: @""}];
      } else {
        [self didOpen:document path:path];
      }
    });
  });
}

- (void)closeDocument
{
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(settle) object:nil];
  [self stopObservingScroll];
  [_highlightAnnotations removeAllObjects];
  _document = nil;
  _pdfView.document = nil;
  _positioned = NO;
  _baseScale = 0;
  _lastPage = -1;
  _lastScale = NAN;
}

- (void)didOpen:(PDFDocument *)document path:(NSString *)path
{
  _document = document;
  CGSize first = DisplaySize([document pageAtIndex:0]);
  NSMutableArray *outline = [NSMutableArray new];
  [self flattenOutline:document.outlineRoot level:-1 into:outline];
  [self emit:@{
    @"type" : @"load",
    @"pageCount" : @(document.pageCount),
    @"width" : @(first.width),
    @"height" : @(first.height),
    @"path" : path,
    @"outline" : outline,
  }];
  [self applyDisplay];
  [self applyAnnotationVisibility];
  [self applyHighlights];
}

- (void)flattenOutline:(PDFOutline *)node level:(NSInteger)level into:(NSMutableArray *)items
{
  if (node == nil) {
    return;
  }
  if (level >= 0) {
    PDFPage *page = node.destination.page ?: ([node.action isKindOfClass:PDFActionGoTo.class]
                                                  ? ((PDFActionGoTo *)node.action).destination.page
                                                  : nil);
    NSInteger index = page != nil ? (NSInteger)[_document indexForPage:page] : 0;
    [items addObject:@{@"title" : node.label ?: @"", @"page" : @(index == NSNotFound ? 0 : index), @"level" : @(level)}];
  }
  for (NSUInteger child = 0; child < node.numberOfChildren; child++) {
    [self flattenOutline:[node childAtIndex:child] level:level + 1 into:items];
  }
}

#pragma mark - Display

- (void)layoutSubviews
{
  [super layoutSubviews];
  _pdfView.frame = self.bounds;
  if (_document != nil && !CGRectIsEmpty(self.bounds)) {
    CGFloat relative = _baseScale > 0 ? _pdfView.scaleFactor / _baseScale : 0;
    [self computeBaseScale];
    if (_positioned && relative > 0) {
      [self applyScaleLimits];
      _pdfView.scaleFactor = _baseScale * relative;
    } else {
      [self applyDisplay];
    }
  }
}

- (void)computeBaseScale
{
  PDFPage *page = _singlePage ? [_document pageAtIndex:MIN((NSUInteger)_initialPage, _document.pageCount - 1)]
                              : [_document pageAtIndex:0];
  CGSize size = DisplaySize(page);
  CGSize viewport = self.bounds.size;
  if (size.width <= 0 || size.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    _baseScale = 1;
    return;
  }
  CGFloat width = viewport.width / size.width;
  CGFloat height = viewport.height / size.height;
  switch (_fitPolicy) {
    case 1:
      _baseScale = height;
      break;
    case 2:
      _baseScale = MIN(width, height);
      break;
    default:
      _baseScale = width;
      break;
  }
  if (_singlePage) {
    _baseScale = MIN(width, height);
  }
}

- (void)applyScaleLimits
{
  if (_baseScale <= 0) {
    return;
  }
  CGFloat minimum = _singlePage ? _baseScale : _baseScale * _minScale;
  CGFloat maximum = _singlePage ? _baseScale : _baseScale * _maxScale;
  _pdfView.minScaleFactor = MIN(minimum, _pdfView.maxScaleFactor);
  _pdfView.maxScaleFactor = maximum;
  _pdfView.minScaleFactor = minimum;
  _pdfView.scaleFactor = MIN(MAX(_pdfView.scaleFactor, minimum), maximum);
}

/// Applies layout props. Keeps the current page unless the document was just opened.
- (void)applyDisplay
{
  if (_document == nil || CGRectIsEmpty(self.bounds)) {
    return;
  }
  NSInteger anchor = _positioned ? [self currentPageIndex] : _initialPage;
  CGFloat relative = _positioned && _baseScale > 0 ? _pdfView.scaleFactor / _baseScale : _initialScale;

  [_pdfView usePageViewController:(_paging && !_singlePage) withViewOptions:nil];
  _pdfView.displayMode = _singlePage ? kPDFDisplaySinglePage : kPDFDisplaySinglePageContinuous;
  _pdfView.displayDirection = _horizontal ? kPDFDisplayDirectionHorizontal : kPDFDisplayDirectionVertical;
  _pdfView.displaysRTL = _rtl;
  _pdfView.displaysPageBreaks = !_singlePage;
  CGFloat half = _spacing / 2.0;
  _pdfView.pageBreakMargins = _horizontal ? UIEdgeInsetsMake(0, half, 0, half) : UIEdgeInsetsMake(half, 0, half, 0);
  if (_pdfView.document != _document) {
    _pdfView.document = _document;
  }

  [self computeBaseScale];
  [self applyScaleLimits];
  _pdfView.scaleFactor = _baseScale * (_singlePage ? 1 : MIN(MAX(relative, _minScale), _maxScale));
  [self applyInteraction];

  [_pdfView layoutDocumentView];
  PDFPage *page = [_document pageAtIndex:MIN(MAX(anchor, 0), (NSInteger)_document.pageCount - 1)];
  [_pdfView goToPage:page];
  [self centreCrossAxis];
  _positioned = YES;
  [self startObservingScroll];
  [self scheduleSettle];
}

/// PDFView keeps a stale offset across the scroll axis after a scale change; centre the content there.
- (void)centreCrossAxis
{
  UIScrollView *scroll = [self scrollView];
  if (scroll == nil || _paging) {
    return;
  }
  CGPoint offset = scroll.contentOffset;
  UIEdgeInsets inset = scroll.adjustedContentInset;
  if (_horizontal) {
    CGFloat spare = scroll.contentSize.height + inset.top + inset.bottom - scroll.bounds.size.height;
    offset.y = spare > 0 ? spare / 2 - inset.top : -inset.top;
  } else {
    CGFloat spare = scroll.contentSize.width + inset.left + inset.right - scroll.bounds.size.width;
    offset.x = spare > 0 ? spare / 2 - inset.left : -inset.left;
  }
  [scroll setContentOffset:offset animated:NO];
}

- (UIScrollView *)scrollView
{
  NSMutableArray<UIView *> *queue = [NSMutableArray arrayWithObject:_pdfView];
  while (queue.count > 0) {
    UIView *view = queue.firstObject;
    [queue removeObjectAtIndex:0];
    if ([view isKindOfClass:UIScrollView.class]) {
      return (UIScrollView *)view;
    }
    [queue addObjectsFromArray:view.subviews];
  }
  return nil;
}

- (void)applyInteraction
{
  BOOL interactive = !_singlePage;
  _pdfView.userInteractionEnabled = interactive;
  UIScrollView *scroll = [self scrollView];
  scroll.scrollEnabled = _scrollEnabled && interactive;
  scroll.showsHorizontalScrollIndicator = _showsHorizontalIndicator;
  scroll.showsVerticalScrollIndicator = _showsVerticalIndicator;
  [self setDoubleTapEnabled:_doubleTapZoom inView:_pdfView];
}

- (void)setDoubleTapEnabled:(BOOL)enabled inView:(UIView *)view
{
  for (UIGestureRecognizer *recognizer in view.gestureRecognizers) {
    if (recognizer != _tap && [recognizer isKindOfClass:UITapGestureRecognizer.class] &&
        ((UITapGestureRecognizer *)recognizer).numberOfTapsRequired == 2) {
      recognizer.enabled = enabled;
    }
  }
  for (UIView *child in view.subviews) {
    [self setDoubleTapEnabled:enabled inView:child];
  }
}

- (void)applyAnnotationVisibility
{
  for (NSUInteger index = 0; index < _document.pageCount; index++) {
    for (PDFAnnotation *annotation in [_document pageAtIndex:index].annotations) {
      if (![_highlightAnnotations containsObject:annotation]) {
        annotation.shouldDisplay = _annotations;
      }
    }
  }
}

/// Highlights are temporary annotations so PDFKit keeps them in place while scrolling and zooming.
- (void)applyHighlights
{
  for (PDFAnnotation *annotation in _highlightAnnotations) {
    [annotation.page removeAnnotation:annotation];
  }
  [_highlightAnnotations removeAllObjects];
  if (_document == nil) {
    return;
  }
  for (NSDictionary *item in _highlights) {
    NSInteger index = [item[@"page"] integerValue];
    if (index < 0 || index >= (NSInteger)_document.pageCount) {
      continue;
    }
    PDFPage *page = [_document pageAtIndex:index];
    CGRect bounds = DisplayToPage(page, [item[@"rect"] CGRectValue]);
    PDFAnnotation *annotation = [[PDFAnnotation alloc] initWithBounds:bounds forType:PDFAnnotationSubtypeSquare withProperties:nil];
    annotation.color = UIColor.clearColor;
    annotation.interiorColor = [UIColor colorWithRed:1 green:0.84 blue:0 alpha:0.35];
    PDFBorder *border = [PDFBorder new];
    border.lineWidth = 0;
    annotation.border = border;
    [page addAnnotation:annotation];
    [_highlightAnnotations addObject:annotation];
  }
}

#pragma mark - Events

- (NSInteger)currentPageIndex
{
  if (_document == nil) {
    return 0;
  }
  UIScrollView *scroll = [self scrollView];
  if (scroll != nil && !_paging) {
    CGFloat maxX = scroll.contentSize.width - scroll.bounds.size.width + scroll.adjustedContentInset.right;
    CGFloat maxY = scroll.contentSize.height - scroll.bounds.size.height + scroll.adjustedContentInset.bottom;
    BOOL atEnd = _horizontal ? (maxX > 1 && scroll.contentOffset.x >= maxX - 1) : (maxY > 1 && scroll.contentOffset.y >= maxY - 1);
    if (atEnd) {
      return _horizontal && _rtl ? 0 : (NSInteger)_document.pageCount - 1;
    }
  }
  CGPoint centre = CGPointMake(CGRectGetMidX(_pdfView.bounds), CGRectGetMidY(_pdfView.bounds));
  PDFPage *page = [_pdfView pageForPoint:centre nearest:YES] ?: _pdfView.currentPage;
  NSUInteger index = page != nil ? [_document indexForPage:page] : 0;
  return index == NSNotFound ? 0 : (NSInteger)index;
}

- (void)viewportChanged
{
  [self emitPageChangeIfNeeded];
  [self scheduleSettle];
}

/// Sends a page event when the page under the viewport centre changes, including mid-scroll.
- (void)emitPageChangeIfNeeded
{
  if (_document == nil || !_positioned || _baseScale <= 0) {
    return;
  }
  int page = (int)[self currentPageIndex];
  if (page != _lastPage) {
    _lastPage = page;
    [self emit:@{@"type" : @"pageChange", @"page" : @(page), @"pageCount" : @(_document.pageCount)}];
  }
}

/// PDFView only notifies when its own current page changes, so the scroll offset is observed directly.
/// The scroll view can be replaced when paging is toggled, hence the re-check on every layout pass.
- (void)startObservingScroll
{
  UIScrollView *scroll = [self scrollView];
  if (scroll == _observedScroll) {
    return;
  }
  [self stopObservingScroll];
  if (scroll == nil) {
    return;
  }
  [scroll addObserver:self forKeyPath:@"contentOffset" options:0 context:kScrollOffsetContext];
  _observedScroll = scroll;
}

- (void)stopObservingScroll
{
  if (_observedScroll == nil) {
    return;
  }
  [_observedScroll removeObserver:self forKeyPath:@"contentOffset" context:kScrollOffsetContext];
  _observedScroll = nil;
}

- (void)observeValueForKeyPath:(NSString *)keyPath
                      ofObject:(id)object
                        change:(NSDictionary<NSKeyValueChangeKey, id> *)change
                       context:(void *)context
{
  if (context == kScrollOffsetContext) {
    [self emitPageChangeIfNeeded];
  } else {
    [super observeValueForKeyPath:keyPath ofObject:object change:change context:context];
  }
}

- (void)scheduleSettle
{
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(settle) object:nil];
  [self performSelector:@selector(settle) withObject:nil afterDelay:kSettleDelay];
}

/// Sends page and scale events once scrolling and zooming have stopped.
- (void)settle
{
  if (_document == nil || !_positioned || _baseScale <= 0) {
    return;
  }
  UIScrollView *scroll = [self scrollView];
  if (scroll.isTracking || scroll.isDragging || scroll.isDecelerating || scroll.isZooming || scroll.isZoomBouncing) {
    [self scheduleSettle];
    return;
  }
  [self emitPageChangeIfNeeded];
  float scale = (float)(_pdfView.scaleFactor / _baseScale);
  if (isnan(_lastScale) || fabsf(_lastScale - scale) > 0.001f) {
    BOOL first = isnan(_lastScale);
    _lastScale = scale;
    if (!first || fabsf(scale - 1) > 0.001f) {
      [self emit:@{@"type" : @"scaleChange", @"scale" : @(scale)}];
    }
  }
}

- (void)handleTap:(UITapGestureRecognizer *)recognizer
{
  if (_document == nil || recognizer.state != UIGestureRecognizerStateEnded) {
    return;
  }
  CGPoint location = [recognizer locationInView:_pdfView];
  PDFPage *page = [_pdfView pageForPoint:location nearest:NO];
  if (page == nil) {
    return;
  }
  CGPoint pagePoint = [_pdfView convertPoint:location toPage:page];
  PDFAnnotation *annotation = [page annotationAtPoint:pagePoint];
  if (annotation != nil && [annotation.type isEqualToString:@"Link"]) {
    return; // PDFView follows internal links and reports URLs through the delegate.
  }
  CGPoint display = PageToDisplay(page, pagePoint);
  [self emit:@{
    @"type" : @"tap",
    @"page" : @([_document indexForPage:page]),
    @"x" : @(display.x),
    @"y" : @(display.y),
  }];
}

- (void)PDFViewWillClickOnLink:(PDFView *)sender withURL:(NSURL *)url
{
  [self emit:@{@"type" : @"link", @"url" : url.absoluteString ?: @""}];
}

- (BOOL)gestureRecognizer:(UIGestureRecognizer *)gestureRecognizer
    shouldRecognizeSimultaneouslyWithGestureRecognizer:(UIGestureRecognizer *)otherGestureRecognizer
{
  return YES;
}

- (BOOL)gestureRecognizer:(UIGestureRecognizer *)gestureRecognizer
    shouldRequireFailureOfGestureRecognizer:(UIGestureRecognizer *)otherGestureRecognizer
{
  return gestureRecognizer == _tap && _doubleTapZoom && [otherGestureRecognizer isKindOfClass:UITapGestureRecognizer.class] &&
      ((UITapGestureRecognizer *)otherGestureRecognizer).numberOfTapsRequired == 2;
}

- (void)updateEventEmitter:(EventEmitter::Shared const &)eventEmitter
{
  [super updateEventEmitter:eventEmitter];
  NSArray<NSDictionary *> *pending = [_pendingEvents copy];
  [_pendingEvents removeAllObjects];
  for (NSDictionary *event in pending) {
    [self emit:event];
  }
}

/// Events sent before Fabric hands over the emitter wait in `_pendingEvents`.
- (void)emit:(NSDictionary *)event
{
  if (_eventEmitter == nullptr) {
    [_pendingEvents addObject:event];
    return;
  }
  NSData *data = [NSJSONSerialization dataWithJSONObject:event options:0 error:nil];
  NSString *message = data != nil ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"{}";
  std::static_pointer_cast<const RNPDFPdfViewEventEmitter>(_eventEmitter)
      ->onChange(RNPDFPdfViewEventEmitter::OnChange{.message = RCTStringFromNSString(message)});
}

@end

Class<RCTComponentViewProtocol> RNPDFPdfViewCls(void)
{
  return RNPDFPdfView.class;
}
