#include "PdfJni.hpp"

#include "PdfiumSession.hpp"

#include <fbjni/fbjni.h>

#include <mutex>

namespace margelo::nitro::pdfjsi {

namespace {

jclass gOcrClass = nullptr;

std::string takeString(JNIEnv* env, jstring value) {
    if (value == nullptr) {
        return "";
    }
    const char* chars = env->GetStringUTFChars(value, nullptr);
    std::string out = chars == nullptr ? "" : chars;
    if (chars != nullptr) {
        env->ReleaseStringUTFChars(value, chars);
    }
    env->DeleteLocalRef(value);
    return out;
}

std::string pendingExceptionMessage(JNIEnv* env) {
    jthrowable error = env->ExceptionOccurred();
    env->ExceptionClear();
    if (error == nullptr) {
        return "";
    }
    jclass throwable = env->FindClass("java/lang/Throwable");
    jmethodID toString = env->GetMethodID(throwable, "toString", "()Ljava/lang/String;");
    std::string message = takeString(env, static_cast<jstring>(env->CallObjectMethod(error, toString)));
    if (env->ExceptionCheck()) {
        env->ExceptionClear();
    }
    env->DeleteLocalRef(throwable);
    env->DeleteLocalRef(error);
    return message;
}

JNIEnv* requireEnv() {
    JNIEnv* env = facebook::jni::Environment::current();
    if (env == nullptr) {
        throwPdfError("unknown", "JNI environment is not available");
    }
    return env;
}

} // namespace

void cacheJavaClasses(JNIEnv* env) {
    jclass local = env->FindClass("org/wonday/pdf/PdfOcr");
    if (local == nullptr) {
        env->ExceptionClear();
        return;
    }
    gOcrClass = static_cast<jclass>(env->NewGlobalRef(local));
    env->DeleteLocalRef(local);
}

bool ocrAvailable() {
    if (gOcrClass == nullptr) {
        return false;
    }
    JNIEnv* env = facebook::jni::Environment::current();
    if (env == nullptr) {
        return false;
    }
    jmethodID method = env->GetStaticMethodID(gOcrClass, "isAvailable", "()Z");
    if (method == nullptr) {
        env->ExceptionClear();
        return false;
    }
    const bool available = env->CallStaticBooleanMethod(gOcrClass, method) == JNI_TRUE;
    if (env->ExceptionCheck()) {
        env->ExceptionClear();
        return false;
    }
    return available;
}

std::string recognizeImage(const std::string& imagePath) {
    if (gOcrClass == nullptr) {
        throwPdfError("unsupported-operation", "OCR helper is not available");
    }
    JNIEnv* env = requireEnv();
    jmethodID method = env->GetStaticMethodID(gOcrClass, "recognizeImage", "(Ljava/lang/String;)Ljava/lang/String;");
    if (method == nullptr) {
        env->ExceptionClear();
        throwPdfError("unsupported-operation", "OCR helper is not available");
    }
    jstring path = env->NewStringUTF(imagePath.c_str());
    auto result = static_cast<jstring>(env->CallStaticObjectMethod(gOcrClass, method, path));
    env->DeleteLocalRef(path);
    if (env->ExceptionCheck()) {
        const std::string message = pendingExceptionMessage(env);
        if (message.find("IllegalStateException") != std::string::npos) {
            throwPdfError("unsupported-operation", message);
        }
        throwPdfError("unknown", "OCR failed: " + message);
    }
    return takeString(env, result);
}

std::string appCacheDirectory() {
    static std::once_flag resolved;
    static std::string directory;
    std::call_once(resolved, [] {
        JNIEnv* env = requireEnv();
        jclass threadClass = env->FindClass("android/app/ActivityThread");
        jmethodID currentApplication =
            env->GetStaticMethodID(threadClass, "currentApplication", "()Landroid/app/Application;");
        jobject application = env->CallStaticObjectMethod(threadClass, currentApplication);
        if (application == nullptr || env->ExceptionCheck()) {
            env->ExceptionClear();
            env->DeleteLocalRef(threadClass);
            throwPdfError("unknown", "The Android application is not available");
        }
        jclass contextClass = env->GetObjectClass(application);
        jmethodID getCacheDir = env->GetMethodID(contextClass, "getCacheDir", "()Ljava/io/File;");
        jobject cacheDir = env->CallObjectMethod(application, getCacheDir);
        jclass fileClass = env->GetObjectClass(cacheDir);
        jmethodID getAbsolutePath = env->GetMethodID(fileClass, "getAbsolutePath", "()Ljava/lang/String;");
        directory = takeString(env, static_cast<jstring>(env->CallObjectMethod(cacheDir, getAbsolutePath)));
        env->DeleteLocalRef(fileClass);
        env->DeleteLocalRef(cacheDir);
        env->DeleteLocalRef(contextClass);
        env->DeleteLocalRef(application);
        env->DeleteLocalRef(threadClass);
    });
    return directory;
}

void ensureRenderDirectory() {
    static std::once_flag configured;
    std::call_once(configured, [] { setRenderDirectory(appCacheDirectory() + "/pdf-jsi/renders"); });
}

} // namespace margelo::nitro::pdfjsi
