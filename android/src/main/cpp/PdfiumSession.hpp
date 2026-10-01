#pragma once

#include "PDFJSIPlatform.hpp"

#include <string>

namespace margelo::nitro::pdfjsi {

void pdfiumInit();
void pdfiumRelease(const std::string& pdfId);
bool pdfiumRegister(const std::string& pdfId, const std::string& path);
PlatformPageGeometry pdfiumPageMetrics(const std::string& pdfId, int pageNumber);
std::vector<SearchResult> pdfiumSearch(const std::string& pdfId, const std::string& searchTerm, int startPage, int endPage);
PlatformRenderInfo pdfiumRenderPage(const std::string& pdfId, int pageNumber, double scale);
double pdfiumPageCount(const std::string& filePath);
PageSize pdfiumPageSize(const std::string& filePath, int pageIndex);
std::string pdfiumTextFromPage(const std::string& filePath, int pageIndex);
std::string pdfiumTextFromPages(const std::string& filePath, const std::string& pageIndicesJson);
std::string pdfiumAllText(const std::string& filePath);
std::string pdfiumExportPage(const std::string& filePath, int pageIndex, double scale);
std::string pdfiumExportAll(const std::string& filePath, double scale);
std::string pdfiumMerge(const std::string& filePathsJson, const std::string& outputPath);
std::string pdfiumSplit(const std::string& filePath, const std::string& pageRangesJson, const std::string& outputDir);
std::string pdfiumExtract(const std::string& filePath, const std::string& pageNumbersJson, const std::string& outputPath);
bool pdfiumRotate(const std::string& filePath, int pageNumber, int degrees);
bool pdfiumDelete(const std::string& filePath, int pageNumber);
std::string pdfiumCompress(const std::string& inputPath, const std::string& outputPath, int compressionLevel);

} // namespace margelo::nitro::pdfjsi
