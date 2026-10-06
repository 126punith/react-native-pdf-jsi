#include "HybridPdfLibrary.hpp"

#include "HybridPdfDocument.hpp"
#include "PdfDiskCache.hpp"
#include "PdfiumSession.hpp"

#include <fbjni/fbjni.h>
#include <stdexcept>

namespace margelo::nitro::pdfjsi {

JSIStats HybridPdfLibrary::getJsiStats() {
    return JSIStats("5.0.0", "high", true, true, true);
}

KB16Support HybridPdfLibrary::getKb16Support() {
    return KB16Support(
        true,
        "android",
        "16KB page size supported - Google Play compliant",
        true,
        "27.1.12297006",
        "-Wl,-z,max-page-size=16384");
}

bool HybridPdfLibrary::getOcrAvailable() {
    JNIEnv* env = facebook::jni::Environment::current();
    if (env == nullptr) {
        return false;
    }
    jclass clazz = env->FindClass("org/wonday/pdf/PdfOcr");
    if (clazz == nullptr) {
        env->ExceptionClear();
        return false;
    }
    jmethodID method = env->GetStaticMethodID(clazz, "isAvailable", "()Z");
    if (method == nullptr) {
        env->ExceptionClear();
        return false;
    }
    return env->CallStaticBooleanMethod(clazz, method) == JNI_TRUE;
}

std::shared_ptr<Promise<std::shared_ptr<HybridPdfDocumentSpec>>> HybridPdfLibrary::open(const std::string& path) {
    return Promise<std::shared_ptr<HybridPdfDocumentSpec>>::async([path]() {
        auto document = std::make_shared<HybridPdfDocument>(path);
        return std::static_pointer_cast<HybridPdfDocumentSpec>(document);
    });
}

std::shared_ptr<Promise<std::string>> HybridPdfLibrary::mergePDFs(
    const std::vector<std::string>& filePaths,
    const std::string& outputPath) {
    return Promise<std::string>::async([filePaths, outputPath]() {
        return pdfiumMerge(filePaths, outputPath);
    });
}

std::shared_ptr<Promise<std::string>> HybridPdfLibrary::splitPDF(
    const std::string& filePath,
    const std::string& pageRangesJson,
    const std::string& outputDir) {
    return Promise<std::string>::async([filePath, pageRangesJson, outputDir]() {
        return pdfiumSplit(filePath, pageRangesJson, outputDir);
    });
}

std::shared_ptr<Promise<std::string>> HybridPdfLibrary::extractPages(
    const std::string& filePath,
    const std::string& pageNumbersJson,
    const std::string& outputPath) {
    return Promise<std::string>::async([filePath, pageNumbersJson, outputPath]() {
        return pdfiumExtract(filePath, pageNumbersJson, outputPath);
    });
}

std::shared_ptr<Promise<std::string>> HybridPdfLibrary::compressPDF(
    const std::string& inputPath,
    const std::string& outputPath,
    double compressionLevel) {
    return Promise<std::string>::async([inputPath, outputPath, compressionLevel]() {
        return pdfiumCompress(inputPath, outputPath, static_cast<int>(compressionLevel));
    });
}

std::shared_ptr<Promise<PdfCacheInfo>> HybridPdfLibrary::storeCachedPdf(
    const std::string& base64,
    const std::string& identifier) {
    return Promise<PdfCacheInfo>::async([base64, identifier]() {
        return cacheStore(base64, identifier);
    });
}

std::shared_ptr<Promise<std::string>> HybridPdfLibrary::cachedPdfPath(const std::string& identifier) {
    return Promise<std::string>::async([identifier]() {
        return cachePath(identifier);
    });
}

std::shared_ptr<Promise<bool>> HybridPdfLibrary::removeCachedPdf(const std::string& identifier) {
    return Promise<bool>::async([identifier]() {
        return cacheRemove(identifier);
    });
}

std::shared_ptr<Promise<bool>> HybridPdfLibrary::clearPdfCache() {
    return Promise<bool>::async([]() {
        return cacheClear();
    });
}

std::shared_ptr<Promise<double>> HybridPdfLibrary::clearExpiredPdfs() {
    return Promise<double>::async([]() {
        return cacheClearExpired();
    });
}

std::shared_ptr<Promise<PdfCacheStats>> HybridPdfLibrary::pdfCacheStats() {
    return Promise<PdfCacheStats>::async([]() {
        return cacheStats();
    });
}

} // namespace margelo::nitro::pdfjsi
