#include "HybridPdfDocument.hpp"

#include "PdfJni.hpp"

#include <cmath>
#include <cstdio>
#include <filesystem>
#include <utility>

namespace margelo::nitro::pdfjsi {

namespace {

size_t fileSizeOrZero(const std::string& path) {
    std::error_code error;
    const auto size = std::filesystem::file_size(path, error);
    return error ? 0 : static_cast<size_t>(size);
}

int toIndex(double value, const char* name) {
    if (!std::isfinite(value) || std::floor(value) != value || std::fabs(value) > 1e9) {
        throwPdfError("invalid-argument", std::string(name) + " must be an integer");
    }
    return static_cast<int>(value);
}

std::optional<double> positive(const std::optional<double>& value) {
    if (value.has_value() && (!std::isfinite(*value) || *value <= 0)) {
        throwPdfError("invalid-argument", "Sizes and scale must be positive numbers");
    }
    return value;
}

int qualityOf(const std::optional<double>& quality) {
    if (!quality.has_value()) {
        return 90;
    }
    if (!std::isfinite(*quality) || *quality < 0 || *quality > 100) {
        throwPdfError("invalid-argument", "quality must be between 0 and 100");
    }
    return std::max(1, static_cast<int>(std::lround(*quality)));
}

RenderRequest requestFrom(const std::optional<RenderOptions>& options) {
    RenderRequest request;
    if (!options.has_value()) {
        return request;
    }
    request.maxWidth = positive(options->maxWidth).value_or(0);
    request.maxHeight = positive(options->maxHeight).value_or(0);
    request.scale = positive(options->scale).value_or(2);
    request.png = options->format.has_value() && *options->format == ImageFormat::PNG;
    request.quality = qualityOf(options->quality);
    request.background = parseColor(options->background.value_or(""), 0xFFFFFFFF);
    request.outputPath = options->outputPath.value_or("");
    return request;
}

} // namespace

HybridPdfDocument::HybridPdfDocument(std::shared_ptr<OpenPdf> document)
    : HybridObject(TAG), document_(std::move(document)) {
    externalMemorySize_ = fileSizeOrZero(document_->path());
}

size_t HybridPdfDocument::getExternalMemorySize() noexcept {
    return externalMemorySize_.load();
}

std::shared_ptr<OpenPdf> HybridPdfDocument::requireOpen() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (document_ == nullptr) {
        throwPdfError("document-closed", "The PDF document is closed");
    }
    return document_;
}

double HybridPdfDocument::getPageCount() {
    return static_cast<double>(requireOpen()->pageCount());
}

std::string HybridPdfDocument::getPath() {
    return requireOpen()->path();
}

bool HybridPdfDocument::getIsEncrypted() {
    return requireOpen()->isEncrypted();
}

bool HybridPdfDocument::getHasUnsavedChanges() {
    return requireOpen()->hasUnsavedChanges();
}

PageSize HybridPdfDocument::pageSize(double index) {
    const PageGeometry size = requireOpen()->geometry(toIndex(index, "index"));
    return PageSize(size.width, size.height);
}

PageMetrics HybridPdfDocument::pageMetrics(double index) {
    const int page = toIndex(index, "index");
    const PageGeometry size = requireOpen()->geometry(page);
    return PageMetrics(page, size.width, size.height, size.rotation);
}

std::shared_ptr<Promise<std::vector<OutlineItem>>> HybridPdfDocument::getOutline() {
    auto document = requireOpen();
    return Promise<std::vector<OutlineItem>>::async([document]() { return document->outline(); });
}

std::shared_ptr<Promise<RenderedImage>> HybridPdfDocument::renderPage(double index, const std::optional<RenderOptions>& options) {
    auto document = requireOpen();
    const int page = toIndex(index, "index");
    const RenderRequest request = requestFrom(options);
    return Promise<RenderedImage>::async([document, page, request]() {
        ensureRenderDirectory();
        return document->render(page, request);
    });
}

