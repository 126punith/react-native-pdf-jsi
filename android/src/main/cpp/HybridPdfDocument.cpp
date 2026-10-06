#include "HybridPdfDocument.hpp"

#include <fbjni/fbjni.h>
#include <algorithm>
#include <stdexcept>
#include <utility>

namespace margelo::nitro::pdfjsi {

namespace {

std::string recognizePage(const std::string& path, int pageIndex, bool fast) {
    JNIEnv* env = facebook::jni::Environment::current();
    if (env == nullptr) {
        throw std::runtime_error("JNI environment is not available");
    }
    jclass clazz = env->FindClass("org/wonday/pdf/PdfOcr");
    if (clazz == nullptr) {
        env->ExceptionClear();
        throw std::runtime_error("OCR helper is not available");
    }
    jmethodID method = env->GetStaticMethodID(
        clazz,
        "recognizePage",
        "(Ljava/lang/String;IZ)Ljava/lang/String;");
    if (method == nullptr) {
        env->ExceptionClear();
        throw std::runtime_error("OCR helper is not available");
    }
    jstring jpath = env->NewStringUTF(path.c_str());
    jstring result = static_cast<jstring>(env->CallStaticObjectMethod(clazz, method, jpath, pageIndex, fast ? JNI_TRUE : JNI_FALSE));
    env->DeleteLocalRef(jpath);
    if (env->ExceptionCheck()) {
        env->ExceptionClear();
        throw std::runtime_error("OCR failed");
    }
    if (result == nullptr) {
        return "";
    }
    const char* chars = env->GetStringUTFChars(result, nullptr);
    std::string text = chars == nullptr ? "" : chars;
    if (chars != nullptr) {
        env->ReleaseStringUTFChars(result, chars);
    }
    return text;
}

} // namespace

HybridPdfDocument::HybridPdfDocument(const std::string& path)
    : HybridObject(TAG), document_(std::make_shared<OpenPdf>(path)) {}

std::shared_ptr<OpenPdf> HybridPdfDocument::requireOpen() const {
    if (document_ == nullptr) {
        throw std::runtime_error("PDF document is not open");
    }
    return document_;
}

double HybridPdfDocument::getPageCount() {
    return static_cast<double>(requireOpen()->pageCount());
}

std::string HybridPdfDocument::getPath() {
    return requireOpen()->path();
}

CacheMetrics HybridPdfDocument::getCacheMetrics() {
    return CacheMetrics(0, 0, 0);
}

PerformanceMetrics HybridPdfDocument::getPerformanceMetrics() {
    const int renders = metrics_->renderCount.load();
    const double total = metrics_->totalRenderMs.load();
    const double average = renders == 0 ? 0 : total / renders;
    return PerformanceMetrics(metrics_->lastRenderMs.load(), average, 0, 0);
}

PageSize HybridPdfDocument::pageSize(double index) {
    return requireOpen()->pageSize(static_cast<int>(index));
}

PageMetrics HybridPdfDocument::pageMetrics(double index) {
    const PlatformPageGeometry geometry = requireOpen()->pageMetrics(static_cast<int>(index));
    if (!geometry.ok) {
        throw std::runtime_error(geometry.error.empty() ? "pageMetrics failed" : geometry.error);
    }
    return PageMetrics(index, geometry.width, geometry.height, geometry.rotation, metrics_->quality.load(), 0, 0);
}

void HybridPdfDocument::setRenderQuality(double quality) {
    metrics_->quality.store(static_cast<int>(quality));
}

void HybridPdfDocument::clearCache() {
    metrics_->renderCount.store(0);
    metrics_->lastRenderMs.store(0);
    metrics_->totalRenderMs.store(0);
}

void HybridPdfDocument::optimizeMemory() {
    clearCache();
}

std::shared_ptr<Promise<RenderResult>> HybridPdfDocument::renderPage(double index, double scale) {
    auto document = requireOpen();
    auto metrics = metrics_;
    return Promise<RenderResult>::async([document, metrics, index, scale]() {
        const PlatformRenderInfo info = document->renderPage(static_cast<int>(index), scale);
        if (!info.ok) {
            throw std::runtime_error(info.error.empty() ? "renderPage failed" : info.error);
        }
        metrics->lastRenderMs.store(info.renderTimeMs);
        double total = metrics->totalRenderMs.load();
        while (!metrics->totalRenderMs.compare_exchange_weak(total, total + info.renderTimeMs)) {
        }
        metrics->renderCount.fetch_add(1);
        return RenderResult(true, index, info.width, info.height, scale, false, info.renderTimeMs);
    });
}

std::shared_ptr<Promise<bool>> HybridPdfDocument::preloadPages(double startPage, double endPage) {
    auto document = requireOpen();
    return Promise<bool>::async([document, startPage, endPage]() {
        int start = static_cast<int>(startPage);
        int end = static_cast<int>(endPage);
        if (end < start) {
            std::swap(start, end);
        }
        for (int page = start; page <= end; page++) {
            const PlatformPageGeometry geometry = document->pageMetrics(page);
            if (!geometry.ok) {
                throw std::runtime_error(geometry.error.empty() ? "preloadPages failed" : geometry.error);
            }
        }
        return true;
    });
}

std::shared_ptr<Promise<std::vector<SearchResult>>> HybridPdfDocument::searchText(
    const std::string& term,
    double startPage,
    double endPage) {
    auto document = requireOpen();
    return Promise<std::vector<SearchResult>>::async([document, term, startPage, endPage]() {
        return document->search(term, static_cast<int>(startPage), static_cast<int>(endPage));
    });
}

std::shared_ptr<Promise<std::string>> HybridPdfDocument::extractText(double index) {
    auto document = requireOpen();
    return Promise<std::string>::async([document, index]() {
        return document->textFromPage(static_cast<int>(index));
    });
}

std::shared_ptr<Promise<std::string>> HybridPdfDocument::extractTextFromPages(const std::string& pageIndicesJson) {
    auto document = requireOpen();
    return Promise<std::string>::async([document, pageIndicesJson]() {
        return document->textFromPages(pageIndicesJson);
    });
}

std::shared_ptr<Promise<std::string>> HybridPdfDocument::extractAllText() {
    auto document = requireOpen();
    return Promise<std::string>::async([document]() {
        return document->allText();
    });
}

std::shared_ptr<Promise<std::string>> HybridPdfDocument::recognizeText(double index, bool fast) {
    auto document = requireOpen();
    const std::string path = document->path();
    return Promise<std::string>::async([path, index, fast]() {
        return recognizePage(path, static_cast<int>(index), fast);
    });
}

std::shared_ptr<Promise<std::string>> HybridPdfDocument::exportPageToImage(double index, double scale) {
    auto document = requireOpen();
    return Promise<std::string>::async([document, index, scale]() {
        return document->exportPage(static_cast<int>(index), scale);
    });
}

std::shared_ptr<Promise<std::string>> HybridPdfDocument::exportToImages(double scale) {
    auto document = requireOpen();
    return Promise<std::string>::async([document, scale]() {
        return document->exportAll(scale);
    });
}

std::shared_ptr<Promise<bool>> HybridPdfDocument::rotatePage(double pageNumber, double degrees) {
    auto document = requireOpen();
    return Promise<bool>::async([document, pageNumber, degrees]() {
        return document->rotate(static_cast<int>(pageNumber), static_cast<int>(degrees));
    });
}

std::shared_ptr<Promise<bool>> HybridPdfDocument::deletePage(double pageNumber) {
    auto document = requireOpen();
    return Promise<bool>::async([document, pageNumber]() {
        return document->removePage(static_cast<int>(pageNumber));
    });
}

void HybridPdfDocument::close() {
    if (document_ != nullptr) {
        document_->close();
        document_.reset();
    }
}

} // namespace margelo::nitro::pdfjsi
