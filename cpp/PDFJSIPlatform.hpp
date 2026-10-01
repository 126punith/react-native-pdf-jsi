#pragma once

#include "PageSize.hpp"
#include "SearchResult.hpp"

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

void initPdfiumLibrary();
void platformReleaseDocument(const std::string& pdfId);
bool platformRegisterPathForSearch(const std::string& pdfId, const std::string& path);
std::vector<SearchResult> platformSearchTextDirect(const std::string& pdfId, const std::string& searchTerm, int startPage, int endPage);
PlatformPageGeometry platformPageMetrics(const std::string& pdfId, int pageNumber);
PlatformRenderInfo platformRenderPage(const std::string& pdfId, int pageNumber, double scale);
double platformPageCount(const std::string& filePath);
PageSize platformPageSize(const std::string& filePath, int pageIndex);
std::string platformTextFromPage(const std::string& filePath, int pageIndex);
std::string platformTextFromPages(const std::string& filePath, const std::string& pageIndicesJson);
std::string platformAllText(const std::string& filePath);
std::string platformExportPageToImage(const std::string& filePath, int pageIndex, double scale);
std::string platformExportToImages(const std::string& filePath, double scale);
std::string platformMergePDFs(const std::vector<std::string>& filePaths, const std::string& outputPath);
std::string platformSplitPDF(const std::string& filePath, const std::string& pageRangesJson, const std::string& outputDir);
std::string platformExtractPages(const std::string& filePath, const std::string& pageNumbersJson, const std::string& outputPath);
bool platformRotatePage(const std::string& filePath, int pageNumber, int degrees);
bool platformDeletePage(const std::string& filePath, int pageNumber);
std::string platformCompressPDF(const std::string& inputPath, const std::string& outputPath, int compressionLevel);

} // namespace margelo::nitro::pdfjsi
