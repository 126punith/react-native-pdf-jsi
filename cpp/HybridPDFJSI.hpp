#pragma once

#include "HybridPDFJSISpec.hpp"

#include <mutex>
#include <unordered_map>

namespace margelo::nitro::pdfjsi {

class HybridPDFJSI : public HybridPDFJSISpec {
public:
    HybridPDFJSI() : HybridObject(TAG) {}

    std::shared_ptr<Promise<RenderResult>> renderPageDirect(const std::string& pdfId, double pageNumber, double scale, const std::string& base64Data) override;
    std::shared_ptr<Promise<PageMetrics>> getPageMetrics(const std::string& pdfId, double pageNumber) override;
    std::shared_ptr<Promise<bool>> preloadPagesDirect(const std::string& pdfId, double startPage, double endPage) override;
    std::shared_ptr<Promise<CacheMetrics>> getCacheMetrics(const std::string& pdfId) override;
    std::shared_ptr<Promise<bool>> clearCacheDirect(const std::string& pdfId, const std::string& cacheType) override;
    std::shared_ptr<Promise<bool>> optimizeMemory(const std::string& pdfId) override;
    std::shared_ptr<Promise<std::vector<SearchResult>>> searchTextDirect(const std::string& pdfId, const std::string& searchTerm, double startPage, double endPage) override;
    std::shared_ptr<Promise<PerformanceMetrics>> getPerformanceMetrics(const std::string& pdfId) override;
    std::shared_ptr<Promise<bool>> setRenderQuality(const std::string& pdfId, double quality) override;
    std::shared_ptr<Promise<KB16Support>> check16KBSupport() override;
    std::shared_ptr<Promise<JSIStats>> getJSIStats() override;
    std::shared_ptr<Promise<bool>> registerPathForSearch(const std::string& pdfId, const std::string& path) override;
    std::shared_ptr<Promise<double>> getPageCount(const std::string& filePath) override;
    std::shared_ptr<Promise<PageSize>> getPageSize(const std::string& filePath, double pageIndex) override;
    std::shared_ptr<Promise<std::string>> extractTextFromPage(const std::string& filePath, double pageIndex) override;
    std::shared_ptr<Promise<std::string>> extractTextFromPages(const std::string& filePath, const std::string& pageIndicesJson) override;
    std::shared_ptr<Promise<std::string>> extractAllText(const std::string& filePath) override;
    std::shared_ptr<Promise<std::string>> exportPageToImage(const std::string& filePath, double pageIndex, double scale) override;
    std::shared_ptr<Promise<std::string>> exportToImages(const std::string& filePath, double scale) override;
    std::shared_ptr<Promise<std::string>> mergePDFs(const std::vector<std::string>& filePaths, const std::string& outputPath) override;
    std::shared_ptr<Promise<std::string>> splitPDF(const std::string& filePath, const std::string& pageRangesJson, const std::string& outputDir) override;
    std::shared_ptr<Promise<std::string>> extractPages(const std::string& filePath, const std::string& pageNumbersJson, const std::string& outputPath) override;
    std::shared_ptr<Promise<bool>> rotatePage(const std::string& filePath, double pageNumber, double degrees) override;
    std::shared_ptr<Promise<bool>> deletePage(const std::string& filePath, double pageNumber) override;
    std::shared_ptr<Promise<std::string>> compressPDF(const std::string& inputPath, const std::string& outputPath, double compressionLevel) override;

private:
    struct CachedPage {
        PageMetrics metrics;
    };

    struct DocumentCache {
        std::unordered_map<int, CachedPage> pages;
        int quality = 2;
        int hits = 0;
        int misses = 0;
        double lastRenderMs = 0;
        double totalRenderMs = 0;
        int renderCount = 0;
    };

    DocumentCache& cacheFor(const std::string& pdfId);
    void rememberPage(const std::string& pdfId, int pageNumber, const PageMetrics& metrics);
    void recordRender(const std::string& pdfId, double renderTimeMs);

    std::mutex cacheMutex_;
    std::unordered_map<std::string, DocumentCache> caches_;
};

} // namespace margelo::nitro::pdfjsi
