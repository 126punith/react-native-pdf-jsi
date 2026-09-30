#include "PDFJSIPlatform.hpp"

#include <fbjni/fbjni.h>
#include <jni.h>

#include <cstdio>
#include <stdexcept>
#include <vector>

namespace margelo::nitro::pdfjsi {

namespace {

struct JniScope {
    facebook::jni::ThreadScope threadScope;
    JNIEnv* env;

    JniScope() : env(facebook::jni::Environment::current()) {}
};

std::string jstringToString(JNIEnv* env, jstring value) {
    if (value == nullptr) {
        return "";
    }
    const char* chars = env->GetStringUTFChars(value, nullptr);
    std::string result = chars == nullptr ? "" : chars;
    if (chars != nullptr) {
        env->ReleaseStringUTFChars(value, chars);
    }
    return result;
}

bool checkException(JNIEnv* env) {
    if (env != nullptr && env->ExceptionCheck()) {
        env->ExceptionClear();
        return true;
    }
    return false;
}

} // namespace

namespace {
jclass gOpsClass = nullptr;
jclass gManagerClass = nullptr;

jclass cacheClass(JNIEnv* env, const char* name) {
    jclass local = env->FindClass(name);
    if (local == nullptr) {
        if (env->ExceptionCheck()) {
            env->ExceptionClear();
        }
        return nullptr;
    }
    jclass global = static_cast<jclass>(env->NewGlobalRef(local));
    env->DeleteLocalRef(local);
    return global;
}
}

void cachePdfNitroOpsClass() {
    JNIEnv* env = facebook::jni::Environment::current();
    if (env == nullptr) {
        return;
    }
    if (gOpsClass == nullptr) {
        gOpsClass = cacheClass(env, "org/wonday/pdf/PDFNitroOps");
    }
    if (gManagerClass == nullptr) {
        gManagerClass = cacheClass(env, "org/wonday/pdf/PDFJSIManager");
    }
}

bool platformRegisterPathForSearch(const std::string& pdfId, const std::string& path) {
    JniScope jni;
    if (jni.env == nullptr) {
        return false;
    }

    if (gManagerClass == nullptr || checkException(jni.env)) {
        return false;
    }

    jmethodID method = jni.env->GetStaticMethodID(
        gManagerClass,
        "registerPathForSearchSync",
        "(Ljava/lang/String;Ljava/lang/String;)Z");
    if (method == nullptr || checkException(jni.env)) {
        return false;
    }

    jstring pdfIdString = jni.env->NewStringUTF(pdfId.c_str());
    jstring pathString = jni.env->NewStringUTF(path.c_str());
    jboolean registered = jni.env->CallStaticBooleanMethod(
        gManagerClass,
        method,
        pdfIdString,
        pathString);
    bool failed = checkException(jni.env);
    jni.env->DeleteLocalRef(pdfIdString);
    jni.env->DeleteLocalRef(pathString);
    return !failed && registered == JNI_TRUE;
}

std::vector<SearchResult> platformSearchTextDirect(
    const std::string& pdfId,
    const std::string& searchTerm,
    int startPage,
    int endPage) {
    std::vector<SearchResult> results;
    JniScope jni;
    if (jni.env == nullptr) {
        return results;
    }

    if (gManagerClass == nullptr || checkException(jni.env)) {
        return results;
    }

    jmethodID method = jni.env->GetStaticMethodID(
        gManagerClass,
        "searchTextDirectArray",
        "(Ljava/lang/String;Ljava/lang/String;II)Lcom/facebook/react/bridge/WritableArray;");
    if (method == nullptr || checkException(jni.env)) {
        return results;
    }

    jstring pdfIdString = jni.env->NewStringUTF(pdfId.c_str());
    jstring termString = jni.env->NewStringUTF(searchTerm.c_str());
    jobject array = jni.env->CallStaticObjectMethod(
        gManagerClass,
        method,
        pdfIdString,
        termString,
        startPage,
        endPage);
    jni.env->DeleteLocalRef(pdfIdString);
    jni.env->DeleteLocalRef(termString);

    if (array == nullptr || checkException(jni.env)) {
        return results;
    }

    jclass arrayClass = jni.env->GetObjectClass(array);
    jmethodID sizeMethod = jni.env->GetMethodID(arrayClass, "size", "()I");
    jmethodID getMapMethod = jni.env->GetMethodID(
        arrayClass,
        "getMap",
        "(I)Lcom/facebook/react/bridge/ReadableMap;");
    if (sizeMethod == nullptr || getMapMethod == nullptr || checkException(jni.env)) {
        jni.env->DeleteLocalRef(arrayClass);
        jni.env->DeleteLocalRef(array);
        return results;
    }

    const jint count = jni.env->CallIntMethod(array, sizeMethod);
    jmethodID getIntMethod = nullptr;
    jmethodID getStringMethod = nullptr;

    for (jint index = 0; index < count; index++) {
        jobject map = jni.env->CallObjectMethod(array, getMapMethod, index);
        if (map == nullptr || checkException(jni.env)) {
            continue;
        }
        if (getIntMethod == nullptr) {
            jclass mapClass = jni.env->GetObjectClass(map);
            getIntMethod = jni.env->GetMethodID(mapClass, "getInt", "(Ljava/lang/String;)I");
            getStringMethod = jni.env->GetMethodID(mapClass, "getString", "(Ljava/lang/String;)Ljava/lang/String;");
            jni.env->DeleteLocalRef(mapClass);
        }

        jstring pageKey = jni.env->NewStringUTF("page");
        jstring textKey = jni.env->NewStringUTF("text");
        jstring rectKey = jni.env->NewStringUTF("rect");
        const jint page = jni.env->CallIntMethod(map, getIntMethod, pageKey);
        jstring textValue = static_cast<jstring>(jni.env->CallObjectMethod(map, getStringMethod, textKey));
        jstring rectValue = static_cast<jstring>(jni.env->CallObjectMethod(map, getStringMethod, rectKey));
        if (!checkException(jni.env)) {
            results.emplace_back(
                static_cast<double>(page),
                jstringToString(jni.env, textValue),
                jstringToString(jni.env, rectValue));
        }

        jni.env->DeleteLocalRef(pageKey);
        jni.env->DeleteLocalRef(textKey);
        jni.env->DeleteLocalRef(rectKey);
        if (textValue != nullptr) {
            jni.env->DeleteLocalRef(textValue);
        }
        if (rectValue != nullptr) {
            jni.env->DeleteLocalRef(rectValue);
        }
        jni.env->DeleteLocalRef(map);
    }

    jni.env->DeleteLocalRef(arrayClass);
    jni.env->DeleteLocalRef(array);
    return results;
}

std::string callOpsString(const char* method, const char* signature, const std::vector<std::string>& strings, const std::vector<jint>& ints, const std::vector<jfloat>& floats) {
    JniScope jni;
    if (jni.env == nullptr) {
        return "ERR:JNI unavailable";
    }
    jobject opsClass = gOpsClass;
    facebook::jni::local_ref<jclass> foundClass;
    if (opsClass == nullptr) {
        foundClass = facebook::jni::findClassLocal("org/wonday/pdf/PDFNitroOps");
        opsClass = foundClass.get();
    }
    if (opsClass == nullptr || checkException(jni.env)) {
        return "ERR:PDFNitroOps not found";
    }
    jmethodID javaMethod = jni.env->GetStaticMethodID(static_cast<jclass>(opsClass), method, signature);
    if (javaMethod == nullptr || checkException(jni.env)) {
        return "ERR:method not found";
    }

    std::vector<jstring> jstrings;
    jstrings.reserve(strings.size());
    for (const std::string& value : strings) {
        jstrings.push_back(jni.env->NewStringUTF(value.c_str()));
    }

    std::vector<jvalue> args;
    size_t stringIndex = 0;
    size_t intIndex = 0;
    size_t floatIndex = 0;
    const std::string sig(signature);
    const size_t close = sig.find(')');
    const std::string params = sig.substr(1, close - 1);
    for (size_t i = 0; i < params.size();) {
        jvalue arg{};
        if (params[i] == 'L') {
            arg.l = jstrings[stringIndex++];
            i = params.find(';', i) + 1;
        } else if (params[i] == 'I') {
            arg.i = ints[intIndex++];
            i++;
        } else if (params[i] == 'F') {
            arg.f = floats[floatIndex++];
            i++;
        } else {
            i++;
            continue;
        }
        args.push_back(arg);
    }

    jstring result = static_cast<jstring>(jni.env->CallStaticObjectMethodA(
        static_cast<jclass>(opsClass),
        javaMethod,
        args.empty() ? nullptr : args.data()));
    std::string value = "ERR:native call failed";
    if (!checkException(jni.env) && result != nullptr) {
        value = jstringToString(jni.env, result);
        jni.env->DeleteLocalRef(result);
    }
    for (jstring item : jstrings) {
        jni.env->DeleteLocalRef(item);
    }
    return value;
}

bool callOpsBool(const char* method, const char* signature, const std::string& path, jint first, jint second) {
    JniScope jni;
    if (jni.env == nullptr) {
        return false;
    }
    jclass opsClass = gOpsClass;
    if (opsClass == nullptr || checkException(jni.env)) {
        return false;
    }
    jmethodID javaMethod = jni.env->GetStaticMethodID(opsClass, method, signature);
    if (javaMethod == nullptr || checkException(jni.env)) {
        return false;
    }
    jstring pathString = jni.env->NewStringUTF(path.c_str());
    jboolean result = jni.env->CallStaticBooleanMethod(opsClass, javaMethod, pathString, first, second);
    bool failed = checkException(jni.env);
    jni.env->DeleteLocalRef(pathString);
    return !failed && result == JNI_TRUE;
}

PlatformPageGeometry parseGeometry(const std::string& encoded) {
    PlatformPageGeometry geometry;
    if (encoded.rfind("ERR:", 0) == 0) {
        geometry.error = encoded.substr(4);
        return geometry;
    }
    double width = 0;
    double height = 0;
    double rotation = 0;
    if (sscanf(encoded.c_str(), "%lf|%lf|%lf", &width, &height, &rotation) == 3 && width > 0 && height > 0) {
        geometry.ok = true;
        geometry.width = width;
        geometry.height = height;
        geometry.rotation = rotation;
    } else {
        geometry.error = encoded;
    }
    return geometry;
}

PlatformRenderInfo parseRender(const std::string& encoded) {
    PlatformRenderInfo info;
    if (encoded.rfind("ERR:", 0) == 0) {
        info.error = encoded.substr(4);
        return info;
    }
    double width = 0;
    double height = 0;
    double renderTimeMs = 0;
    if (sscanf(encoded.c_str(), "%lf|%lf|%lf", &width, &height, &renderTimeMs) == 3 && width > 0 && height > 0) {
        info.ok = true;
        info.width = width;
        info.height = height;
        info.renderTimeMs = renderTimeMs;
    } else {
        info.error = encoded;
    }
    return info;
}

std::string requireOk(const std::string& encoded) {
    if (encoded.rfind("ERR:", 0) == 0) {
        throw std::runtime_error(encoded.substr(4));
    }
    return encoded;
}

PlatformPageGeometry platformPageMetrics(const std::string& pdfId, int pageNumber) {
    return parseGeometry(callOpsString(
        "pageMetrics",
        "(Ljava/lang/String;I)Ljava/lang/String;",
        {pdfId},
        {pageNumber},
        {}));
}

PlatformRenderInfo platformRenderPage(const std::string& pdfId, int pageNumber, double scale) {
    return parseRender(callOpsString(
        "renderPage",
        "(Ljava/lang/String;IF)Ljava/lang/String;",
        {pdfId},
        {pageNumber},
        {static_cast<jfloat>(scale)}));
}

double platformPageCount(const std::string& filePath) {
    return std::stod(requireOk(callOpsString("pageCount", "(Ljava/lang/String;)Ljava/lang/String;", {filePath}, {}, {})));
}

PageSize platformPageSize(const std::string& filePath, int pageIndex) {
    PlatformPageGeometry geometry = parseGeometry(callOpsString(
        "pageSize",
        "(Ljava/lang/String;I)Ljava/lang/String;",
        {filePath},
        {pageIndex},
        {}));
    if (!geometry.ok) {
        throw std::runtime_error(geometry.error.empty() ? "pageSize failed" : geometry.error);
    }
    return PageSize(geometry.width, geometry.height);
}

std::string platformTextFromPage(const std::string& filePath, int pageIndex) {
    return requireOk(callOpsString(
        "textFromPage",
        "(Ljava/lang/String;I)Ljava/lang/String;",
        {filePath},
        {pageIndex},
        {}));
}

std::string platformTextFromPages(const std::string& filePath, const std::string& pageIndicesJson) {
    return requireOk(callOpsString(
        "textFromPages",
        "(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
        {filePath, pageIndicesJson},
        {},
        {}));
}

std::string platformAllText(const std::string& filePath) {
    return requireOk(callOpsString("allText", "(Ljava/lang/String;)Ljava/lang/String;", {filePath}, {}, {}));
}

std::string platformExportPageToImage(const std::string& filePath, int pageIndex, double scale) {
    return requireOk(callOpsString(
        "exportPageToImage",
        "(Ljava/lang/String;IF)Ljava/lang/String;",
        {filePath},
        {pageIndex},
        {static_cast<jfloat>(scale)}));
}

std::string platformExportToImages(const std::string& filePath, double scale) {
    return requireOk(callOpsString(
        "exportToImages",
        "(Ljava/lang/String;F)Ljava/lang/String;",
        {filePath},
        {},
        {static_cast<jfloat>(scale)}));
}

std::string platformMergePDFs(const std::string& filePathsJson, const std::string& outputPath) {
    return requireOk(callOpsString(
        "mergePdfs",
        "(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
        {filePathsJson, outputPath},
        {},
        {}));
}

std::string platformSplitPDF(const std::string& filePath, const std::string& pageRangesJson, const std::string& outputDir) {
    return requireOk(callOpsString(
        "splitPdf",
        "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
        {filePath, pageRangesJson, outputDir},
        {},
        {}));
}

std::string platformExtractPages(const std::string& filePath, const std::string& pageNumbersJson, const std::string& outputPath) {
    return requireOk(callOpsString(
        "extractPages",
        "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
        {filePath, pageNumbersJson, outputPath},
        {},
        {}));
}

bool platformRotatePage(const std::string& filePath, int pageNumber, int degrees) {
    return callOpsBool("rotatePage", "(Ljava/lang/String;II)Z", filePath, pageNumber, degrees);
}

bool platformDeletePage(const std::string& filePath, int pageNumber) {
    JniScope jni;
    if (jni.env == nullptr) {
        return false;
    }
    jclass opsClass = gOpsClass;
    if (opsClass == nullptr || checkException(jni.env)) {
        return false;
    }
    jmethodID javaMethod = jni.env->GetStaticMethodID(opsClass, "deletePage", "(Ljava/lang/String;I)Z");
    if (javaMethod == nullptr || checkException(jni.env)) {
        return false;
    }
    jstring pathString = jni.env->NewStringUTF(filePath.c_str());
    jboolean result = jni.env->CallStaticBooleanMethod(opsClass, javaMethod, pathString, pageNumber);
    bool failed = checkException(jni.env);
    jni.env->DeleteLocalRef(pathString);
    return !failed && result == JNI_TRUE;
}

std::string platformCompressPDF(const std::string& inputPath, const std::string& outputPath, int compressionLevel) {
    return requireOk(callOpsString(
        "compressPdf",
        "(Ljava/lang/String;Ljava/lang/String;I)Ljava/lang/String;",
        {inputPath, outputPath},
        {compressionLevel},
        {}));
}

} // namespace margelo::nitro::pdfjsi
