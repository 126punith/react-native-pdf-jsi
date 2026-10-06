#pragma once

#include "HybridPdfLibrarySpec.hpp"

namespace margelo::nitro::pdfjsi {

class HybridPdfLibrary : public HybridPdfLibrarySpec {
public:
    HybridPdfLibrary() : HybridObject(TAG) {}

    JSIStats getJsiStats() override;
    KB16Support getKb16Support() override;
    bool getOcrAvailable() override;
    std::shared_ptr<Promise<std::shared_ptr<HybridPdfDocumentSpec>>> open(const std::string& path) override;
    std::shared_ptr<Promise<std::string>> mergePDFs(const std::vector<std::string>& filePaths, const std::string& outputPath) override;
    std::shared_ptr<Promise<std::string>> splitPDF(const std::string& filePath, const std::string& pageRangesJson, const std::string& outputDir) override;
    std::shared_ptr<Promise<std::string>> extractPages(const std::string& filePath, const std::string& pageNumbersJson, const std::string& outputPath) override;
    std::shared_ptr<Promise<std::string>> compressPDF(const std::string& inputPath, const std::string& outputPath, double compressionLevel) override;
    std::shared_ptr<Promise<PdfCacheInfo>> storeCachedPdf(const std::string& base64, const std::string& identifier) override;
    std::shared_ptr<Promise<std::string>> cachedPdfPath(const std::string& identifier) override;
    std::shared_ptr<Promise<bool>> removeCachedPdf(const std::string& identifier) override;
    std::shared_ptr<Promise<bool>> clearPdfCache() override;
    std::shared_ptr<Promise<double>> clearExpiredPdfs() override;
    std::shared_ptr<Promise<PdfCacheStats>> pdfCacheStats() override;
};

} // namespace margelo::nitro::pdfjsi
