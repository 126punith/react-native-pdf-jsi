#pragma once

#include "HybridPdfDocumentSpec.hpp"
#include "PdfiumSession.hpp"

#include <atomic>
#include <memory>
#include <mutex>
#include <string>

namespace margelo::nitro::pdfjsi {

class HybridPdfDocument : public HybridPdfDocumentSpec {
public:
    HybridPdfDocument() : HybridObject(TAG) {}
    explicit HybridPdfDocument(std::shared_ptr<OpenPdf> document);

    double getPageCount() override;
    std::string getPath() override;
    bool getIsEncrypted() override;
    bool getHasUnsavedChanges() override;
    PageSize pageSize(double index) override;
    PageMetrics pageMetrics(double index) override;
    std::shared_ptr<Promise<std::vector<OutlineItem>>> getOutline() override;
    std::shared_ptr<Promise<RenderedImage>> renderPage(double index, const std::optional<RenderOptions>& options) override;
    std::shared_ptr<Promise<std::vector<RenderedImage>>> renderThumbnails(const std::optional<ThumbnailOptions>& options) override;
    std::shared_ptr<Promise<std::vector<SearchResult>>> searchText(const std::string& term, double startPage, double endPage) override;
    std::shared_ptr<Promise<std::string>> extractText(double index) override;
    std::shared_ptr<Promise<std::string>> extractTextFromPages(const std::string& pageIndicesJson) override;
    std::shared_ptr<Promise<std::string>> extractAllText() override;
    std::shared_ptr<Promise<std::string>> recognizeText(double index, bool fast) override;
    std::shared_ptr<Promise<void>> rotatePage(double index, double degrees) override;
    std::shared_ptr<Promise<void>> deletePage(double index) override;
    std::shared_ptr<Promise<void>> movePage(double from, double to) override;
    std::shared_ptr<Promise<void>> insertPages(const std::string& fromPath, double atIndex,
                                               const std::optional<std::vector<double>>& pages,
                                               const std::optional<std::string>& password) override;
    std::shared_ptr<Promise<double>> addAnnotation(const AnnotationInput& annotation) override;
    std::shared_ptr<Promise<std::vector<PdfAnnotation>>> getAnnotations(double page) override;
    std::shared_ptr<Promise<void>> removeAnnotation(double page, double index) override;
    std::shared_ptr<Promise<std::vector<PdfFormField>>> getFormFields() override;
    std::shared_ptr<Promise<void>> setFormFieldValues(const std::unordered_map<std::string, std::string>& values) override;
    std::shared_ptr<Promise<void>> flattenForms() override;
    std::shared_ptr<Promise<std::string>> save(const std::string& outputPath, const std::optional<SaveOptions>& options) override;
    void close() override;

    /** Approximates PDFium's footprint by file size so Hermes sees the native cost of an open document. */
    size_t getExternalMemorySize() noexcept override;

private:
    std::shared_ptr<OpenPdf> requireOpen();

    std::mutex mutex_;
    std::shared_ptr<OpenPdf> document_;
    std::atomic<size_t> externalMemorySize_{0};
};

} // namespace margelo::nitro::pdfjsi
