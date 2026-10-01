#include "PDFJSIPlatform.hpp"
#include "PdfiumSession.hpp"

#include <android/log.h>

namespace margelo::nitro::pdfjsi {

namespace {

void logCpp(const char* name) {
    __android_log_print(ANDROID_LOG_DEBUG, "PDFPath", "cpp %s", name);
}

} // namespace

void initPdfiumLibrary() {
    pdfiumInit();
}

void platformReleaseDocument(const std::string& pdfId) {
    logCpp("clearCacheDirect");
    pdfiumRelease(pdfId);
}

bool platformRegisterPathForSearch(const std::string& pdfId, const std::string& path) {
    logCpp("registerPathForSearch");
    return pdfiumRegister(pdfId, path);
}

std::vector<SearchResult> platformSearchTextDirect(
    const std::string& pdfId,
    const std::string& searchTerm,
    int startPage,
    int endPage) {
    logCpp("searchTextDirect");
    return pdfiumSearch(pdfId, searchTerm, startPage, endPage);
}

PlatformPageGeometry platformPageMetrics(const std::string& pdfId, int pageNumber) {
    logCpp("pageMetrics");
    return pdfiumPageMetrics(pdfId, pageNumber);
}

PlatformRenderInfo platformRenderPage(const std::string& pdfId, int pageNumber, double scale) {
    logCpp("renderPage");
    return pdfiumRenderPage(pdfId, pageNumber, scale);
}

double platformPageCount(const std::string& filePath) {
    logCpp("pageCount");
    return pdfiumPageCount(filePath);
}

PageSize platformPageSize(const std::string& filePath, int pageIndex) {
    logCpp("pageSize");
    return pdfiumPageSize(filePath, pageIndex);
}

std::string platformTextFromPage(const std::string& filePath, int pageIndex) {
    logCpp("textFromPage");
    return pdfiumTextFromPage(filePath, pageIndex);
}

std::string platformTextFromPages(const std::string& filePath, const std::string& pageIndicesJson) {
    logCpp("textFromPages");
    return pdfiumTextFromPages(filePath, pageIndicesJson);
}

std::string platformAllText(const std::string& filePath) {
    logCpp("allText");
    return pdfiumAllText(filePath);
}

std::string platformExportPageToImage(const std::string& filePath, int pageIndex, double scale) {
    logCpp("exportPageToImage");
    return pdfiumExportPage(filePath, pageIndex, scale);
}

std::string platformExportToImages(const std::string& filePath, double scale) {
    logCpp("exportToImages");
    return pdfiumExportAll(filePath, scale);
}

std::string platformMergePDFs(const std::vector<std::string>& filePaths, const std::string& outputPath) {
    logCpp("mergePdfs");
    return pdfiumMerge(filePaths, outputPath);
}

std::string platformSplitPDF(const std::string& filePath, const std::string& pageRangesJson, const std::string& outputDir) {
    logCpp("splitPdf");
    return pdfiumSplit(filePath, pageRangesJson, outputDir);
}

std::string platformExtractPages(const std::string& filePath, const std::string& pageNumbersJson, const std::string& outputPath) {
    logCpp("extractPages");
    return pdfiumExtract(filePath, pageNumbersJson, outputPath);
}

bool platformRotatePage(const std::string& filePath, int pageNumber, int degrees) {
    logCpp("rotatePage");
    return pdfiumRotate(filePath, pageNumber, degrees);
}

bool platformDeletePage(const std::string& filePath, int pageNumber) {
    logCpp("deletePage");
    return pdfiumDelete(filePath, pageNumber);
}

std::string platformCompressPDF(const std::string& inputPath, const std::string& outputPath, int compressionLevel) {
    logCpp("compressPdf");
    return pdfiumCompress(inputPath, outputPath, compressionLevel);
}

} // namespace margelo::nitro::pdfjsi