std::shared_ptr<Promise<std::vector<RenderedImage>>> HybridPdfDocument::renderThumbnails(
    const std::optional<ThumbnailOptions>& options) {
    auto document = requireOpen();
    RenderRequest base;
    std::vector<int> pages;
    std::string outputDir;
    if (options.has_value()) {
        base.maxWidth = positive(options->maxWidth).value_or(0);
        base.maxHeight = positive(options->maxHeight).value_or(0);
        base.png = options->format.has_value() && *options->format == ImageFormat::PNG;
        base.quality = qualityOf(options->quality);
        base.background = parseColor(options->background.value_or(""), 0xFFFFFFFF);
        outputDir = normalizePdfPath(options->outputDir.value_or(""));
        if (options->pages.has_value()) {
            for (double page : *options->pages) {
                pages.push_back(toIndex(page, "pages"));
            }
        }
    }
    if (base.maxWidth <= 0 && base.maxHeight <= 0) {
        base.maxWidth = 200;
    }
    const bool allPages = !options.has_value() || !options->pages.has_value();
    return Promise<std::vector<RenderedImage>>::async([document, base, pages, outputDir, allPages]() {
        ensureRenderDirectory();
        std::vector<int> targets = pages;
        if (allPages) {
            const int count = document->pageCount();
            for (int index = 0; index < count; index++) {
                targets.push_back(index);
            }
        }
        if (!outputDir.empty()) {
            std::error_code error;
            std::filesystem::create_directories(outputDir, error);
        }
        std::vector<RenderedImage> images;
        images.reserve(targets.size());
        for (int page : targets) {
            RenderRequest request = base;
            if (!outputDir.empty()) {
                request.outputPath = outputDir + "/thumb-" + std::to_string(page) + (base.png ? ".png" : ".jpg");
            }
            images.push_back(document->render(page, request));
        }
        return images;
    });
}

std::shared_ptr<Promise<std::vector<SearchResult>>> HybridPdfDocument::searchText(const std::string& term, double startPage,
                                                                                  double endPage) {
    auto document = requireOpen();
    const int start = toIndex(startPage, "startPage");
    const int end = toIndex(endPage, "endPage");
    return Promise<std::vector<SearchResult>>::async([document, term, start, end]() {
        return document->search(term, start, end);
    });
}

std::shared_ptr<Promise<std::string>> HybridPdfDocument::extractText(double index) {
    auto document = requireOpen();
    const int page = toIndex(index, "index");
    return Promise<std::string>::async([document, page]() { return document->textFromPage(page); });
}

std::shared_ptr<Promise<std::string>> HybridPdfDocument::extractTextFromPages(const std::string& pageIndicesJson) {
    auto document = requireOpen();
    return Promise<std::string>::async([document, pageIndicesJson]() { return document->textFromPages(pageIndicesJson); });
}

std::shared_ptr<Promise<std::string>> HybridPdfDocument::extractAllText() {
    auto document = requireOpen();
    return Promise<std::string>::async([document]() { return document->allText(); });
}

std::shared_ptr<Promise<std::string>> HybridPdfDocument::recognizeText(double index, bool fast) {
    auto document = requireOpen();
    const int page = toIndex(index, "index");
    return Promise<std::string>::async([document, page, fast]() {
        if (!ocrAvailable()) {
            throwPdfError("unsupported-operation", "OCR is disabled. Set pdfJsiEnableOcr=true and rebuild.");
        }
        ensureRenderDirectory();
        RenderRequest request;
        request.scale = fast ? 1.5 : 200.0 / 72.0;
        request.png = true;
        const RenderedImage image = document->render(page, request);
        try {
            std::string text = recognizeImage(image.path);
            std::remove(image.path.c_str());
            return text;
        } catch (...) {
            std::remove(image.path.c_str());
            throw;
        }
    });
}

