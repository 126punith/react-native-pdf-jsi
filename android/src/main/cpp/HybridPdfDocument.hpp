#pragma once

#include "HybridPdfDocumentSpec.hpp"
#include "PdfiumSession.hpp"

#include <atomic>
#include <memory>
#include <string>
#include <utility>

namespace margelo::nitro::pdfjsi {

class HybridPdfDocument : public HybridPdfDocumentSpec {
public:
    HybridPdfDocument() : HybridObject(TAG) {}
    explicit HybridPdfDocument(const std::string& path);

    double getPageCount() override;
    std::string getPath() override;
    CacheMetrics getCacheMetrics() override;
    PerformanceMetrics getPerformanceMetrics() override;
    PageSize pageSize(double index) override;
    PageMetrics pageMetrics(double index) override;
    void setRenderQuality(double quality) override;
    void clearCache() override;
    void optimizeMemory() override;
    std::shared_ptr<Promise<RenderResult>> renderPage(double index, double scale) override;
    std::shared_ptr<Promise<bool>> preloadPages(double startPage, double endPage) override;
    std::shared_ptr<Promise<std::vector<SearchResult>>> searchText(const std::string& term, double startPage, double endPage) override;
    std::shared_ptr<Promise<std::string>> extractText(double index) override;
    std::shared_ptr<Promise<std::string>> extractTextFromPages(const std::string& pageIndicesJson) override;
    std::shared_ptr<Promise<std::string>> extractAllText() override;
    std::shared_ptr<Promise<std::string>> recognizeText(double index, bool fast) override;
    std::shared_ptr<Promise<std::string>> exportPageToImage(double index, double scale) override;
    std::shared_ptr<Promise<std::string>> exportToImages(double scale) override;
    std::shared_ptr<Promise<bool>> rotatePage(double pageNumber, double degrees) override;
    std::shared_ptr<Promise<bool>> deletePage(double pageNumber) override;
    void close() override;

private:
    struct Metrics {
        std::atomic<int> quality{2};
        std::atomic<int> renderCount{0};
        std::atomic<double> lastRenderMs{0};
        std::atomic<double> totalRenderMs{0};
    };

    std::shared_ptr<OpenPdf> requireOpen() const;

    std::shared_ptr<OpenPdf> document_;
    std::shared_ptr<Metrics> metrics_ = std::make_shared<Metrics>();
};

} // namespace margelo::nitro::pdfjsi
