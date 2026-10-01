#include "HybridPDFJSI.hpp"
#include "PDFJSIPlatform.hpp"

#include <algorithm>
#include <stdexcept>

namespace margelo::nitro::pdfjsi {

HybridPDFJSI::DocumentCache& HybridPDFJSI::cacheFor(const std::string& pdfId) {
    return caches_[pdfId];
}

void HybridPDFJSI::rememberPage(const std::string& pdfId, int pageNumber, const PageMetrics& metrics) {
    std::lock_guard<std::mutex> lock(cacheMutex_);
    DocumentCache& cache = cacheFor(pdfId);
    if (cache.pages.find(pageNumber) == cache.pages.end()) {
        cache.misses += 1;
    } else {
        cache.hits += 1;
    }
    cache.pages[pageNumber] = CachedPage{metrics};
}

void HybridPDFJSI::recordRender(const std::string& pdfId, double renderTimeMs) {
    std::lock_guard<std::mutex> lock(cacheMutex_);
    DocumentCache& cache = cacheFor(pdfId);
    cache.lastRenderMs = renderTimeMs;
    cache.totalRenderMs += renderTimeMs;
    cache.renderCount += 1;
}

std::shared_ptr<Promise<RenderResult>> HybridPDFJSI::renderPageDirect(
    const std::string& pdfId,
    double pageNumber,
    double scale,
    const std::string& /*base64Data*/) {
    return Promise<RenderResult>::async([this, pdfId, pageNumber, scale]() {
        PlatformRenderInfo info = platformRenderPage(pdfId, static_cast<int>(pageNumber), scale);
        if (!info.ok) {
            throw std::runtime_error(info.error.empty() ? "renderPageDirect failed" : info.error);
        }
        recordRender(pdfId, info.renderTimeMs);
        return RenderResult(true, pageNumber, info.width, info.height, scale, false, info.renderTimeMs);
    });
}

std::shared_ptr<Promise<PageMetrics>> HybridPDFJSI::getPageMetrics(
    const std::string& pdfId,
    double pageNumber) {
    return Promise<PageMetrics>::async([this, pdfId, pageNumber]() {
        PlatformPageGeometry geometry = platformPageMetrics(pdfId, static_cast<int>(pageNumber));
        if (!geometry.ok) {
            throw std::runtime_error(geometry.error.empty() ? "getPageMetrics failed" : geometry.error);
        }
        int quality = 2;
        {
            std::lock_guard<std::mutex> lock(cacheMutex_);
            quality = cacheFor(pdfId).quality;
        }
        PageMetrics metrics(pageNumber, geometry.width, geometry.height, geometry.rotation, quality, 0, 0);
        rememberPage(pdfId, static_cast<int>(pageNumber), metrics);
        return metrics;
    });
}

std::shared_ptr<Promise<bool>> HybridPDFJSI::preloadPagesDirect(
    const std::string& pdfId,
    double startPage,
    double endPage) {
    return Promise<bool>::async([this, pdfId, startPage, endPage]() {
        int start = static_cast<int>(startPage);
        int end = static_cast<int>(endPage);
        if (end < start) {
            std::swap(start, end);
        }
        for (int page = start; page <= end; page++) {
            PlatformPageGeometry geometry = platformPageMetrics(pdfId, page);
            if (!geometry.ok) {
                throw std::runtime_error(geometry.error.empty() ? "preloadPagesDirect failed" : geometry.error);
            }
            PageMetrics metrics(page, geometry.width, geometry.height, geometry.rotation, 1, 0, 0);
            rememberPage(pdfId, page, metrics);
        }
        return true;
    });
}

std::shared_ptr<Promise<CacheMetrics>> HybridPDFJSI::getCacheMetrics(const std::string& pdfId) {
    std::lock_guard<std::mutex> lock(cacheMutex_);
    const DocumentCache& cache = cacheFor(pdfId);
    const int lookups = cache.hits + cache.misses;
    const double hitRatio = lookups == 0 ? 0 : static_cast<double>(cache.hits) / lookups;
    CacheMetrics metrics(static_cast<double>(cache.pages.size()), static_cast<double>(cache.pages.size()), hitRatio);
    return Promise<CacheMetrics>::resolved(std::move(metrics));
}

std::shared_ptr<Promise<bool>> HybridPDFJSI::clearCacheDirect(
    const std::string& pdfId,
    const std::string& /*cacheType*/) {
    platformReleaseDocument(pdfId);
    std::lock_guard<std::mutex> lock(cacheMutex_);
    caches_.erase(pdfId);
    return Promise<bool>::resolved(true);
}

std::shared_ptr<Promise<bool>> HybridPDFJSI::optimizeMemory(const std::string& pdfId) {
    std::lock_guard<std::mutex> lock(cacheMutex_);
    DocumentCache& cache = cacheFor(pdfId);
    const int quality = cache.quality;
    cache = DocumentCache{};
    cache.quality = quality;
    return Promise<bool>::resolved(true);
}

std::shared_ptr<Promise<std::vector<SearchResult>>> HybridPDFJSI::searchTextDirect(
    const std::string& pdfId,
    const std::string& searchTerm,
    double startPage,
    double endPage) {
    return Promise<std::vector<SearchResult>>::async(
        [pdfId, searchTerm, startPage, endPage]() {
            return platformSearchTextDirect(
                pdfId,
                searchTerm,
                static_cast<int>(startPage),
                static_cast<int>(endPage));
        });
}

std::shared_ptr<Promise<PerformanceMetrics>> HybridPDFJSI::getPerformanceMetrics(const std::string& pdfId) {
    std::lock_guard<std::mutex> lock(cacheMutex_);
    const DocumentCache& cache = cacheFor(pdfId);
    const int lookups = cache.hits + cache.misses;
    const double hitRatio = lookups == 0 ? 0 : static_cast<double>(cache.hits) / lookups;
    const double average = cache.renderCount == 0 ? 0 : cache.totalRenderMs / cache.renderCount;
    PerformanceMetrics metrics(cache.lastRenderMs, average, hitRatio, static_cast<double>(cache.pages.size()));
    return Promise<PerformanceMetrics>::resolved(std::move(metrics));
}

std::shared_ptr<Promise<bool>> HybridPDFJSI::setRenderQuality(
    const std::string& pdfId,
    double quality) {
    std::lock_guard<std::mutex> lock(cacheMutex_);
    cacheFor(pdfId).quality = static_cast<int>(quality);
    return Promise<bool>::resolved(true);
}

std::shared_ptr<Promise<KB16Support>> HybridPDFJSI::check16KBSupport() {
#ifdef __ANDROID__
    KB16Support support(
        true,
        "android",
        "16KB page size supported - Google Play compliant",
        true,
        "27.1.12297006",
        "-Wl,-z,max-page-size=16384");
#else
    KB16Support support(
        true,
        "ios",
        "iOS 16KB page size compatible - Google Play compliant",
        true,
        "",
        "");
#endif
    return Promise<KB16Support>::resolved(std::move(support));
}

std::shared_ptr<Promise<JSIStats>> HybridPDFJSI::getJSIStats() {
    JSIStats stats("1.0.0", "high", true, true, true);
    return Promise<JSIStats>::resolved(std::move(stats));
}

std::shared_ptr<Promise<bool>> HybridPDFJSI::registerPathForSearch(
    const std::string& pdfId,
    const std::string& path) {
    bool registered = platformRegisterPathForSearch(pdfId, path);
    return Promise<bool>::resolved(std::move(registered));
}

std::shared_ptr<Promise<double>> HybridPDFJSI::getPageCount(const std::string& filePath) {
    return Promise<double>::async([filePath]() {
        return platformPageCount(filePath);
    });
}

std::shared_ptr<Promise<PageSize>> HybridPDFJSI::getPageSize(const std::string& filePath, double pageIndex) {
    return Promise<PageSize>::async([filePath, pageIndex]() {
        return platformPageSize(filePath, static_cast<int>(pageIndex));
    });
}

std::shared_ptr<Promise<std::string>> HybridPDFJSI::extractTextFromPage(const std::string& filePath, double pageIndex) {
    return Promise<std::string>::async([filePath, pageIndex]() {
        return platformTextFromPage(filePath, static_cast<int>(pageIndex));
    });
}

std::shared_ptr<Promise<std::string>> HybridPDFJSI::extractTextFromPages(const std::string& filePath, const std::string& pageIndicesJson) {
    return Promise<std::string>::async([filePath, pageIndicesJson]() {
        return platformTextFromPages(filePath, pageIndicesJson);
    });
}

std::shared_ptr<Promise<std::string>> HybridPDFJSI::extractAllText(const std::string& filePath) {
    return Promise<std::string>::async([filePath]() {
        return platformAllText(filePath);
    });
}

std::shared_ptr<Promise<std::string>> HybridPDFJSI::exportPageToImage(const std::string& filePath, double pageIndex, double scale) {
    return Promise<std::string>::async([filePath, pageIndex, scale]() {
        return platformExportPageToImage(filePath, static_cast<int>(pageIndex), scale);
    });
}

std::shared_ptr<Promise<std::string>> HybridPDFJSI::exportToImages(const std::string& filePath, double scale) {
    return Promise<std::string>::async([filePath, scale]() {
        return platformExportToImages(filePath, scale);
    });
}

std::shared_ptr<Promise<std::string>> HybridPDFJSI::mergePDFs(const std::string& filePathsJson, const std::string& outputPath) {
    return Promise<std::string>::async([filePathsJson, outputPath]() {
        return platformMergePDFs(filePathsJson, outputPath);
    });
}

std::shared_ptr<Promise<std::string>> HybridPDFJSI::splitPDF(const std::string& filePath, const std::string& pageRangesJson, const std::string& outputDir) {
    return Promise<std::string>::async([filePath, pageRangesJson, outputDir]() {
        return platformSplitPDF(filePath, pageRangesJson, outputDir);
    });
}

std::shared_ptr<Promise<std::string>> HybridPDFJSI::extractPages(const std::string& filePath, const std::string& pageNumbersJson, const std::string& outputPath) {
    return Promise<std::string>::async([filePath, pageNumbersJson, outputPath]() {
        return platformExtractPages(filePath, pageNumbersJson, outputPath);
    });
}

std::shared_ptr<Promise<bool>> HybridPDFJSI::rotatePage(const std::string& filePath, double pageNumber, double degrees) {
    return Promise<bool>::async([filePath, pageNumber, degrees]() {
        return platformRotatePage(filePath, static_cast<int>(pageNumber), static_cast<int>(degrees));
    });
}

std::shared_ptr<Promise<bool>> HybridPDFJSI::deletePage(const std::string& filePath, double pageNumber) {
    return Promise<bool>::async([filePath, pageNumber]() {
        return platformDeletePage(filePath, static_cast<int>(pageNumber));
    });
}

std::shared_ptr<Promise<std::string>> HybridPDFJSI::compressPDF(const std::string& inputPath, const std::string& outputPath, double compressionLevel) {
    return Promise<std::string>::async([inputPath, outputPath, compressionLevel]() {
        return platformCompressPDF(inputPath, outputPath, static_cast<int>(compressionLevel));
    });
}

} // namespace margelo::nitro::pdfjsi
