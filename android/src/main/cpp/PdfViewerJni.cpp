// JNI bridge for the Kotlin viewer (org.wonday.pdf.viewer.PdfiumBridge).
// The viewer opens its own OpenPdf so rendering never waits on JS-side edits.

#include "PdfiumSession.hpp"

#include <android/bitmap.h>
#include <jni.h>

#include <memory>
#include <new>
#include <optional>
#include <string>
#include <vector>

using margelo::nitro::pdfjsi::OpenPdf;
using margelo::nitro::pdfjsi::PageGeometry;
using margelo::nitro::pdfjsi::PageLink;

namespace {

using Handle = std::shared_ptr<OpenPdf>;

std::shared_ptr<OpenPdf> fromHandle(jlong handle) {
    if (handle == 0) {
        return nullptr;
    }
    return *reinterpret_cast<Handle*>(handle);
}

std::string toString(JNIEnv* env, jstring value) {
    if (value == nullptr) {
        return "";
    }
    const char* chars = env->GetStringUTFChars(value, nullptr);
    std::string out = chars == nullptr ? "" : chars;
    if (chars != nullptr) {
        env->ReleaseStringUTFChars(value, chars);
    }
    return out;
}

/** NewStringUTF expects modified UTF-8; going through UTF-16 handles every code point. */
jstring newJavaString(JNIEnv* env, const std::string& utf8) {
    std::u16string out;
    for (size_t index = 0; index < utf8.size();) {
        const unsigned char lead = static_cast<unsigned char>(utf8[index]);
        uint32_t code = lead;
        size_t extra = lead < 0x80 ? 0 : (lead & 0xE0) == 0xC0 ? 1 : (lead & 0xF0) == 0xE0 ? 2 : 3;
        if (extra > 0) {
            code = lead & (0x3F >> extra);
        }
        if (index + extra >= utf8.size()) {
            break;
        }
        for (size_t step = 1; step <= extra; step++) {
            code = (code << 6) | (static_cast<unsigned char>(utf8[index + step]) & 0x3F);
        }
        index += extra + 1;
        if (code <= 0xFFFF) {
            out.push_back(static_cast<char16_t>(code));
        } else {
            code -= 0x10000;
            out.push_back(static_cast<char16_t>(0xD800 + (code >> 10)));
            out.push_back(static_cast<char16_t>(0xDC00 + (code & 0x3FF)));
        }
    }
    return env->NewString(reinterpret_cast<const jchar*>(out.data()), static_cast<jsize>(out.size()));
}

void throwJava(JNIEnv* env, const std::string& message) {
    jclass clazz = env->FindClass("java/lang/IllegalStateException");
    if (clazz != nullptr) {
        env->ThrowNew(clazz, message.c_str());
        env->DeleteLocalRef(clazz);
    }
}

} // namespace

