#import <UIKit/UIKit.h>

#if __has_include(<React/RCTBridgeModule.h>)
#import <React/RCTBridgeModule.h>
#else
#import "RCTBridgeModule.h"
#endif

static NSString *const PdfFileManagerSavedPathKey = @"saved_pdf_path";

@interface PdfFileManager : NSObject <RCTBridgeModule, UIDocumentPickerDelegate>
@end

@implementation PdfFileManager {
  RCTPromiseResolveBlock _pendingResolve;
  RCTPromiseRejectBlock _pendingReject;
  BOOL _rememberPickedPdf;
}

RCT_EXPORT_MODULE(FileManager);

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

- (dispatch_queue_t)methodQueue {
  return dispatch_get_main_queue();
}

RCT_EXPORT_METHOD(pickLocalPdf:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self startPick:YES resolve:resolve reject:reject];
}

RCT_EXPORT_METHOD(pickPdf:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self startPick:NO resolve:resolve reject:reject];
}

RCT_EXPORT_METHOD(savedLocalPdf:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  NSString *saved = [[NSUserDefaults standardUserDefaults] stringForKey:PdfFileManagerSavedPathKey];
  if (saved.length > 0 && [[NSFileManager defaultManager] fileExistsAtPath:saved]) {
    resolve(saved);
    return;
  }
  resolve(nil);
}

- (void)startPick:(BOOL)remember
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject {
  if (_pendingResolve != nil) {
    reject(@"PICK_IN_PROGRESS", @"A file picker is already open", nil);
    return;
  }

  UIViewController *presenter = [self topViewController];
  if (presenter == nil) {
    reject(@"NO_ACTIVITY", @"No current view controller to choose a PDF", nil);
    return;
  }

  _pendingResolve = resolve;
  _pendingReject = reject;
  _rememberPickedPdf = remember;

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  UIDocumentPickerViewController *picker =
      [[UIDocumentPickerViewController alloc] initWithDocumentTypes:@[@"com.adobe.pdf"]
                                                              inMode:UIDocumentPickerModeOpen];
#pragma clang diagnostic pop
  picker.delegate = self;
  picker.allowsMultipleSelection = NO;
  [presenter presentViewController:picker animated:YES completion:nil];
}

- (UIViewController *)topViewController {
  UIWindow *window = nil;
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (![scene isKindOfClass:[UIWindowScene class]]) {
      continue;
    }
    if (scene.activationState != UISceneActivationStateForegroundActive &&
        scene.activationState != UISceneActivationStateForegroundInactive) {
      continue;
    }
    UIWindowScene *windowScene = (UIWindowScene *)scene;
    for (UIWindow *candidate in windowScene.windows) {
      if (candidate.isKeyWindow) {
        window = candidate;
        break;
      }
    }
    if (window == nil) {
      window = windowScene.windows.firstObject;
    }
    if (window != nil) {
      break;
    }
  }

  UIViewController *controller = window.rootViewController;
  while (controller.presentedViewController != nil) {
    controller = controller.presentedViewController;
  }
  return controller;
}

- (void)documentPicker:(UIDocumentPickerViewController *)controller
    didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls {
  NSURL *url = urls.firstObject;
  if (url == nil) {
    [self finishRejected:@"PICK_CANCELLED" message:@"No PDF was selected"];
    return;
  }

  NSError *error = nil;
  NSString *copied = [self copyPickedURL:url error:&error];
  if (copied == nil) {
    [self finishRejected:@"CONTENT_COPY_FAILED" message:error.localizedDescription ?: @"Unable to copy the selected PDF"];
    return;
  }

  if (_rememberPickedPdf) {
    [[NSUserDefaults standardUserDefaults] setObject:copied forKey:PdfFileManagerSavedPathKey];
  }
  [self finishResolved:copied];
}

- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller {
  [self finishRejected:@"PICK_CANCELLED" message:@"No PDF was selected"];
}

- (NSString *)copyPickedURL:(NSURL *)url error:(NSError **)error {
  BOOL scoped = [url startAccessingSecurityScopedResource];
  NSFileManager *files = [NSFileManager defaultManager];
  NSURL *documents = [files URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask].firstObject;
  NSString *name = url.lastPathComponent;
  if (name.length == 0) {
    name = @"selected.pdf";
  }
  if (![name.lowercaseString hasSuffix:@".pdf"]) {
    name = [name stringByAppendingString:@".pdf"];
  }

  NSURL *destination = [documents URLByAppendingPathComponent:name];
  if ([files fileExistsAtPath:destination.path]) {
    [files removeItemAtURL:destination error:nil];
  }
  BOOL copied = [files copyItemAtURL:url toURL:destination error:error];
  if (scoped) {
    [url stopAccessingSecurityScopedResource];
  }
  return copied ? destination.path : nil;
}

- (void)finishResolved:(id)result {
  RCTPromiseResolveBlock resolve = _pendingResolve;
  [self clearPending];
  if (resolve != nil) {
    resolve(result);
  }
}

- (void)finishRejected:(NSString *)code message:(NSString *)message {
  RCTPromiseRejectBlock reject = _pendingReject;
  [self clearPending];
  if (reject != nil) {
    reject(code, message, nil);
  }
}

- (void)clearPending {
  _pendingResolve = nil;
  _pendingReject = nil;
  _rememberPickedPdf = NO;
}

@end
