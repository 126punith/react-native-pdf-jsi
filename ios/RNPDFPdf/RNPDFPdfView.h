#pragma once

#import <React/RCTComponentViewProtocol.h>
#import <React/RCTViewComponentView.h>
#import <UIKit/UIKit.h>

#ifdef __cplusplus
extern "C" {
#endif

Class<RCTComponentViewProtocol> RNPDFPdfViewCls(void);

#ifdef __cplusplus
}
#endif

NS_ASSUME_NONNULL_BEGIN

/// Fabric viewer on PDFKit. Events are JSON `onChange` messages matching `src/viewerEvents.ts`.
@interface RNPDFPdfView : RCTViewComponentView
@end

NS_ASSUME_NONNULL_END