extern "C" {

JNIEXPORT jlong JNICALL Java_org_wonday_pdf_viewer_PdfiumBridge_nativeOpen(JNIEnv* env, jclass, jstring path,
                                                                            jstring password) {
    try {
        std::optional<std::string> secret;
        if (password != nullptr) {
            secret = toString(env, password);
        }
        auto* handle = new Handle(std::make_shared<OpenPdf>(toString(env, path), secret));
        return reinterpret_cast<jlong>(handle);
    } catch (const std::exception& error) {
        throwJava(env, error.what());
        return 0;
    }
}

JNIEXPORT void JNICALL Java_org_wonday_pdf_viewer_PdfiumBridge_nativeClose(JNIEnv*, jclass, jlong handle) {
    if (handle == 0) {
        return;
    }
    auto* pointer = reinterpret_cast<Handle*>(handle);
    (*pointer)->close();
    delete pointer;
}

JNIEXPORT jfloatArray JNICALL Java_org_wonday_pdf_viewer_PdfiumBridge_nativePageSizes(JNIEnv* env, jclass, jlong handle) {
    try {
        auto document = fromHandle(handle);
        if (document == nullptr) {
            throwJava(env, "[document-closed] The PDF document is closed");
            return nullptr;
        }
        const std::vector<PageGeometry> pages = document->allGeometry();
        std::vector<jfloat> values;
        values.reserve(pages.size() * 2);
        for (const PageGeometry& page : pages) {
            values.push_back(static_cast<jfloat>(page.width));
            values.push_back(static_cast<jfloat>(page.height));
        }
        jfloatArray out = env->NewFloatArray(static_cast<jsize>(values.size()));
        env->SetFloatArrayRegion(out, 0, static_cast<jsize>(values.size()), values.data());
        return out;
    } catch (const std::exception& error) {
        throwJava(env, error.what());
        return nullptr;
    }
}

JNIEXPORT jboolean JNICALL Java_org_wonday_pdf_viewer_PdfiumBridge_nativeRender(JNIEnv* env, jclass, jlong handle, jint page,
                                                                                jobject bitmap, jfloat pageWidthPx,
                                                                                jfloat pageHeightPx, jfloat offsetX,
                                                                                jfloat offsetY, jint background,
                                                                                jboolean annotations) {
    auto document = fromHandle(handle);
    if (document == nullptr) {
        return JNI_FALSE;
    }
    AndroidBitmapInfo info;
    if (AndroidBitmap_getInfo(env, bitmap, &info) != ANDROID_BITMAP_RESULT_SUCCESS ||
        info.format != ANDROID_BITMAP_FORMAT_RGBA_8888) {
        return JNI_FALSE;
    }
    void* pixels = nullptr;
    if (AndroidBitmap_lockPixels(env, bitmap, &pixels) != ANDROID_BITMAP_RESULT_SUCCESS || pixels == nullptr) {
        return JNI_FALSE;
    }
    bool ok = true;
    try {
        document->renderRegion(page, pixels, static_cast<int>(info.stride), static_cast<int>(info.width),
                               static_cast<int>(info.height), pageWidthPx, pageHeightPx, offsetX, offsetY,
                               static_cast<uint32_t>(background), annotations == JNI_TRUE);
    } catch (const std::exception&) {
        ok = false;
    }
    AndroidBitmap_unlockPixels(env, bitmap);
    return ok ? JNI_TRUE : JNI_FALSE;
}

/** Five floats per link: x, y, width, height (points, top-left), target page (-1 for URIs). */
JNIEXPORT jfloatArray JNICALL Java_org_wonday_pdf_viewer_PdfiumBridge_nativeLinkRects(JNIEnv* env, jclass, jlong handle,
                                                                                      jint page) {
    auto document = fromHandle(handle);
    if (document == nullptr) {
        return env->NewFloatArray(0);
    }
    try {
        const std::vector<PageLink> links = document->links(page);
        std::vector<jfloat> values;
        values.reserve(links.size() * 5);
        for (const PageLink& link : links) {
            values.push_back(static_cast<jfloat>(link.rect.x));
            values.push_back(static_cast<jfloat>(link.rect.y));
            values.push_back(static_cast<jfloat>(link.rect.width));
            values.push_back(static_cast<jfloat>(link.rect.height));
            values.push_back(static_cast<jfloat>(link.page));
        }
        jfloatArray out = env->NewFloatArray(static_cast<jsize>(values.size()));
        env->SetFloatArrayRegion(out, 0, static_cast<jsize>(values.size()), values.data());
        return out;
    } catch (const std::exception&) {
        return env->NewFloatArray(0);
    }
}

JNIEXPORT jobjectArray JNICALL Java_org_wonday_pdf_viewer_PdfiumBridge_nativeLinkUris(JNIEnv* env, jclass, jlong handle,
                                                                                      jint page) {
    jclass stringClass = env->FindClass("java/lang/String");
    auto document = fromHandle(handle);
    std::vector<PageLink> links;
    if (document != nullptr) {
        try {
            links = document->links(page);
        } catch (const std::exception&) {
            links.clear();
        }
    }
    jobjectArray out = env->NewObjectArray(static_cast<jsize>(links.size()), stringClass, nullptr);
    for (size_t index = 0; index < links.size(); index++) {
        if (!links[index].uri.empty()) {
            jstring uri = newJavaString(env, links[index].uri);
            env->SetObjectArrayElement(out, static_cast<jsize>(index), uri);
            env->DeleteLocalRef(uri);
        }
    }
    env->DeleteLocalRef(stringClass);
    return out;
}

/** Outline titles, flattened depth-first. */
JNIEXPORT jobjectArray JNICALL Java_org_wonday_pdf_viewer_PdfiumBridge_nativeOutlineTitles(JNIEnv* env, jclass, jlong handle) {
    jclass stringClass = env->FindClass("java/lang/String");
    std::vector<margelo::nitro::pdfjsi::OutlineItem> items;
    if (auto document = fromHandle(handle)) {
        try {
            items = document->outline();
        } catch (const std::exception&) {
            items.clear();
        }
    }
    jobjectArray out = env->NewObjectArray(static_cast<jsize>(items.size()), stringClass, nullptr);
    for (size_t index = 0; index < items.size(); index++) {
        jstring title = newJavaString(env, items[index].title);
        env->SetObjectArrayElement(out, static_cast<jsize>(index), title);
        env->DeleteLocalRef(title);
    }
    env->DeleteLocalRef(stringClass);
    return out;
}

/** Two ints per outline item: target page (-1 if none) and level. */
JNIEXPORT jintArray JNICALL Java_org_wonday_pdf_viewer_PdfiumBridge_nativeOutlineInfo(JNIEnv* env, jclass, jlong handle) {
    std::vector<jint> values;
    if (auto document = fromHandle(handle)) {
        try {
            for (const auto& item : document->outline()) {
                values.push_back(static_cast<jint>(item.page));
                values.push_back(static_cast<jint>(item.level));
            }
        } catch (const std::exception&) {
            values.clear();
        }
    }
    jintArray out = env->NewIntArray(static_cast<jsize>(values.size()));
    env->SetIntArrayRegion(out, 0, static_cast<jsize>(values.size()), values.data());
    return out;
}

} // extern "C"
