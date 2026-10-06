#include "PdfiumSession.hpp"

#include "fpdf_edit.h"
#include "fpdf_ppo.h"
#include "fpdf_save.h"
#include "fpdf_text.h"
#include "fpdfview.h"

#include <android/log.h>

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"

#include <algorithm>
#include <cctype>
#include <utility>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <memory>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <vector>

#include <sys/stat.h>

namespace margelo::nitro::pdfjsi {

namespace {

// PDFium allows only one call at a time (fpdfview.h). This lock covers those
// calls and nothing else — file IO happens after it is released.
std::mutex gPdfiumMutex;
std::once_flag gInitOnce;

std::string normalizePath(const std::string& filePath) {
    const std::string prefix = "file://";
    if (filePath.rfind(prefix, 0) == 0) {
        return filePath.substr(prefix.size());
    }
    return filePath;
}

void ensureLibrary() {
    std::call_once(gInitOnce, []() { FPDF_InitLibrary(); });
}

void ensureParent(const std::string& path);

FPDF_DOCUMENT loadFresh(const std::string& path) {
    ensureLibrary();
    FPDF_DOCUMENT document = FPDF_LoadDocument(path.c_str(), nullptr);
    if (document == nullptr) {
        throw std::runtime_error("Failed to open PDF: " + path);
    }
    return document;
}

void writeBytes(const std::string& path, const std::vector<unsigned char>& bytes) {
    ensureParent(path);
    FILE* file = std::fopen(path.c_str(), "wb");
    if (file == nullptr) {
        throw std::runtime_error("Failed to write " + path);
    }
    const size_t written = bytes.empty() ? 0 : std::fwrite(bytes.data(), 1, bytes.size(), file);
    std::fclose(file);
    if (written != bytes.size()) {
        std::remove(path.c_str());
        throw std::runtime_error("Failed to write " + path);
    }
}

int clampPage(FPDF_DOCUMENT document, int pageIndex) {
    const int count = FPDF_GetPageCount(document);
    if (pageIndex < 0 || pageIndex >= count) {
        throw std::runtime_error("Page index out of range");
    }
    return pageIndex;
}

struct PageSizePoints {
    double width = 0;
    double height = 0;
    int rotation = 0;
};

PageSizePoints pageGeometry(FPDF_DOCUMENT document, int pageIndex) {
    clampPage(document, pageIndex);
    double width = 0;
    double height = 0;
    if (FPDF_GetPageSizeByIndex(document, pageIndex, &width, &height) == 0 || width <= 0 || height <= 0) {
        throw std::runtime_error("Failed to read page size");
    }
    PageSizePoints size;
    size.width = width;
    size.height = height;
    FPDF_PAGE page = FPDF_LoadPage(document, pageIndex);
    if (page != nullptr) {
        size.rotation = FPDFPage_GetRotation(page);
        FPDF_ClosePage(page);
    }
    return size;
}

std::string utf16ToUtf8(const unsigned short* text, int length) {
    std::string out;
    for (int index = 0; index < length; index++) {
        uint32_t code = text[index];
        if (code == 0) {
            break;
        }
        if (code >= 0xD800 && code <= 0xDBFF && index + 1 < length) {
            const uint32_t low = text[++index];
            if (low >= 0xDC00 && low <= 0xDFFF) {
                code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
            }
        }
        if (code < 0x80) {
            out.push_back(static_cast<char>(code));
        } else if (code < 0x800) {
            out.push_back(static_cast<char>(0xC0 | (code >> 6)));
            out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
        } else if (code < 0x10000) {
            out.push_back(static_cast<char>(0xE0 | (code >> 12)));
            out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
        } else {
            out.push_back(static_cast<char>(0xF0 | (code >> 18)));
            out.push_back(static_cast<char>(0x80 | ((code >> 12) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
        }
    }
    return out;
}

std::vector<unsigned short> utf8ToUtf16(const std::string& text) {
    std::vector<unsigned short> out;
    for (size_t index = 0; index < text.size();) {
        const unsigned char lead = static_cast<unsigned char>(text[index]);
        uint32_t code = lead;
        size_t extra = 0;
        if (lead < 0x80) {
            extra = 0;
        } else if ((lead & 0xE0) == 0xC0) {
            code = lead & 0x1F;
            extra = 1;
        } else if ((lead & 0xF0) == 0xE0) {
            code = lead & 0x0F;
            extra = 2;
        } else {
            code = lead & 0x07;
            extra = 3;
        }
        if (index + extra >= text.size()) {
            break;
        }
        for (size_t step = 1; step <= extra; step++) {
            code = (code << 6) | (static_cast<unsigned char>(text[index + step]) & 0x3F);
        }
        index += extra + 1;
        if (code <= 0xFFFF) {
            out.push_back(static_cast<unsigned short>(code));
        } else {
            code -= 0x10000;
            out.push_back(static_cast<unsigned short>(0xD800 + (code >> 10)));
            out.push_back(static_cast<unsigned short>(0xDC00 + (code & 0x3FF)));
        }
    }
    out.push_back(0);
    return out;
}

std::string textOnPage(FPDF_DOCUMENT document, int pageIndex) {
    if (pageIndex < 0 || pageIndex >= FPDF_GetPageCount(document)) {
        return "";
    }
    FPDF_PAGE page = FPDF_LoadPage(document, pageIndex);
    if (page == nullptr) {
        return "";
    }
    FPDF_TEXTPAGE textPage = FPDFText_LoadPage(page);
    std::string text;
    if (textPage != nullptr) {
        const int chars = FPDFText_CountChars(textPage);
        if (chars > 0) {
            std::vector<unsigned short> buffer(static_cast<size_t>(chars) + 1);
            FPDFText_GetText(textPage, 0, chars, buffer.data());
            text = utf16ToUtf8(buffer.data(), chars);
        }
        FPDFText_ClosePage(textPage);
    }
    FPDF_ClosePage(page);
    return text;
}

std::string jsonEscape(const std::string& value) {
    std::string out;
    out.reserve(value.size());
    for (unsigned char ch : value) {
        switch (ch) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (ch < 0x20) {
                    char hex[8];
                    std::snprintf(hex, sizeof(hex), "\\u%04x", ch);
                    out += hex;
                } else {
                    out.push_back(static_cast<char>(ch));
                }
                break;
        }
    }
    return out;
}

class JsonCursor {
public:
    explicit JsonCursor(const std::string& text) : text_(text) {}

    void skip() {
        while (index_ < text_.size() && std::isspace(static_cast<unsigned char>(text_[index_]))) {
            index_++;
        }
    }

    bool eat(char expected) {
        skip();
        if (index_ < text_.size() && text_[index_] == expected) {
            index_++;
            return true;
        }
        return false;
    }

    std::string parseString() {
        skip();
        if (index_ >= text_.size() || text_[index_] != '"') {
            throw std::runtime_error("Expected JSON string");
        }
        index_++;
        std::string out;
        while (index_ < text_.size() && text_[index_] != '"') {
            if (text_[index_] == '\\' && index_ + 1 < text_.size()) {
                index_++;
            }
            out.push_back(text_[index_++]);
        }
        if (index_ >= text_.size() || text_[index_] != '"') {
            throw std::runtime_error("Unterminated JSON string");
        }
        index_++;
        return out;
    }

    int parseInt() {
        skip();
        const size_t start = index_;
        if (index_ < text_.size() && (text_[index_] == '-' || text_[index_] == '+')) {
            index_++;
        }
        while (index_ < text_.size() && std::isdigit(static_cast<unsigned char>(text_[index_]))) {
            index_++;
        }
        if (start == index_) {
            throw std::runtime_error("Expected JSON number");
        }
        return std::stoi(text_.substr(start, index_ - start));
    }

private:
    const std::string& text_;
    size_t index_ = 0;
};

std::vector<std::string> parseStringArray(const std::string& json) {
    JsonCursor cursor(json.empty() ? "[]" : json);
    std::vector<std::string> values;
    if (!cursor.eat('[')) {
        throw std::runtime_error("Expected JSON array");
    }
    if (cursor.eat(']')) {
        return values;
    }
    do {
        values.push_back(cursor.parseString());
    } while (cursor.eat(','));
    if (!cursor.eat(']')) {
        throw std::runtime_error("Expected end of JSON array");
    }
    return values;
}

std::vector<int> parseIntArray(const std::string& json) {
    JsonCursor cursor(json.empty() ? "[]" : json);
    std::vector<int> values;
    if (!cursor.eat('[')) {
        throw std::runtime_error("Expected JSON array");
    }
    if (cursor.eat(']')) {
        return values;
    }
    do {
        values.push_back(cursor.parseInt());
    } while (cursor.eat(','));
    if (!cursor.eat(']')) {
        throw std::runtime_error("Expected end of JSON array");
    }
    return values;
}

struct PageRange {
    int start = 0;
    int end = 0;
};

std::vector<PageRange> parseRanges(const std::string& json) {
    JsonCursor cursor(json.empty() ? "[]" : json);
    std::vector<PageRange> ranges;
    if (!cursor.eat('[')) {
        throw std::runtime_error("Expected JSON array");
    }
    if (cursor.eat(']')) {
        return ranges;
    }
    do {
        if (!cursor.eat('[')) {
            throw std::runtime_error("Expected page range");
        }
        PageRange range;
        range.start = cursor.parseInt();
        range.end = cursor.eat(',') ? cursor.parseInt() : range.start;
        if (!cursor.eat(']')) {
            throw std::runtime_error("Expected end of page range");
        }
        ranges.push_back(range);
    } while (cursor.eat(','));
    if (!cursor.eat(']')) {
        throw std::runtime_error("Expected end of JSON array");
    }
    return ranges;
}

void ensureParent(const std::string& path) {
    const auto slash = path.find_last_of('/');
    if (slash == std::string::npos || slash == 0) {
        return;
    }
    std::string directory = path.substr(0, slash);
    std::string current;
    for (size_t index = 0; index < directory.size(); index++) {
        current.push_back(directory[index]);
        if (directory[index] == '/' && current.size() > 1) {
            mkdir(current.c_str(), 0755);
        }
    }
    mkdir(directory.c_str(), 0755);
}

long long fileSizeOf(const std::string& path) {
    struct stat info {};
    if (stat(path.c_str(), &info) != 0) {
        return -1;
    }
    return static_cast<long long>(info.st_size);
}

bool copyFile(const std::string& from, const std::string& to) {
    std::ifstream input(from, std::ios::binary);
    std::ofstream output(to, std::ios::binary);
    if (!input || !output) {
        return false;
    }
    output << input.rdbuf();
    return static_cast<bool>(output);
}

struct BitmapGuard {
    FPDF_BITMAP bitmap = nullptr;
    ~BitmapGuard() {
        if (bitmap != nullptr) {
            FPDFBitmap_Destroy(bitmap);
        }
    }
};

struct PageGuard {
    FPDF_PAGE page = nullptr;
    ~PageGuard() {
        if (page != nullptr) {
            FPDF_ClosePage(page);
        }
    }
};

std::vector<unsigned char> renderJpeg(FPDF_DOCUMENT document, int pageIndex, double scale, int quality) {
    const PageSizePoints size = pageGeometry(document, pageIndex);
    const double safeScale = scale > 0 ? scale : 1.0;
    const int width = std::max(1, static_cast<int>(std::lround(size.width * safeScale)));
    const int height = std::max(1, static_cast<int>(std::lround(size.height * safeScale)));
    BitmapGuard bitmap;
    bitmap.bitmap = FPDFBitmap_Create(width, height, 1);
    if (bitmap.bitmap == nullptr) {
        throw std::runtime_error("Failed to allocate page bitmap");
    }
    FPDFBitmap_FillRect(bitmap.bitmap, 0, 0, width, height, 0xFFFFFFFF);
    PageGuard page;
    page.page = FPDF_LoadPage(document, pageIndex);
    if (page.page == nullptr) {
        throw std::runtime_error("Failed to load page");
    }
    FPDF_RenderPageBitmap(bitmap.bitmap, page.page, 0, 0, width, height, 0, FPDF_ANNOT);
    const int stride = FPDFBitmap_GetStride(bitmap.bitmap);
    const auto* pixels = static_cast<const unsigned char*>(FPDFBitmap_GetBuffer(bitmap.bitmap));
    std::vector<unsigned char> rgb(static_cast<size_t>(width) * static_cast<size_t>(height) * 3);
    for (int y = 0; y < height; y++) {
        const unsigned char* row = pixels + static_cast<size_t>(y) * static_cast<size_t>(stride);
        for (int x = 0; x < width; x++) {
            const size_t target = (static_cast<size_t>(y) * static_cast<size_t>(width) + static_cast<size_t>(x)) * 3;
            rgb[target] = row[x * 4 + 2];
            rgb[target + 1] = row[x * 4 + 1];
            rgb[target + 2] = row[x * 4];
        }
    }
    std::vector<unsigned char> jpeg;
    const int ok = stbi_write_jpg_to_func(
        [](void* context, void* data, int size) {
            auto* output = static_cast<std::vector<unsigned char>*>(context);
            const auto* bytes = static_cast<const unsigned char*>(data);
            output->insert(output->end(), bytes, bytes + size);
        },
        &jpeg,
        width,
        height,
        3,
        rgb.data(),
        quality);
    if (ok == 0 || jpeg.empty()) {
        throw std::runtime_error("JPEG encode failed");
    }
    return jpeg;
}

int memoryGetBlock(void* param, unsigned long position, unsigned char* buffer, unsigned long size) {
    const auto* bytes = static_cast<const std::vector<unsigned char>*>(param);
    if (position + size > bytes->size()) {
        return 0;
    }
    std::memcpy(buffer, bytes->data() + position, size);
    return 1;
}

void addJpegPage(FPDF_DOCUMENT document, const std::vector<unsigned char>& jpeg, double width, double height) {
    const int pageIndex = FPDF_GetPageCount(document);
    FPDF_PAGE page = FPDFPage_New(document, pageIndex, width, height);
    if (page == nullptr) {
        throw std::runtime_error("Failed to create PDF page");
    }
    FPDF_PAGEOBJECT image = FPDFPageObj_NewImageObj(document);
    if (image == nullptr) {
        FPDF_ClosePage(page);
        throw std::runtime_error("Failed to create image object");
    }
    FPDF_FILEACCESS access {};
    access.m_FileLen = static_cast<unsigned long>(jpeg.size());
    access.m_GetBlock = memoryGetBlock;
    access.m_Param = const_cast<std::vector<unsigned char>*>(&jpeg);
    if (FPDFImageObj_LoadJpegFileInline(&page, 1, image, &access) == 0 ||
        FPDFImageObj_SetMatrix(image, width, 0, 0, height, 0, 0) == 0) {
        FPDFPageObj_Destroy(image);
        FPDF_ClosePage(page);
        throw std::runtime_error("Failed to place JPEG on page");
    }
    FPDFPage_InsertObject(page, image);
    FPDFPage_GenerateContent(page);
    FPDF_ClosePage(page);
}

struct FileWriter : FPDF_FILEWRITE {
    FILE* file = nullptr;
    explicit FileWriter(FILE* output) : file(output) {
        version = 1;
        WriteBlock = &writeBlock;
    }
    static int writeBlock(FPDF_FILEWRITE* self, const void* data, unsigned long size) {
        auto* writer = static_cast<FileWriter*>(self);
        return std::fwrite(data, 1, size, writer->file) == size ? 1 : 0;
    }
};

std::vector<unsigned char> saveToMemory(FPDF_DOCUMENT document) {
    struct MemWriter : FPDF_FILEWRITE {
        std::vector<unsigned char> bytes;
        MemWriter() {
            version = 1;
            WriteBlock = &writeBlock;
        }
        static int writeBlock(FPDF_FILEWRITE* self, const void* data, unsigned long size) {
            auto* writer = static_cast<MemWriter*>(self);
            const auto* src = static_cast<const unsigned char*>(data);
            writer->bytes.insert(writer->bytes.end(), src, src + size);
            return 1;
        }
    };
    MemWriter writer;
    if (FPDF_SaveAsCopy(document, &writer, FPDF_NO_INCREMENTAL) == 0) {
        throw std::runtime_error("Failed to save PDF");
    }
    return std::move(writer.bytes);
}

std::string parentDirectory(const std::string& path) {
    const auto slash = path.find_last_of('/');
    if (slash == std::string::npos) {
        return ".";
    }
    return path.substr(0, slash);
}

std::string fileName(const std::string& path) {
    const auto slash = path.find_last_of('/');
    if (slash == std::string::npos) {
        return path;
    }
    return path.substr(slash + 1);
}

} // namespace

struct OpenPdf::Impl {
    std::mutex mutex;
    std::string path;
    FPDF_DOCUMENT document = nullptr;
    int pageCount = 0;
    bool closed = false;

    FPDF_DOCUMENT requireDocument() {
        if (closed || document == nullptr) {
            throw std::runtime_error("PDF document is closed");
        }
        return document;
    }
};

OpenPdf::OpenPdf(std::string path) : impl_(std::make_unique<Impl>()) {
    impl_->path = normalizePath(path);
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    impl_->document = loadFresh(impl_->path);
    impl_->pageCount = FPDF_GetPageCount(impl_->document);
}

OpenPdf::~OpenPdf() {
    close();
}

const std::string& OpenPdf::path() const {
    return impl_->path;
}

int OpenPdf::pageCount() const {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    return impl_->pageCount;
}

void OpenPdf::close() {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    if (impl_->closed) {
        return;
    }
    impl_->closed = true;
    if (impl_->document != nullptr) {
        std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
        FPDF_CloseDocument(impl_->document);
        impl_->document = nullptr;
    }
}

PageSize OpenPdf::pageSize(int pageIndex) {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    const PageSizePoints size = pageGeometry(impl_->requireDocument(), pageIndex);
    return PageSize(size.width, size.height);
}

PlatformPageGeometry OpenPdf::pageMetrics(int pageNumber) {
    PlatformPageGeometry geometry;
    try {
        std::lock_guard<std::mutex> lock(impl_->mutex);
        std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
        const int pageIndex = std::max(0, pageNumber);
        const PageSizePoints size = pageGeometry(impl_->requireDocument(), pageIndex);
        geometry.ok = true;
        geometry.width = size.width;
        geometry.height = size.height;
        geometry.rotation = size.rotation;
    } catch (const std::exception& error) {
        geometry.error = error.what();
    }
    return geometry;
}

PlatformRenderInfo OpenPdf::renderPage(int pageNumber, double scale) {
    PlatformRenderInfo info;
    try {
        std::lock_guard<std::mutex> lock(impl_->mutex);
        std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
        FPDF_DOCUMENT document = impl_->requireDocument();
        const int pageIndex = std::max(0, pageNumber);
        const PageSizePoints size = pageGeometry(document, pageIndex);
        const double safeScale = scale > 0 ? scale : 1.0;
        const int width = std::max(1, static_cast<int>(std::lround(size.width * safeScale)));
        const int height = std::max(1, static_cast<int>(std::lround(size.height * safeScale)));
        BitmapGuard bitmap;
        bitmap.bitmap = FPDFBitmap_Create(width, height, 1);
        PageGuard page;
        page.page = FPDF_LoadPage(document, pageIndex);
        if (bitmap.bitmap == nullptr || page.page == nullptr) {
            throw std::runtime_error("Failed to render page");
        }
        FPDFBitmap_FillRect(bitmap.bitmap, 0, 0, width, height, 0xFFFFFFFF);
        const auto started = std::chrono::steady_clock::now();
        FPDF_RenderPageBitmap(bitmap.bitmap, page.page, 0, 0, width, height, 0, FPDF_ANNOT);
        const auto elapsed = std::chrono::steady_clock::now() - started;
        info.ok = true;
        info.width = width;
        info.height = height;
        info.renderTimeMs = std::chrono::duration<double, std::milli>(elapsed).count();
    } catch (const std::exception& error) {
        info.error = error.what();
    }
    return info;
}

std::vector<SearchResult> OpenPdf::search(const std::string& searchTerm, int startPage, int endPage) {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    std::vector<SearchResult> results;
    if (searchTerm.empty()) {
        return results;
    }
    FPDF_DOCUMENT document = impl_->requireDocument();
    const int pageCount = FPDF_GetPageCount(document);
    int from = std::max(0, startPage);
    int to = std::min(endPage, pageCount - 1);
    if (to < from) {
        std::swap(from, to);
    }
    const std::vector<unsigned short> needle = utf8ToUtf16(searchTerm);
    for (int pageIndex = from; pageIndex <= to; pageIndex++) {
        FPDF_PAGE page = FPDF_LoadPage(document, pageIndex);
        if (page == nullptr) {
            continue;
        }
        FPDF_TEXTPAGE textPage = FPDFText_LoadPage(page);
        if (textPage == nullptr) {
            FPDF_ClosePage(page);
            continue;
        }
        FPDF_SCHHANDLE finder = FPDFText_FindStart(textPage, needle.data(), 0, 0);
        if (finder != nullptr) {
            while (FPDFText_FindNext(finder)) {
                const int index = FPDFText_GetSchResultIndex(finder);
                const int count = FPDFText_GetSchCount(finder);
                std::string snippet;
                if (count > 0) {
                    std::vector<unsigned short> buffer(static_cast<size_t>(count) + 1);
                    FPDFText_GetText(textPage, index, count, buffer.data());
                    snippet = utf16ToUtf8(buffer.data(), count);
                }
                std::string rect = "{}";
                if (FPDFText_CountRects(textPage, index, count) > 0) {
                    double left = 0;
                    double top = 0;
                    double right = 0;
                    double bottom = 0;
                    if (FPDFText_GetRect(textPage, 0, &left, &top, &right, &bottom)) {
                        rect = std::to_string(left) + "," + std::to_string(top) + "," + std::to_string(right) + "," + std::to_string(bottom);
                    }
                }
                results.emplace_back(static_cast<double>(pageIndex), snippet, rect);
            }
            FPDFText_FindClose(finder);
        }
        FPDFText_ClosePage(textPage);
        FPDF_ClosePage(page);
    }
    return results;
}

std::string OpenPdf::textFromPage(int pageIndex) {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    return textOnPage(impl_->requireDocument(), pageIndex);
}

std::string OpenPdf::textFromPages(const std::string& pageIndicesJson) {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    FPDF_DOCUMENT document = impl_->requireDocument();
    const std::vector<int> indices = parseIntArray(pageIndicesJson);
    std::ostringstream out;
    out << '{';
    for (size_t index = 0; index < indices.size(); index++) {
        if (index > 0) {
            out << ',';
        }
        out << '"' << indices[index] << "\":\"" << jsonEscape(textOnPage(document, indices[index])) << '"';
    }
    out << '}';
    return out.str();
}

std::string OpenPdf::allText() {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    FPDF_DOCUMENT document = impl_->requireDocument();
    const int count = FPDF_GetPageCount(document);
    std::ostringstream out;
    out << '{';
    for (int index = 0; index < count; index++) {
        if (index > 0) {
            out << ',';
        }
        out << '"' << index << "\":\"" << jsonEscape(textOnPage(document, index)) << '"';
    }
    out << '}';
    return out.str();
}

std::string OpenPdf::exportPage(int pageIndex, double scale) {
    std::vector<unsigned char> jpeg;
    std::string output;
    {
        std::lock_guard<std::mutex> lock(impl_->mutex);
        std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
        FPDF_DOCUMENT document = impl_->requireDocument();
        jpeg = renderJpeg(document, pageIndex, scale, 90);
        output = parentDirectory(impl_->path) + "/" + fileName(impl_->path) + "-page-" + std::to_string(pageIndex) + ".jpg";
    }
    writeBytes(output, jpeg);
    return output;
}

std::string OpenPdf::exportAll(double scale) {
    std::vector<std::pair<std::string, std::vector<unsigned char>>> pages;
    {
        std::lock_guard<std::mutex> lock(impl_->mutex);
        std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
        FPDF_DOCUMENT document = impl_->requireDocument();
        const int count = FPDF_GetPageCount(document);
        pages.reserve(static_cast<size_t>(count));
        for (int index = 0; index < count; index++) {
            const std::string output = parentDirectory(impl_->path) + "/" + fileName(impl_->path) + "-page-" + std::to_string(index) + ".jpg";
            pages.emplace_back(output, renderJpeg(document, index, scale, 90));
        }
    }
    std::ostringstream out;
    out << '[';
    for (size_t index = 0; index < pages.size(); index++) {
        writeBytes(pages[index].first, pages[index].second);
        if (index > 0) {
            out << ',';
        }
        out << '"' << jsonEscape(pages[index].first) << '"';
    }
    out << ']';
    return out.str();
}

bool OpenPdf::rotate(int pageNumber, int degrees) {
    std::vector<unsigned char> bytes;
    std::string path;
    {
        std::lock_guard<std::mutex> lock(impl_->mutex);
        std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
        FPDF_DOCUMENT document = impl_->requireDocument();
        if (pageNumber < 0 || pageNumber >= FPDF_GetPageCount(document)) {
            return false;
        }
        const int turns = ((degrees % 360) + 360) % 360 / 90;
        FPDF_PAGE page = FPDF_LoadPage(document, pageNumber);
        if (page == nullptr) {
            return false;
        }
        FPDFPage_SetRotation(page, turns);
        FPDFPage_GenerateContent(page);
        FPDF_ClosePage(page);
        bytes = saveToMemory(document);
        path = impl_->path;
    }
    const std::string temp = path + ".rotate.tmp";
    writeBytes(temp, bytes);
    if (std::rename(temp.c_str(), path.c_str()) != 0) {
        std::remove(temp.c_str());
        return false;
    }
    return true;
}

bool OpenPdf::removePage(int pageNumber) {
    std::vector<unsigned char> bytes;
    std::string path;
    int nextCount = 0;
    {
        std::lock_guard<std::mutex> lock(impl_->mutex);
        std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
        FPDF_DOCUMENT document = impl_->requireDocument();
        if (pageNumber < 0 || pageNumber >= FPDF_GetPageCount(document)) {
            return false;
        }
        FPDFPage_Delete(document, pageNumber);
        nextCount = FPDF_GetPageCount(document);
        bytes = saveToMemory(document);
        path = impl_->path;
        impl_->pageCount = nextCount;
    }
    const std::string temp = path + ".delete.tmp";
    writeBytes(temp, bytes);
    if (std::rename(temp.c_str(), path.c_str()) != 0) {
        std::remove(temp.c_str());
        return false;
    }
    return true;
}

void pdfiumInit() {
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    ensureLibrary();
}

std::string pdfiumMerge(const std::vector<std::string>& filePaths, const std::string& outputPath) {
    std::vector<unsigned char> bytes;
    std::string output;
    {
        std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
        if (filePaths.size() < 2) {
            throw std::runtime_error("At least 2 PDF files are required for merging");
        }
        FPDF_DOCUMENT merged = FPDF_CreateNewDocument();
        if (merged == nullptr) {
            throw std::runtime_error("Failed to create merged PDF");
        }
        std::vector<FPDF_DOCUMENT> sources;
        try {
            for (const std::string& rawPath : filePaths) {
                const std::string path = normalizePath(rawPath);
                FPDF_DOCUMENT source = loadFresh(path);
                sources.push_back(source);
                const int count = FPDF_GetPageCount(source);
                if (count <= 0) {
                    throw std::runtime_error("PDF has no pages: " + path);
                }
                for (int page = 0; page < count; page++) {
                    const int pageIndex = page;
                    const int insertAt = FPDF_GetPageCount(merged);
                    if (FPDF_ImportPagesByIndex(merged, source, &pageIndex, 1, insertAt) == 0) {
                        throw std::runtime_error("Failed to import page " + std::to_string(page + 1) + " from " + path);
                    }
                }
            }
            output = outputPath.empty()
                ? parentDirectory(normalizePath(filePaths[0])) + "/merged-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()) + ".pdf"
                : normalizePath(outputPath);
            bytes = saveToMemory(merged);
            FPDF_CloseDocument(merged);
            for (FPDF_DOCUMENT source : sources) {
                FPDF_CloseDocument(source);
            }
        } catch (...) {
            FPDF_CloseDocument(merged);
            for (FPDF_DOCUMENT source : sources) {
                FPDF_CloseDocument(source);
            }
            throw;
        }
    }
    writeBytes(output, bytes);
    return output;
}

std::string pdfiumSplit(const std::string& filePath, const std::string& pageRangesJson, const std::string& outputDir) {
    std::vector<std::pair<std::string, std::vector<unsigned char>>> pieces;
    {
        std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
        const std::string path = normalizePath(filePath);
        FPDF_DOCUMENT source = loadFresh(path);
        try {
            const std::string directory = outputDir.empty() ? parentDirectory(path) : normalizePath(outputDir);
            const std::vector<PageRange> ranges = parseRanges(pageRangesJson);
            const auto stamp = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count();
            for (const PageRange& range : ranges) {
                FPDF_DOCUMENT piece = FPDF_CreateNewDocument();
                if (piece == nullptr) {
                    throw std::runtime_error("Failed to create split PDF");
                }
                const std::string pageRange = std::to_string(range.start + 1) + "-" + std::to_string(range.end + 1);
                const std::string output = directory + "/split-" + std::to_string(range.start) + "-" + std::to_string(range.end) + "-" + std::to_string(stamp) + ".pdf";
                if (FPDF_ImportPages(piece, source, pageRange.c_str(), 0) == 0) {
                    FPDF_CloseDocument(piece);
                    throw std::runtime_error("Failed to split pages " + pageRange);
                }
                pieces.emplace_back(output, saveToMemory(piece));
                FPDF_CloseDocument(piece);
            }
            FPDF_CloseDocument(source);
        } catch (...) {
            FPDF_CloseDocument(source);
            throw;
        }
    }
    std::ostringstream out;
    out << '[';
    for (size_t index = 0; index < pieces.size(); index++) {
        writeBytes(pieces[index].first, pieces[index].second);
        if (index > 0) {
            out << ',';
        }
        out << '"' << jsonEscape(pieces[index].first) << '"';
    }
    out << ']';
    return out.str();
}

std::string pdfiumExtract(const std::string& filePath, const std::string& pageNumbersJson, const std::string& outputPath) {
    std::vector<unsigned char> bytes;
    std::string output;
    {
        std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
        const std::string path = normalizePath(filePath);
        FPDF_DOCUMENT source = loadFresh(path);
        FPDF_DOCUMENT extracted = FPDF_CreateNewDocument();
        if (extracted == nullptr) {
            FPDF_CloseDocument(source);
            throw std::runtime_error("Failed to create extracted PDF");
        }
        try {
            const std::vector<int> pages = parseIntArray(pageNumbersJson);
            for (int pageIndex : pages) {
                if (pageIndex < 0 || pageIndex >= FPDF_GetPageCount(source)) {
                    continue;
                }
                const std::string range = std::to_string(pageIndex + 1);
                if (FPDF_ImportPages(extracted, source, range.c_str(), 0) == 0) {
                    throw std::runtime_error("Failed to extract page " + range);
                }
            }
            output = outputPath.empty()
                ? parentDirectory(path) + "/extract-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()) + ".pdf"
                : normalizePath(outputPath);
            bytes = saveToMemory(extracted);
            FPDF_CloseDocument(extracted);
            FPDF_CloseDocument(source);
        } catch (...) {
            FPDF_CloseDocument(extracted);
            FPDF_CloseDocument(source);
            throw;
        }
    }
    writeBytes(output, bytes);
    return output;
}

std::string pdfiumCompress(const std::string& inputPath, const std::string& outputPath, int compressionLevel) {
    const auto started = std::chrono::steady_clock::now();
    const std::string input = normalizePath(inputPath);
    const long long originalSize = fileSizeOf(input);
    if (originalSize < 0) {
        throw std::runtime_error("PDF file not found: " + input);
    }
    std::string output = outputPath.empty()
        ? parentDirectory(input) + "/compressed-" + std::to_string(started.time_since_epoch().count()) + ".pdf"
        : normalizePath(outputPath);
    const int level = std::max(0, std::min(9, compressionLevel));
    const double scale = 1.0 - (static_cast<double>(level) / 9.0) * 0.55;
    const int jpegQuality = static_cast<int>(std::lround(92.0 - (static_cast<double>(level) / 9.0) * 57.0));
    std::vector<unsigned char> bytes;
    {
        std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
        FPDF_DOCUMENT source = loadFresh(input);
        FPDF_DOCUMENT compressed = FPDF_CreateNewDocument();
        if (compressed == nullptr) {
            FPDF_CloseDocument(source);
            throw std::runtime_error("Failed to create compressed PDF");
        }
        try {
            const int count = FPDF_GetPageCount(source);
            for (int index = 0; index < count; index++) {
                const PageSizePoints size = pageGeometry(source, index);
                const std::vector<unsigned char> jpeg = renderJpeg(source, index, scale, jpegQuality);
                addJpegPage(compressed, jpeg, size.width, size.height);
            }
            bytes = saveToMemory(compressed);
            FPDF_CloseDocument(compressed);
            FPDF_CloseDocument(source);
        } catch (...) {
            FPDF_CloseDocument(compressed);
            FPDF_CloseDocument(source);
            throw;
        }
    }
    const std::string temp = output + ".recompress.tmp";
    writeBytes(temp, bytes);
    long long compressedSize = fileSizeOf(temp);
    if (compressedSize <= 0 || compressedSize >= originalSize) {
        std::remove(temp.c_str());
        if (!copyFile(input, output)) {
            throw std::runtime_error("Failed to copy original PDF");
        }
        compressedSize = originalSize;
    } else if (std::rename(temp.c_str(), output.c_str()) != 0) {
        std::remove(temp.c_str());
        throw std::runtime_error("Failed to move compressed PDF");
    }
    const auto elapsed = std::chrono::steady_clock::now() - started;
    const long long duration = std::chrono::duration_cast<std::chrono::milliseconds>(elapsed).count();
    const double ratio = originalSize > 0 ? static_cast<double>(compressedSize) / static_cast<double>(originalSize) : 1.0;
    const double saved = (1.0 - ratio) * 100.0;
    std::ostringstream json;
    json.setf(std::ios::fixed);
    json.precision(6);
    json << "{\"success\":true,\"originalSize\":" << originalSize
         << ",\"compressedSize\":" << compressedSize
         << ",\"durationMs\":" << duration
         << ",\"compressionRatio\":" << ratio
         << ",\"spaceSavedPercent\":" << saved
         << ",\"outputPath\":\"" << jsonEscape(output) << "\"}";
    return json.str();
}

} // namespace margelo::nitro::pdfjsi
