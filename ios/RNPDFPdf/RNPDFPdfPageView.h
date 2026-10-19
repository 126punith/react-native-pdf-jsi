#pragma once

#import <React/RCTComponentViewProtocol.h>
#import <React/RCTViewComponentView.h>
#import <UIKit/UIKit.h>

#ifdef __cplusplus
extern "C" {
#endif

Class<RCTComponentViewProtocol> RNPDFPdfPageViewCls(void);

#ifdef __cplusplus
}
#endif

NS_ASSUME_NONNULL_BEGIN

/// Draws one page of a document that a PdfDocument has open, fitted and centred.
@interface RNPDFPdfPageView : RCTViewComponentView
@end

NS_ASSUME_NONNULL_END
