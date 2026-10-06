#pragma once

#include "PageSize.hpp"
#include "SearchResult.hpp"

#include <memory>
#include <string>
#include <vector>

namespace margelo::nitro::pdfjsi {

struct PlatformPageGeometry {
    bool ok = false;
    double width = 0;
    double height = 0;
    double rotation = 0;
    std::string error;
};

struct PlatformRenderInfo {
    bool ok = false;
    double width = 0;
    double height = 0;
    double renderTimeMs = 0;
    std::string error;
};

// One open document. Its mutex covers this handle only. PDFium calls also take
// the process-wide pdfium lock, which is released before any file write.
class OpenPdf {
public:
    explicit OpenPdf(std::string path);
    ~OpenPdf();

    OpenPdf(const OpenPdf&) = delete;
    OpenPdf& operator=(const OpenPdf&) = delete;

    const std::string& path() const;
    int pageCount() const;
    PageSize pageSize(int pageIndex);
    PlatformPageGeometry pageMetrics(int pageNumber);
    PlatformRenderInfo renderPage(int pageNumber, double scale);
    std::vector<SearchResult> search(const std::string& term, int startPage, int endPage);
    std::string textFromPage(int pageIndex);
    std::string textFromPages(const std::string& pageIndicesJson);
    std::string allText();
    std::string exportPage(int pageIndex, double scale);
    std::string exportAll(double scale);
    bool rotate(int pageNumber, int degrees);
    bool removePage(int pageNumber);
    void close();

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

void pdfiumInit();
std::string pdfiumMerge(const std::vector<std::string>& filePaths, const std::string& outputPath);
std::string pdfiumSplit(const std::string& filePath, const std::string& pageRangesJson, const std::string& outputDir);
std::string pdfiumExtract(const std::string& filePath, const std::string& pageNumbersJson, const std::string& outputPath);
std::string pdfiumCompress(const std::string& inputPath, const std::string& outputPath, int compressionLevel);

} // namespace margelo::nitro::pdfjsi
