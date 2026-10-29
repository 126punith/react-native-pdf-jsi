#import "RNPDFPdfPageView.h"

#import <PDFKit/PDFKit.h>
#import <React/RCTConversions.h>
#import <React/RCTFabricComponentsPlugins.h>
#import <react/renderer/components/rnpdf/ComponentDescriptors.h>
#import <react/renderer/components/rnpdf/EventEmitters.h>
#import <react/renderer/components/rnpdf/Props.h>
#import <react/renderer/components/rnpdf/RCTComponentViewHelpers.h>

using namespace facebook::react;

/// Defined in HybridPdfDocument.swift. Returns a +1 retained PDFDocument or NULL.
extern "C" void *_Nullable RNPDFSharedDocument(const char *path);

@interface RNPDFPdfPageView () <RCTRNPDFPdfPageViewViewProtocol>
@end

@implementation RNPDFPdfPageView {
  UIImageView *_imageView;
  NSString *_path;
  NSInteger _page;
  NSInteger _revision;
  BOOL _annotations;
  NSUInteger _generation;
  CGSize _renderedSize;
  NSMutableArray<NSDictionary *> *_pendingEvents;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<RNPDFPdfPageViewComponentDescriptor>();
}

+ (BOOL)shouldBeRecycled
{
  return NO;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const RNPDFPdfPageViewProps>();
    _props = defaultProps;
    _annotations = YES;
    _pendingEvents = [NSMutableArray new];
    _imageView = [[UIImageView alloc] initWithFrame:self.bounds];
    _imageView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    _imageView.contentMode = UIViewContentModeScaleAspectFit;
    [self addSubview:_imageView];
  }
  return self;
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &next = *std::static_pointer_cast<const RNPDFPdfPageViewProps>(props);
  NSString *path = RCTNSStringFromStringNilIfEmpty(next.path);
  BOOL changed = !(path == _path || [path isEqualToString:_path]) || _page != next.page ||
      _revision != next.revision || _annotations != next.enableAnnotationRendering;
  _path = path;
  _page = next.page;
  _revision = next.revision;
  _annotations = next.enableAnnotationRendering;
  [super updateProps:props oldProps:oldProps];
  if (changed) {
    [self render];
  }
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  if (!CGSizeEqualToSize(self.bounds.size, _renderedSize)) {
    [self render];
  }
}

- (void)render
{
  NSUInteger token = ++_generation;
  CGSize size = self.bounds.size;
  NSString *path = _path;
  if (path.length == 0 || size.width <= 0 || size.height <= 0) {
    return;
  }
  _renderedSize = size;
  NSInteger index = _page;
  BOOL annotations = _annotations;
  CGFloat screenScale = self.traitCollection.displayScale > 0 ? self.traitCollection.displayScale : 2;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    void *raw = RNPDFSharedDocument(path.UTF8String);
    PDFDocument *document = raw ? (__bridge_transfer PDFDocument *)raw : nil;
    NSString *code = nil;
    NSString *message = nil;
    UIImage *image = nil;
    if (document == nil) {
      code = @"document-closed";
      message = [NSString stringWithFormat:@"Open the document with PdfLibrary before showing a PdfPage: %@", path];
    } else if (index < 0 || index >= (NSInteger)document.pageCount) {
      code = @"invalid-page";
      message = [NSString stringWithFormat:@"Page %ld is outside 0..%ld", (long)index, (long)document.pageCount - 1];
    } else {
      PDFPage *page = [document pageAtIndex:index];
      NSMutableArray<PDFAnnotation *> *hidden = [NSMutableArray new];
      if (!annotations) {
        for (PDFAnnotation *annotation in page.annotations) {
          if (annotation.shouldDisplay) {
            annotation.shouldDisplay = NO;
            [hidden addObject:annotation];
          }
        }
      }
      image = [page thumbnailOfSize:CGSizeMake(size.width * screenScale, size.height * screenScale) forBox:kPDFDisplayBoxCropBox];
      for (PDFAnnotation *annotation in hidden) {
        annotation.shouldDisplay = YES;
      }
      if (image == nil) {
        code = @"page-render-failed";
        message = [NSString stringWithFormat:@"Failed to render page %ld", (long)index];
      }
    }
    dispatch_async(dispatch_get_main_queue(), ^{
      if (token != self->_generation) {
        return;
      }
      if (image != nil) {
        self->_imageView.image = image;
        [self emit:@{
          @"type" : @"render",
          @"width" : @(image.size.width * image.scale),
          @"height" : @(image.size.height * image.scale),
        }];
      } else {
        [self emit:@{@"type" : @"error", @"code" : code, @"message" : message}];
      }
    });
  });
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

- (void)emit:(NSDictionary *)event
{
  if (_eventEmitter == nullptr) {
    [_pendingEvents addObject:event];
    return;
  }
  NSData *data = [NSJSONSerialization dataWithJSONObject:event options:0 error:nil];
  NSString *message = data != nil ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"{}";
  std::static_pointer_cast<const RNPDFPdfPageViewEventEmitter>(_eventEmitter)
      ->onChange(RNPDFPdfPageViewEventEmitter::OnChange{.message = RCTStringFromNSString(message)});
}

@end

Class<RCTComponentViewProtocol> RNPDFPdfPageViewCls(void)
{
  return RNPDFPdfPageView.class;
}
