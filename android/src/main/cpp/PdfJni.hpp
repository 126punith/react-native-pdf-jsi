#pragma once

#include <jni.h>

#include <string>

namespace margelo::nitro::pdfjsi {

/** Caches app classes while the loading thread's class loader is available (JNI_OnLoad). */
void cacheJavaClasses(JNIEnv* env);
bool ocrAvailable();
std::string recognizeImage(const std::string& imagePath);
/** Context.getCacheDir() of the running app. */
std::string appCacheDirectory();
/** Points PdfiumSession's render directory at the app cache. Safe to call repeatedly. */
void ensureRenderDirectory();

} // namespace margelo::nitro::pdfjsi
