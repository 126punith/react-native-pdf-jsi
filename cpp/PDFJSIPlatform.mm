#include "PDFJSIPlatform.hpp"

#import "PDFJSIManager.h"

#include <cstdio>
#include <stdexcept>

namespace margelo::nitro::pdfjsi {

void initPdfiumLibrary() {}

void platformReleaseDocument(const std::string&) {}

bool platformRegisterPathForSearch(const std::string& pdfId, const std::string& path) {
    NSString* pdfIdString = [NSString stringWithUTF8String:pdfId.c_str()];
    NSString* pathString = [NSString stringWithUTF8String:path.c_str()];
    return [PDFJSIManager registerPathForSearchSync:pdfIdString path:pathString];
}

std::vector<SearchResult> platformSearchTextDirect(
    const std::string& pdfId,
    const std::string& searchTerm,
    int startPage,
    int endPage) {
    NSString* pdfIdString = [NSString stringWithUTF8String:pdfId.c_str()];
    NSString* termString = [NSString stringWithUTF8String:searchTerm.c_str()];
    NSArray<NSDictionary*>* rows = [PDFJSIManager searchTextDirectSync:pdfIdString
                                                             searchTerm:termString
                                                              startPage:startPage
                                                                endPage:endPage];
    std::vector<SearchResult> results;
    results.reserve(rows.count);
    for (NSDictionary* row in rows) {
        NSString* text = row[@"text"] ?: @"";
        NSString* rect = row[@"rect"] ?: @"{}";
        results.emplace_back(
            [row[@"page"] doubleValue],
            std::string(text.UTF8String ?: ""),
            std::string(rect.UTF8String ?: ""));
    }
    return results;
}

std::string nsString(NSString* value) {
    return value.UTF8String ? std::string(value.UTF8String) : std::string();
}

std::string requireOk(NSString* value) {
    std::string encoded = nsString(value);
    if (encoded.rfind("ERR:", 0) == 0) {
        throw std::runtime_error(encoded.substr(4));
    }
    return encoded;
}

PlatformPageGeometry parseGeometry(NSString* encoded) {
    PlatformPageGeometry geometry;
    std::string value = nsString(encoded);
    if (value.rfind("ERR:", 0) == 0) {
        geometry.error = value.substr(4);
        return geometry;
    }
    double width = 0;
    double height = 0;
    double rotation = 0;
    if (sscanf(value.c_str(), "%lf|%lf|%lf", &width, &height, &rotation) == 3 && width > 0 && height > 0) {
        geometry.ok = true;
        geometry.width = width;
        geometry.height = height;
        geometry.rotation = rotation;
    } else {
        geometry.error = value;
    }
    return geometry;
}

PlatformRenderInfo parseRender(NSString* encoded) {
    PlatformRenderInfo info;
    std::string value = nsString(encoded);
    if (value.rfind("ERR:", 0) == 0) {
        info.error = value.substr(4);
        return info;
    }
    double width = 0;
    double height = 0;
    double renderTimeMs = 0;
    if (sscanf(value.c_str(), "%lf|%lf|%lf", &width, &height, &renderTimeMs) == 3 && width > 0 && height > 0) {
        info.ok = true;
        info.width = width;
        info.height = height;
        info.renderTimeMs = renderTimeMs;
    } else {
        info.error = value;
    }
    return info;
}

PlatformPageGeometry platformPageMetrics(const std::string& pdfId, int pageNumber) {
    return parseGeometry([PDFJSIManager nitroPageMetrics:[NSString stringWithUTF8String:pdfId.c_str()] pageNumber:pageNumber]);
}

PlatformRenderInfo platformRenderPage(const std::string& pdfId, int pageNumber, double scale) {
    return parseRender([PDFJSIManager nitroRenderPage:[NSString stringWithUTF8String:pdfId.c_str()] pageNumber:pageNumber scale:scale]);
}

double platformPageCount(const std::string& filePath) {
    return std::stod(requireOk([PDFJSIManager nitroPageCount:[NSString stringWithUTF8String:filePath.c_str()]]));
}

PageSize platformPageSize(const std::string& filePath, int pageIndex) {
    PlatformPageGeometry geometry = parseGeometry([PDFJSIManager nitroPageSize:[NSString stringWithUTF8String:filePath.c_str()] pageIndex:pageIndex]);
    if (!geometry.ok) {
        throw std::runtime_error(geometry.error.empty() ? "pageSize failed" : geometry.error);
    }
    return PageSize(geometry.width, geometry.height);
}

std::string platformTextFromPage(const std::string& filePath, int pageIndex) {
    return requireOk([PDFJSIManager nitroTextFromPage:[NSString stringWithUTF8String:filePath.c_str()] pageIndex:pageIndex]);
}

std::string platformTextFromPages(const std::string& filePath, const std::string& pageIndicesJson) {
    return requireOk([PDFJSIManager nitroTextFromPages:[NSString stringWithUTF8String:filePath.c_str()] pageIndicesJson:[NSString stringWithUTF8String:pageIndicesJson.c_str()]]);
}

std::string platformAllText(const std::string& filePath) {
    return requireOk([PDFJSIManager nitroAllText:[NSString stringWithUTF8String:filePath.c_str()]]);
}

std::string platformExportPageToImage(const std::string& filePath, int pageIndex, double scale) {
    return requireOk([PDFJSIManager nitroExportPageToImage:[NSString stringWithUTF8String:filePath.c_str()] pageIndex:pageIndex scale:scale]);
}

std::string platformExportToImages(const std::string& filePath, double scale) {
    return requireOk([PDFJSIManager nitroExportToImages:[NSString stringWithUTF8String:filePath.c_str()] scale:scale]);
}

std::string platformMergePDFs(const std::vector<std::string>& filePaths, const std::string& outputPath) {
    NSMutableArray* paths = [NSMutableArray arrayWithCapacity:filePaths.size()];
    for (const std::string& path : filePaths) {
        [paths addObject:[NSString stringWithUTF8String:path.c_str()]];
    }
    NSError* error = nil;
    NSData* data = [NSJSONSerialization dataWithJSONObject:paths options:0 error:&error];
    if (data == nil) {
        throw std::runtime_error("Failed to encode merge paths");
    }
    NSString* json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    return requireOk([PDFJSIManager nitroMergePDFs:json outputPath:[NSString stringWithUTF8String:outputPath.c_str()]]);
}

std::string platformSplitPDF(const std::string& filePath, const std::string& pageRangesJson, const std::string& outputDir) {
    return requireOk([PDFJSIManager nitroSplitPDF:[NSString stringWithUTF8String:filePath.c_str()] pageRangesJson:[NSString stringWithUTF8String:pageRangesJson.c_str()] outputDir:[NSString stringWithUTF8String:outputDir.c_str()]]);
}

std::string platformExtractPages(const std::string& filePath, const std::string& pageNumbersJson, const std::string& outputPath) {
    return requireOk([PDFJSIManager nitroExtractPages:[NSString stringWithUTF8String:filePath.c_str()] pageNumbersJson:[NSString stringWithUTF8String:pageNumbersJson.c_str()] outputPath:[NSString stringWithUTF8String:outputPath.c_str()]]);
}

bool platformRotatePage(const std::string& filePath, int pageNumber, int degrees) {
    return [PDFJSIManager nitroRotatePage:[NSString stringWithUTF8String:filePath.c_str()] pageNumber:pageNumber degrees:degrees];
}

bool platformDeletePage(const std::string& filePath, int pageNumber) {
    return [PDFJSIManager nitroDeletePage:[NSString stringWithUTF8String:filePath.c_str()] pageNumber:pageNumber];
}

std::string platformCompressPDF(const std::string& inputPath, const std::string& outputPath, int compressionLevel) {
    return requireOk([PDFJSIManager nitroCompressPDF:[NSString stringWithUTF8String:inputPath.c_str()] outputPath:[NSString stringWithUTF8String:outputPath.c_str()] compressionLevel:compressionLevel]);
}

} // namespace margelo::nitro::pdfjsi
