#pragma once

#include "AnnotationInput.hpp"
#include "OutlineItem.hpp"
#include "PdfAnnotation.hpp"
#include "PdfFormField.hpp"
#include "PdfRect.hpp"
#include "RenderedImage.hpp"
#include "SearchResult.hpp"

#include <cstdint>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>

namespace margelo::nitro::pdfjsi {

/** Thrown with a stable code from src/errors.ts; what() is `[code] message`. */
class PdfException : public std::runtime_error {
public:
    PdfException(std::string code, const std::string& message);
    const std::string& code() const noexcept { return code_; }

private:
    std::string code_;
};

[[noreturn]] void throwPdfError(const std::string& code, const std::string& message);

struct PageGeometry {
    /** Displayed size in points, rotation applied. */
    double width = 0;
    double height = 0;
    /** Page rotation in degrees: 0, 90, 180 or 270. */
    int rotation = 0;
};

struct RenderRequest {
    double maxWidth = 0;
    double maxHeight = 0;
    double scale = 2;
    bool png = false;
    int quality = 90;
    /** 0xAARRGGBB */
    uint32_t background = 0xFFFFFFFF;
    std::string outputPath;
};

struct PageLink {
    PdfRect rect{0, 0, 0, 0};
    /** Zero-based target page, or -1 for a URI link. */
    int page = -1;
    std::string uri;
};

/**
 * One open document. Edits stay in memory until save(). Its mutex covers this
 * handle only; PDFium calls also take the process-wide pdfium lock, which is
 * released before any file write.
 */
class OpenPdf {
public:
    OpenPdf(std::string path, const std::optional<std::string>& password);
    ~OpenPdf();

    OpenPdf(const OpenPdf&) = delete;
    OpenPdf& operator=(const OpenPdf&) = delete;

    const std::string& path() const;
    bool isOpen();
    int pageCount();
    bool isEncrypted();
    bool hasUnsavedChanges();
    PageGeometry geometry(int pageIndex);
    std::vector<PageGeometry> allGeometry();
    std::vector<OutlineItem> outline();

    RenderedImage render(int pageIndex, const RenderRequest& request);
    /**
     * Draws part of a page into an RGBA buffer (Android ARGB_8888 layout).
     * The whole page is `pageWidthPx` x `pageHeightPx`; the buffer shows the
     * region starting at (`offsetX`, `offsetY`).
     */
    void renderRegion(int pageIndex, void* pixels, int stride, int width, int height,
                      double pageWidthPx, double pageHeightPx, double offsetX, double offsetY,
                      uint32_t background, bool annotations = true);
    std::vector<PageLink> links(int pageIndex);

    std::vector<SearchResult> search(const std::string& term, int startPage, int endPage);
    std::string textFromPage(int pageIndex);
    std::string textFromPages(const std::string& pageIndicesJson);
    std::string allText();

    void rotate(int pageIndex, int degrees);
    void removePage(int pageIndex);
    void movePage(int from, int to);
    void insertPages(const std::string& fromPath, int atIndex, const std::vector<int>& pages,
                     const std::optional<std::string>& password);

    int addAnnotation(const AnnotationInput& input);
    std::vector<PdfAnnotation> annotations(int pageIndex);
    void removeAnnotation(int pageIndex, int index);

    std::vector<PdfFormField> formFields();
    void setFormValues(const std::unordered_map<std::string, std::string>& values);
    void flattenForms();

    /** Writes the document (with all edits) to `outputPath` and returns it. */
    std::string save(const std::string& outputPath);
    void close();

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

/** Makes an open document findable by path (weakly held), so page views can reuse it. */
void shareOpenPdf(const std::shared_ptr<OpenPdf>& document);
/** The most recently shared open document for `path`, or null. */
std::shared_ptr<OpenPdf> findSharedOpenPdf(const std::string& path);

void pdfiumInit();
std::string normalizePdfPath(const std::string& filePath);
/** Directory for rendered images. Set once at startup on Android. */
void setRenderDirectory(const std::string& directory);
std::string renderDirectory();
uint32_t parseColor(const std::string& value, uint32_t fallback);
std::string pdfiumMerge(const std::vector<std::string>& filePaths, const std::string& outputPath);
std::string pdfiumSplit(const std::string& filePath, const std::string& pageRangesJson, const std::string& outputDir);
std::string pdfiumExtract(const std::string& filePath, const std::string& pageNumbersJson, const std::string& outputPath);
std::string pdfiumCompress(const std::string& inputPath, const std::string& outputPath, int compressionLevel);

} // namespace margelo::nitro::pdfjsi