std::shared_ptr<Promise<void>> HybridPdfDocument::rotatePage(double index, double degrees) {
    auto document = requireOpen();
    const int page = toIndex(index, "index");
    const int turn = toIndex(degrees, "degrees");
    return Promise<void>::async([document, page, turn]() { document->rotate(page, turn); });
}

std::shared_ptr<Promise<void>> HybridPdfDocument::deletePage(double index) {
    auto document = requireOpen();
    const int page = toIndex(index, "index");
    return Promise<void>::async([document, page]() { document->removePage(page); });
}

std::shared_ptr<Promise<void>> HybridPdfDocument::movePage(double from, double to) {
    auto document = requireOpen();
    const int source = toIndex(from, "from");
    const int target = toIndex(to, "to");
    return Promise<void>::async([document, source, target]() { document->movePage(source, target); });
}

std::shared_ptr<Promise<void>> HybridPdfDocument::insertPages(const std::string& fromPath, double atIndex,
                                                              const std::optional<std::vector<double>>& pages,
                                                              const std::optional<std::string>& password) {
    auto document = requireOpen();
    const int at = toIndex(atIndex, "atIndex");
    std::vector<int> indices;
    if (pages.has_value()) {
        for (double page : *pages) {
            indices.push_back(toIndex(page, "pages"));
        }
        if (indices.empty()) {
            throwPdfError("invalid-argument", "pages must not be empty");
        }
    }
    return Promise<void>::async([document, fromPath, at, indices, password]() {
        document->insertPages(fromPath, at, indices, password);
    });
}

std::shared_ptr<Promise<double>> HybridPdfDocument::addAnnotation(const AnnotationInput& annotation) {
    auto document = requireOpen();
    toIndex(annotation.page, "page");
    return Promise<double>::async([document, annotation]() {
        return static_cast<double>(document->addAnnotation(annotation));
    });
}

std::shared_ptr<Promise<std::vector<PdfAnnotation>>> HybridPdfDocument::getAnnotations(double page) {
    auto document = requireOpen();
    const int index = toIndex(page, "page");
    return Promise<std::vector<PdfAnnotation>>::async([document, index]() { return document->annotations(index); });
}

std::shared_ptr<Promise<void>> HybridPdfDocument::removeAnnotation(double page, double index) {
    auto document = requireOpen();
    const int pageIndex = toIndex(page, "page");
    const int annotationIndex = toIndex(index, "index");
    return Promise<void>::async([document, pageIndex, annotationIndex]() {
        document->removeAnnotation(pageIndex, annotationIndex);
    });
}

std::shared_ptr<Promise<std::vector<PdfFormField>>> HybridPdfDocument::getFormFields() {
    auto document = requireOpen();
    return Promise<std::vector<PdfFormField>>::async([document]() { return document->formFields(); });
}

std::shared_ptr<Promise<void>> HybridPdfDocument::setFormFieldValues(const std::unordered_map<std::string, std::string>& values) {
    auto document = requireOpen();
    return Promise<void>::async([document, values]() { document->setFormValues(values); });
}

std::shared_ptr<Promise<void>> HybridPdfDocument::flattenForms() {
    auto document = requireOpen();
    return Promise<void>::async([document]() { document->flattenForms(); });
}

std::shared_ptr<Promise<std::string>> HybridPdfDocument::save(const std::string& outputPath,
                                                              const std::optional<SaveOptions>& options) {
    auto document = requireOpen();
    if (options.has_value() && (options->userPassword.has_value() || options->ownerPassword.has_value() ||
                                options->permissions.has_value())) {
        throwPdfError("unsupported-operation", "Saving with a password or permissions is not supported on Android");
    }
    return Promise<std::string>::async([document, outputPath]() { return document->save(outputPath); });
}

void HybridPdfDocument::close() {
    std::shared_ptr<OpenPdf> document;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        document = std::move(document_);
    }
    if (document != nullptr) {
        document->close();
    }
    externalMemorySize_ = 0;
}

} // namespace margelo::nitro::pdfjsi
