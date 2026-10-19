#include "PdfiumSession.hpp"

#include "fpdf_annot.h"
#include "fpdf_doc.h"
#include "fpdf_edit.h"
#include "fpdf_flatten.h"
#include "fpdf_formfill.h"
#include "fpdf_ppo.h"
#include "fpdf_save.h"
#include "fpdf_text.h"
#include "fpdfview.h"

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <memory>
#include <mutex>
#include <new>
#include <set>
#include <sstream>
#include <utility>
#include <vector>

#include <sys/stat.h>

namespace margelo::nitro::pdfjsi {

PdfException::PdfException(std::string code, const std::string& message)
    : std::runtime_error("[" + code + "] " + message), code_(std::move(code)) {}

void throwPdfError(const std::string& code, const std::string& message) {
    throw PdfException(code, message);
}

namespace {

// PDFium allows only one call at a time (fpdfview.h). This lock covers those
// calls and nothing else; file IO happens after it is released.
std::mutex gPdfiumMutex;
std::once_flag gInitOnce;
std::mutex gRenderDirMutex;
std::string gRenderDir;
std::atomic<uint64_t> gRenderCounter{0};

void ensureLibrary() {
    std::call_once(gInitOnce, []() { FPDF_InitLibrary(); });
}

void ensureParent(const std::string& path);

bool fileExists(const std::string& path) {
    struct stat info {};
    return stat(path.c_str(), &info) == 0 && S_ISREG(info.st_mode);
}

[[noreturn]] void throwLoadError(const std::string& path, bool passwordGiven) {
    const unsigned long error = FPDF_GetLastError();
    switch (error) {
        case FPDF_ERR_PASSWORD:
            if (passwordGiven) {
                throwPdfError("password-incorrect", "The password is incorrect: " + path);
            }
            throwPdfError("password-required", "This PDF needs a password: " + path);
        case FPDF_ERR_FILE:
            throwPdfError("io-error", "Could not read " + path);
        case FPDF_ERR_FORMAT:
            throwPdfError("unsupported-pdf", "Not a PDF or the file is damaged: " + path);
        case FPDF_ERR_SECURITY:
            throwPdfError("unsupported-pdf", "Unsupported PDF security handler: " + path);
        default:
            throwPdfError("unsupported-pdf", "Failed to open PDF: " + path);
    }
}

/** Opens a document. An empty password is tried first, then `password`. */
FPDF_DOCUMENT loadDocument(const std::string& path, const std::optional<std::string>& password) {
    ensureLibrary();
    if (!fileExists(path)) {
        throwPdfError("invalid-source", "File not found: " + path);
    }
    FPDF_DOCUMENT document = FPDF_LoadDocument(path.c_str(), nullptr);
    if (document != nullptr) {
        return document;
    }
    const bool hasPassword = password.has_value() && !password->empty();
    if (FPDF_GetLastError() != FPDF_ERR_PASSWORD || !hasPassword) {
        throwLoadError(path, false);
    }
    document = FPDF_LoadDocument(path.c_str(), password->c_str());
    if (document == nullptr) {
        throwLoadError(path, true);
    }
    return document;
}

FPDF_DOCUMENT loadFresh(const std::string& path) {
    return loadDocument(path, std::nullopt);
}

void writeBytes(const std::string& path, const std::vector<unsigned char>& bytes) {
    ensureParent(path);
    FILE* file = std::fopen(path.c_str(), "wb");
    if (file == nullptr) {
        throwPdfError("io-error", "Failed to write " + path);
    }
    const size_t written = bytes.empty() ? 0 : std::fwrite(bytes.data(), 1, bytes.size(), file);
    const bool closed = std::fclose(file) == 0;
    if (written != bytes.size() || !closed) {
        std::remove(path.c_str());
        throwPdfError("io-error", "Failed to write " + path);
    }
}

/** Writes through a temporary file and renames it into place. */
void writeAtomically(const std::string& path, const std::vector<unsigned char>& bytes) {
    const std::string temp = path + ".tmp-" + std::to_string(gRenderCounter.fetch_add(1));
    writeBytes(temp, bytes);
    if (std::rename(temp.c_str(), path.c_str()) != 0) {
        std::remove(temp.c_str());
        throwPdfError("io-error", "Failed to replace " + path);
    }
}

void requirePage(FPDF_DOCUMENT document, int pageIndex) {
    const int count = FPDF_GetPageCount(document);
    if (pageIndex < 0 || pageIndex >= count) {
        throwPdfError("invalid-page", "Page " + std::to_string(pageIndex) + " is out of range (0-" +
                                          std::to_string(count - 1) + ")");
    }
}

PageGeometry pageGeometry(FPDF_DOCUMENT document, int pageIndex) {
    requirePage(document, pageIndex);
    double width = 0;
    double height = 0;
    if (FPDF_GetPageSizeByIndex(document, pageIndex, &width, &height) == 0 || width <= 0 || height <= 0) {
        throwPdfError("unsupported-pdf", "Failed to read the size of page " + std::to_string(pageIndex));
    }
    PageGeometry size;
    size.width = width;
    size.height = height;
    FPDF_PAGE page = FPDF_LoadPage(document, pageIndex);
    if (page != nullptr) {
        size.rotation = FPDFPage_GetRotation(page) * 90;
        FPDF_ClosePage(page);
    }
    return size;
}

std::string utf16ToUtf8(const unsigned short* text, size_t length) {
    std::string out;
    for (size_t index = 0; index < length; index++) {
        uint32_t code = text[index];
        if (code == 0) {
            break;
        }
        if (code >= 0xD800 && code <= 0xDBFF && index + 1 < length) {
            const uint32_t low = text[index + 1];
            if (low >= 0xDC00 && low <= 0xDFFF) {
                code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
                index++;
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

/** Reads a PDFium UTF-16LE string out-parameter (length in bytes, terminator included). */
template <typename Fn>
std::string readWide(Fn&& call) {
    const unsigned long bytes = call(nullptr, 0);
    if (bytes <= 2) {
        return "";
    }
    std::vector<unsigned short> buffer((bytes + 1) / 2 + 1, 0);
    call(buffer.data(), static_cast<unsigned long>(buffer.size() * 2));
    return utf16ToUtf8(buffer.data(), buffer.size());
}

std::string textOnPage(FPDF_DOCUMENT document, int pageIndex) {
    requirePage(document, pageIndex);
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
            text = utf16ToUtf8(buffer.data(), static_cast<size_t>(chars));
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
            throwPdfError("invalid-argument", "Expected a JSON number");
        }
        return std::stoi(text_.substr(start, index_ - start));
    }

private:
    const std::string& text_;
    size_t index_ = 0;
};

std::vector<int> parseIntArray(const std::string& json) {
    const std::string text = json.empty() ? "[]" : json;
    JsonCursor cursor(text);
    std::vector<int> values;
    if (!cursor.eat('[')) {
        throwPdfError("invalid-argument", "Expected a JSON array");
    }
    if (cursor.eat(']')) {
        return values;
    }
    do {
        values.push_back(cursor.parseInt());
    } while (cursor.eat(','));
    if (!cursor.eat(']')) {
        throwPdfError("invalid-argument", "Expected the end of the JSON array");
    }
    return values;
}

struct PageRange {
    int start = 0;
    int end = 0;
};

std::vector<PageRange> parseRanges(const std::string& json) {
    const std::string text = json.empty() ? "[]" : json;
    JsonCursor cursor(text);
    std::vector<PageRange> ranges;
    if (!cursor.eat('[')) {
        throwPdfError("invalid-argument", "Expected a JSON array");
    }
    if (cursor.eat(']')) {
        return ranges;
    }
    do {
        if (!cursor.eat('[')) {
            throwPdfError("invalid-argument", "Expected a page range");
        }
        PageRange range;
        range.start = cursor.parseInt();
        range.end = cursor.eat(',') ? cursor.parseInt() : range.start;
        if (!cursor.eat(']')) {
            throwPdfError("invalid-argument", "Expected the end of a page range");
        }
        ranges.push_back(range);
    } while (cursor.eat(','));
    if (!cursor.eat(']')) {
        throwPdfError("invalid-argument", "Expected the end of the JSON array");
    }
    return ranges;
}

void ensureParent(const std::string& path) {
    const auto slash = path.find_last_of('/');
    if (slash == std::string::npos || slash == 0) {
        return;
    }
    std::error_code error;
    std::filesystem::create_directories(path.substr(0, slash), error);
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

struct TextPageGuard {
    FPDF_TEXTPAGE page = nullptr;
    ~TextPageGuard() {
        if (page != nullptr) {
            FPDFText_ClosePage(page);
        }
    }
};

FPDF_PAGE loadPage(FPDF_DOCUMENT document, int pageIndex) {
    requirePage(document, pageIndex);
    FPDF_PAGE page = FPDF_LoadPage(document, pageIndex);
    if (page == nullptr) {
        throwPdfError("page-render-failed", "Failed to load page " + std::to_string(pageIndex));
    }
    return page;
}

struct EncodedImage {
    std::vector<unsigned char> bytes;
    int width = 0;
    int height = 0;
};

void appendBytes(void* context, void* data, int size) {
    auto* output = static_cast<std::vector<unsigned char>*>(context);
    const auto* bytes = static_cast<const unsigned char*>(data);
    output->insert(output->end(), bytes, bytes + size);
}

/** Renders a page to JPEG or PNG at an exact pixel size. */
EncodedImage renderEncoded(FPDF_DOCUMENT document, int pageIndex, int width, int height, bool png, int quality,
                           uint32_t background) {
    BitmapGuard bitmap;
    bitmap.bitmap = FPDFBitmap_Create(width, height, 1);
    if (bitmap.bitmap == nullptr) {
        throwPdfError("out-of-memory", "Not enough memory for a " + std::to_string(width) + "x" +
                                           std::to_string(height) + " image");
    }
    FPDFBitmap_FillRect(bitmap.bitmap, 0, 0, width, height, background | 0xFF000000);
    PageGuard page;
    page.page = loadPage(document, pageIndex);
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
    EncodedImage image;
    image.width = width;
    image.height = height;
    const int ok = png
        ? stbi_write_png_to_func(appendBytes, &image.bytes, width, height, 3, rgb.data(), width * 3)
        : stbi_write_jpg_to_func(appendBytes, &image.bytes, width, height, 3, rgb.data(), quality);
    if (ok == 0 || image.bytes.empty()) {
        throwPdfError("page-render-failed", "Failed to encode page " + std::to_string(pageIndex));
    }
    return image;
}

std::vector<unsigned char> renderJpeg(FPDF_DOCUMENT document, int pageIndex, double scale, int quality) {
    const PageGeometry size = pageGeometry(document, pageIndex);
    const double safeScale = scale > 0 ? scale : 1.0;
    const int width = std::max(1, static_cast<int>(std::lround(size.width * safeScale)));
    const int height = std::max(1, static_cast<int>(std::lround(size.height * safeScale)));
    return renderEncoded(document, pageIndex, width, height, false, quality, 0xFFFFFFFF).bytes;
}

/** Pixel size of a rendered page: fit in maxWidth/maxHeight if given, otherwise `scale` pixels per point. */
std::pair<int, int> targetSize(const PageGeometry& size, double maxWidth, double maxHeight, double scale) {
    double factor = scale > 0 ? scale : 2.0;
    if (maxWidth > 0 || maxHeight > 0) {
        const double byWidth = maxWidth > 0 ? maxWidth / size.width : INFINITY;
        const double byHeight = maxHeight > 0 ? maxHeight / size.height : INFINITY;
        factor = std::min(byWidth, byHeight);
    }
    constexpr double kMaxPixels = 64.0 * 1024 * 1024;
    const double pixels = size.width * factor * size.height * factor;
    if (pixels > kMaxPixels) {
        factor *= std::sqrt(kMaxPixels / pixels);
    }
    const int width = std::max(1, static_cast<int>(std::lround(size.width * factor)));
    const int height = std::max(1, static_cast<int>(std::lround(size.height * factor)));
    return {width, height};
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
        throwPdfError("unknown", "Failed to create a PDF page");
    }
    FPDF_PAGEOBJECT image = FPDFPageObj_NewImageObj(document);
    if (image == nullptr) {
        FPDF_ClosePage(page);
        throwPdfError("unknown", "Failed to create an image object");
    }
    FPDF_FILEACCESS access {};
    access.m_FileLen = static_cast<unsigned long>(jpeg.size());
    access.m_GetBlock = memoryGetBlock;
    access.m_Param = const_cast<std::vector<unsigned char>*>(&jpeg);
    if (FPDFImageObj_LoadJpegFileInline(&page, 1, image, &access) == 0 ||
        FPDFImageObj_SetMatrix(image, width, 0, 0, height, 0, 0) == 0) {
        FPDFPageObj_Destroy(image);
        FPDF_ClosePage(page);
        throwPdfError("unknown", "Failed to place a JPEG on the page");
    }
    FPDFPage_InsertObject(page, image);
    FPDFPage_GenerateContent(page);
    FPDF_ClosePage(page);
}

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
        throwPdfError("io-error", "Failed to serialise the PDF");
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

std::string fileStem(const std::string& path) {
    const auto slash = path.find_last_of('/');
    std::string name = slash == std::string::npos ? path : path.substr(slash + 1);
    const auto dot = name.find_last_of('.');
    if (dot != std::string::npos && dot > 0) {
        name = name.substr(0, dot);
    }
    for (char& ch : name) {
        if (!std::isalnum(static_cast<unsigned char>(ch)) && ch != '-' && ch != '_') {
            ch = '_';
        }
    }
    return name.empty() ? "page" : name.substr(0, 48);
}

/** Removes renders older than a day the first time the render directory is used. */
void pruneRenderDirectory(const std::string& directory) {
    static std::once_flag pruned;
    std::call_once(pruned, [&directory]() {
        std::error_code error;
        const auto cutoff = std::filesystem::file_time_type::clock::now() - std::chrono::hours(24);
        for (const auto& entry : std::filesystem::directory_iterator(directory, error)) {
            std::error_code itemError;
            if (entry.is_regular_file(itemError) && entry.last_write_time(itemError) < cutoff) {
                std::filesystem::remove(entry.path(), itemError);
            }
        }
    });
}

std::string defaultRenderPath(const std::string& directory, const std::string& documentPath, int pageIndex,
                              bool png) {
    const auto stamp = std::chrono::duration_cast<std::chrono::milliseconds>(
                           std::chrono::system_clock::now().time_since_epoch())
                           .count();
    return directory + "/" + fileStem(documentPath) + "-p" + std::to_string(pageIndex) + "-" + std::to_string(stamp) +
           "-" + std::to_string(gRenderCounter.fetch_add(1)) + (png ? ".png" : ".jpg");
}

RenderedImage writeRendered(int pageIndex, const std::string& path, const EncodedImage& image) {
    writeAtomically(path, image.bytes);
    return RenderedImage(pageIndex, "file://" + path, path, image.width, image.height);
}

// Display coordinates: points from the top-left of the page as displayed.
// FPDF_PageToDevice works in whole device pixels, so a 64x device keeps
// sub-point precision.
constexpr int kSubPoint = 64;

struct PageMapper {
    FPDF_PAGE page;
    int deviceWidth;
    int deviceHeight;

    PageMapper(FPDF_PAGE page, double width, double height)
        : page(page),
          deviceWidth(static_cast<int>(std::lround(width * kSubPoint))),
          deviceHeight(static_cast<int>(std::lround(height * kSubPoint))) {}

    void toDisplay(double pageX, double pageY, double* x, double* y) const {
        int deviceX = 0;
        int deviceY = 0;
        FPDF_PageToDevice(page, 0, 0, deviceWidth, deviceHeight, 0, pageX, pageY, &deviceX, &deviceY);
        *x = static_cast<double>(deviceX) / kSubPoint;
        *y = static_cast<double>(deviceY) / kSubPoint;
    }

    void toPage(double x, double y, double* pageX, double* pageY) const {
        FPDF_DeviceToPage(page, 0, 0, deviceWidth, deviceHeight, 0, static_cast<int>(std::lround(x * kSubPoint)),
                          static_cast<int>(std::lround(y * kSubPoint)), pageX, pageY);
    }

    PdfRect displayRect(double left, double bottom, double right, double top) const {
        double xs[4];
        double ys[4];
        toDisplay(left, bottom, &xs[0], &ys[0]);
        toDisplay(left, top, &xs[1], &ys[1]);
        toDisplay(right, bottom, &xs[2], &ys[2]);
        toDisplay(right, top, &xs[3], &ys[3]);
        const double minX = *std::min_element(xs, xs + 4);
        const double maxX = *std::max_element(xs, xs + 4);
        const double minY = *std::min_element(ys, ys + 4);
        const double maxY = *std::max_element(ys, ys + 4);
        return PdfRect(minX, minY, maxX - minX, maxY - minY);
    }

    FS_RECTF pageRect(const PdfRect& rect) const {
        double xs[4];
        double ys[4];
        toPage(rect.x, rect.y, &xs[0], &ys[0]);
        toPage(rect.x + rect.width, rect.y, &xs[1], &ys[1]);
        toPage(rect.x, rect.y + rect.height, &xs[2], &ys[2]);
        toPage(rect.x + rect.width, rect.y + rect.height, &xs[3], &ys[3]);
        FS_RECTF out;
        out.left = static_cast<float>(*std::min_element(xs, xs + 4));
        out.right = static_cast<float>(*std::max_element(xs, xs + 4));
        out.bottom = static_cast<float>(*std::min_element(ys, ys + 4));
        out.top = static_cast<float>(*std::max_element(ys, ys + 4));
        return out;
    }
};

PageMapper mapperFor(FPDF_PAGE page) {
    return PageMapper(page, FPDF_GetPageWidthF(page), FPDF_GetPageHeightF(page));
}

struct Rgba {
    unsigned int r = 0;
    unsigned int g = 0;
    unsigned int b = 0;
    unsigned int a = 255;
};

Rgba parseRgba(const std::optional<std::string>& value, Rgba fallback) {
    if (!value.has_value()) {
        return fallback;
    }
    std::string hex = *value;
    if (!hex.empty() && hex[0] == '#') {
        hex = hex.substr(1);
    }
    if ((hex.size() != 6 && hex.size() != 8) ||
        !std::all_of(hex.begin(), hex.end(), [](char ch) { return std::isxdigit(static_cast<unsigned char>(ch)); })) {
        throwPdfError("invalid-argument", "Colours must be #RRGGBB or #RRGGBBAA, got " + *value);
    }
    const unsigned long packed = std::stoul(hex, nullptr, 16);
    Rgba color;
    if (hex.size() == 6) {
        color.r = (packed >> 16) & 0xFF;
        color.g = (packed >> 8) & 0xFF;
        color.b = packed & 0xFF;
    } else {
        color.r = (packed >> 24) & 0xFF;
        color.g = (packed >> 16) & 0xFF;
        color.b = (packed >> 8) & 0xFF;
        color.a = packed & 0xFF;
    }
    return color;
}

std::string formatColor(unsigned int r, unsigned int g, unsigned int b, unsigned int a) {
    char buffer[16];
    if (a >= 255) {
        std::snprintf(buffer, sizeof(buffer), "#%02X%02X%02X", r & 0xFF, g & 0xFF, b & 0xFF);
    } else {
        std::snprintf(buffer, sizeof(buffer), "#%02X%02X%02X%02X", r & 0xFF, g & 0xFF, b & 0xFF, a & 0xFF);
    }
    return buffer;
}

AnnotationType annotationTypeOf(FPDF_ANNOTATION_SUBTYPE subtype) {
    switch (subtype) {
        case FPDF_ANNOT_HIGHLIGHT: return AnnotationType::HIGHLIGHT;
        case FPDF_ANNOT_INK: return AnnotationType::INK;
        case FPDF_ANNOT_FREETEXT: return AnnotationType::FREETEXT;
        case FPDF_ANNOT_TEXT: return AnnotationType::NOTE;
        case FPDF_ANNOT_STAMP: return AnnotationType::STAMP;
        case FPDF_ANNOT_UNDERLINE: return AnnotationType::UNDERLINE;
        case FPDF_ANNOT_STRIKEOUT: return AnnotationType::STRIKEOUT;
        case FPDF_ANNOT_SQUARE: return AnnotationType::SQUARE;
        case FPDF_ANNOT_CIRCLE: return AnnotationType::CIRCLE;
        case FPDF_ANNOT_LINE: return AnnotationType::LINE;
        case FPDF_ANNOT_LINK: return AnnotationType::LINK;
        case FPDF_ANNOT_WIDGET: return AnnotationType::WIDGET;
        case FPDF_ANNOT_POPUP: return AnnotationType::POPUP;
        default: return AnnotationType::OTHER;
    }
}

FormFieldType formFieldTypeOf(int type) {
    switch (type) {
        case FPDF_FORMFIELD_TEXTFIELD: return FormFieldType::TEXT;
        case FPDF_FORMFIELD_CHECKBOX: return FormFieldType::CHECKBOX;
        case FPDF_FORMFIELD_RADIOBUTTON: return FormFieldType::RADIO;
        case FPDF_FORMFIELD_COMBOBOX: return FormFieldType::COMBOBOX;
        case FPDF_FORMFIELD_LISTBOX: return FormFieldType::LISTBOX;
        case FPDF_FORMFIELD_PUSHBUTTON: return FormFieldType::PUSHBUTTON;
        case FPDF_FORMFIELD_SIGNATURE: return FormFieldType::SIGNATURE;
        default: return FormFieldType::UNKNOWN;
    }
}

bool isTruthy(const std::string& value) {
    std::string lower;
    for (char ch : value) {
        lower.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(ch))));
    }
    return lower == "true" || lower == "1" || lower == "yes" || lower == "on" || lower == "checked";
}

struct AnnotGuard {
    FPDF_ANNOTATION annot = nullptr;
    ~AnnotGuard() {
        if (annot != nullptr) {
            FPDFPage_CloseAnnot(annot);
        }
    }
};

/** Adds a visible label (and border) to a stamp annotation; PDFium has no default stamp appearance. */
void drawStamp(FPDF_DOCUMENT document, FPDF_ANNOTATION annot, const FS_RECTF& rect, const Rgba& color,
               const std::string& text) {
    const float width = rect.right - rect.left;
    const float height = rect.top - rect.bottom;
    FPDF_PAGEOBJECT border = FPDFPageObj_CreateNewRect(rect.left + 1, rect.bottom + 1, width - 2, height - 2);
    if (border != nullptr) {
        FPDFPageObj_SetStrokeColor(border, color.r, color.g, color.b, color.a);
        FPDFPageObj_SetStrokeWidth(border, 2);
        FPDFPath_SetDrawMode(border, FPDF_FILLMODE_NONE, 1);
        if (!FPDFAnnot_AppendObject(annot, border)) {
            FPDFPageObj_Destroy(border);
        }
    }
    if (text.empty()) {
        return;
    }
    const float fontSize = std::max(6.0f, std::min(height * 0.6f, width / std::max<size_t>(1, text.size()) * 1.6f));
    FPDF_PAGEOBJECT label = FPDFPageObj_NewTextObj(document, "Helvetica-Bold", fontSize);
    if (label == nullptr) {
        return;
    }
    const std::vector<unsigned short> wide = utf8ToUtf16(text);
    FPDFText_SetText(label, wide.data());
    FPDFPageObj_SetFillColor(label, color.r, color.g, color.b, color.a);
    FPDFPageObj_Transform(label, 1, 0, 0, 1, rect.left + fontSize * 0.3, rect.bottom + (height - fontSize) / 2 + fontSize * 0.2);
    if (!FPDFAnnot_AppendObject(annot, label)) {
        FPDFPageObj_Destroy(label);
    }
}

} // namespace

std::string normalizePdfPath(const std::string& filePath) {
    const std::string prefix = "file://";
    if (filePath.rfind(prefix, 0) == 0) {
        return filePath.substr(prefix.size());
    }
    return filePath;
}

void setRenderDirectory(const std::string& directory) {
    std::lock_guard<std::mutex> lock(gRenderDirMutex);
    gRenderDir = directory;
}

std::string renderDirectory() {
    std::string directory;
    {
        std::lock_guard<std::mutex> lock(gRenderDirMutex);
        directory = gRenderDir.empty() ? std::filesystem::temp_directory_path().string() + "/pdf-jsi-renders" : gRenderDir;
    }
    std::error_code error;
    std::filesystem::create_directories(directory, error);
    pruneRenderDirectory(directory);
    return directory;
}

uint32_t parseColor(const std::string& value, uint32_t fallback) {
    if (value.empty()) {
        return fallback;
    }
    const Rgba color = parseRgba(value, Rgba {});
    return (color.a << 24) | (color.r << 16) | (color.g << 8) | color.b;
}

struct OpenPdf::Impl {
    std::mutex mutex;
    std::string path;
    FPDF_DOCUMENT document = nullptr;
    FPDF_FORMFILLINFO formInfo {};
    FPDF_FORMHANDLE form = nullptr;
    bool closed = false;
    bool dirty = false;

    FPDF_DOCUMENT requireDocument() {
        if (closed || document == nullptr) {
            throwPdfError("document-closed", "The PDF document is closed");
        }
        return document;
    }

    FPDF_FORMHANDLE requireForm() {
        FPDF_DOCUMENT doc = requireDocument();
        if (form == nullptr) {
            formInfo = FPDF_FORMFILLINFO {};
            formInfo.version = 1;
            form = FPDFDOC_InitFormFillEnvironment(doc, &formInfo);
            if (form == nullptr) {
                throwPdfError("unsupported-operation", "This PDF has no interactive form");
            }
        }
        return form;
    }

    void exitForm() {
        if (form != nullptr) {
            FPDFDOC_ExitFormFillEnvironment(form);
            form = nullptr;
        }
    }
};

namespace {

/** A page loaded with the form environment attached, for form-field edits. */
struct FormPage {
    FPDF_FORMHANDLE form;
    FPDF_PAGE page;
    FormPage(FPDF_FORMHANDLE form, FPDF_DOCUMENT document, int index) : form(form), page(FPDF_LoadPage(document, index)) {
        if (page != nullptr) {
            FORM_OnAfterLoadPage(page, form);
        }
    }
    ~FormPage() {
        if (page != nullptr) {
            FORM_OnBeforeClosePage(page, form);
            FPDF_ClosePage(page);
        }
    }
};

} // namespace

OpenPdf::OpenPdf(std::string path, const std::optional<std::string>& password) : impl_(std::make_unique<Impl>()) {
    impl_->path = normalizePdfPath(path);
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    impl_->document = loadDocument(impl_->path, password);
}

OpenPdf::~OpenPdf() {
    close();
}

const std::string& OpenPdf::path() const {
    return impl_->path;
}

bool OpenPdf::isOpen() {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    return !impl_->closed && impl_->document != nullptr;
}

namespace {
std::mutex gSharedMutex;
std::unordered_map<std::string, std::weak_ptr<OpenPdf>> gShared;
} // namespace

void shareOpenPdf(const std::shared_ptr<OpenPdf>& document) {
    std::lock_guard<std::mutex> lock(gSharedMutex);
    for (auto it = gShared.begin(); it != gShared.end();) {
        it = it->second.expired() ? gShared.erase(it) : std::next(it);
    }
    gShared[document->path()] = document;
}

std::shared_ptr<OpenPdf> findSharedOpenPdf(const std::string& path) {
    std::shared_ptr<OpenPdf> document;
    {
        std::lock_guard<std::mutex> lock(gSharedMutex);
        auto it = gShared.find(normalizePdfPath(path));
        if (it != gShared.end()) {
            document = it->second.lock();
        }
    }
    return document != nullptr && document->isOpen() ? document : nullptr;
}

int OpenPdf::pageCount() {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    return FPDF_GetPageCount(impl_->requireDocument());
}

bool OpenPdf::isEncrypted() {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    return FPDF_GetSecurityHandlerRevision(impl_->requireDocument()) != -1;
}

bool OpenPdf::hasUnsavedChanges() {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    impl_->requireDocument();
    return impl_->dirty;
}

void OpenPdf::close() {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    if (impl_->closed) {
        return;
    }
    impl_->closed = true;
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    impl_->exitForm();
    if (impl_->document != nullptr) {
        FPDF_CloseDocument(impl_->document);
        impl_->document = nullptr;
    }
}

PageGeometry OpenPdf::geometry(int pageIndex) {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    return pageGeometry(impl_->requireDocument(), pageIndex);
}

std::vector<PageGeometry> OpenPdf::allGeometry() {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    FPDF_DOCUMENT document = impl_->requireDocument();
    const int count = FPDF_GetPageCount(document);
    std::vector<PageGeometry> pages;
    pages.reserve(static_cast<size_t>(std::max(0, count)));
    for (int index = 0; index < count; index++) {
        double width = 0;
        double height = 0;
        PageGeometry size;
        if (FPDF_GetPageSizeByIndex(document, index, &width, &height) != 0 && width > 0 && height > 0) {
            size.width = width;
            size.height = height;
        } else {
            size.width = 612;
            size.height = 792;
        }
        pages.push_back(size);
    }
    return pages;
}

std::vector<OutlineItem> OpenPdf::outline() {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    FPDF_DOCUMENT document = impl_->requireDocument();
    std::vector<OutlineItem> items;
    std::set<FPDF_BOOKMARK> seen;
    constexpr int kMaxDepth = 32;
    constexpr size_t kMaxItems = 10000;
    auto visit = [&](auto&& self, FPDF_BOOKMARK parent, int level) -> void {
        if (level > kMaxDepth) {
            return;
        }
        for (FPDF_BOOKMARK item = FPDFBookmark_GetFirstChild(document, parent); item != nullptr && items.size() < kMaxItems;
             item = FPDFBookmark_GetNextSibling(document, item)) {
            if (!seen.insert(item).second) {
                return;
            }
            const std::string title = readWide([&](unsigned short* buffer, unsigned long length) {
                return FPDFBookmark_GetTitle(item, buffer, length);
            });
            FPDF_DEST dest = FPDFBookmark_GetDest(document, item);
            if (dest == nullptr) {
                FPDF_ACTION action = FPDFBookmark_GetAction(item);
                if (action != nullptr && FPDFAction_GetType(action) == PDFACTION_GOTO) {
                    dest = FPDFAction_GetDest(document, action);
                }
            }
            const int page = dest == nullptr ? -1 : FPDFDest_GetDestPageIndex(document, dest);
            items.emplace_back(title, page, level);
            self(self, item, level + 1);
        }
    };
    visit(visit, nullptr, 0);
    return items;
}

RenderedImage OpenPdf::render(int pageIndex, const RenderRequest& request) {
    EncodedImage image;
    std::string output;
    try {
        std::lock_guard<std::mutex> lock(impl_->mutex);
        std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
        FPDF_DOCUMENT document = impl_->requireDocument();
        const PageGeometry size = pageGeometry(document, pageIndex);
        const auto [width, height] = targetSize(size, request.maxWidth, request.maxHeight, request.scale);
        image = renderEncoded(document, pageIndex, width, height, request.png, request.quality, request.background);
    } catch (const std::bad_alloc&) {
        throwPdfError("out-of-memory", "Not enough memory to render page " + std::to_string(pageIndex));
    }
    output = request.outputPath.empty()
        ? defaultRenderPath(renderDirectory(), impl_->path, pageIndex, request.png)
        : normalizePdfPath(request.outputPath);
    return writeRendered(pageIndex, output, image);
}

void OpenPdf::renderRegion(int pageIndex, void* pixels, int stride, int width, int height, double pageWidthPx,
                           double pageHeightPx, double offsetX, double offsetY, uint32_t background,
                           bool annotations) {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    FPDF_DOCUMENT document = impl_->requireDocument();
    BitmapGuard bitmap;
    bitmap.bitmap = FPDFBitmap_CreateEx(width, height, FPDFBitmap_BGRA, pixels, stride);
    if (bitmap.bitmap == nullptr) {
        throwPdfError("out-of-memory", "Failed to wrap the tile bitmap");
    }
    // The buffer is RGBA (FPDF_REVERSE_BYTE_ORDER) but FillRect writes BGRA.
    const uint32_t swapped = (background & 0xFF00FF00) | ((background & 0xFF) << 16) | ((background >> 16) & 0xFF);
    FPDFBitmap_FillRect(bitmap.bitmap, 0, 0, width, height, swapped | 0xFF000000);
    PageGuard page;
    page.page = loadPage(document, pageIndex);
    FPDF_RenderPageBitmap(bitmap.bitmap, page.page, -static_cast<int>(std::lround(offsetX)),
                          -static_cast<int>(std::lround(offsetY)), static_cast<int>(std::lround(pageWidthPx)),
                          static_cast<int>(std::lround(pageHeightPx)), 0,
                          (annotations ? FPDF_ANNOT : 0) | FPDF_REVERSE_BYTE_ORDER);
}

std::vector<PageLink> OpenPdf::links(int pageIndex) {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    FPDF_DOCUMENT document = impl_->requireDocument();
    PageGuard page;
    page.page = loadPage(document, pageIndex);
    const PageMapper mapper = mapperFor(page.page);
    std::vector<PageLink> result;
    int position = 0;
    FPDF_LINK link = nullptr;
    while (FPDFLink_Enumerate(page.page, &position, &link)) {
        FS_RECTF rect;
        if (!FPDFLink_GetAnnotRect(link, &rect)) {
            continue;
        }
        PageLink out;
        out.rect = mapper.displayRect(rect.left, rect.bottom, rect.right, rect.top);
        FPDF_DEST dest = FPDFLink_GetDest(document, link);
        if (dest == nullptr) {
            FPDF_ACTION action = FPDFLink_GetAction(link);
            if (action != nullptr) {
                const unsigned long type = FPDFAction_GetType(action);
                if (type == PDFACTION_GOTO) {
                    dest = FPDFAction_GetDest(document, action);
                } else if (type == PDFACTION_URI) {
                    const unsigned long length = FPDFAction_GetURIPath(document, action, nullptr, 0);
                    if (length > 1) {
                        std::vector<char> buffer(length);
                        FPDFAction_GetURIPath(document, action, buffer.data(), length);
                        out.uri.assign(buffer.data(), std::strlen(buffer.data()));
                    }
                }
            }
        }
        if (dest != nullptr) {
            out.page = FPDFDest_GetDestPageIndex(document, dest);
        }
        if (out.page >= 0 || !out.uri.empty()) {
            result.push_back(std::move(out));
        }
    }
    return result;
}

std::vector<SearchResult> OpenPdf::search(const std::string& searchTerm, int startPage, int endPage) {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    std::vector<SearchResult> results;
    FPDF_DOCUMENT document = impl_->requireDocument();
    if (searchTerm.empty()) {
        return results;
    }
    const int pageCount = FPDF_GetPageCount(document);
    int from = std::max(0, std::min(startPage, endPage));
    int to = std::min(std::max(startPage, endPage), pageCount - 1);
    const std::vector<unsigned short> needle = utf8ToUtf16(searchTerm);
    for (int pageIndex = from; pageIndex <= to; pageIndex++) {
        PageGuard page;
        page.page = FPDF_LoadPage(document, pageIndex);
        if (page.page == nullptr) {
            continue;
        }
        TextPageGuard textPage;
        textPage.page = FPDFText_LoadPage(page.page);
        if (textPage.page == nullptr) {
            continue;
        }
        const PageMapper mapper = mapperFor(page.page);
        FPDF_SCHHANDLE finder = FPDFText_FindStart(textPage.page, needle.data(), 0, 0);
        if (finder == nullptr) {
            continue;
        }
        while (FPDFText_FindNext(finder)) {
            const int index = FPDFText_GetSchResultIndex(finder);
            const int count = FPDFText_GetSchCount(finder);
            std::string snippet;
            if (count > 0) {
                std::vector<unsigned short> buffer(static_cast<size_t>(count) + 1);
                FPDFText_GetText(textPage.page, index, count, buffer.data());
                snippet = utf16ToUtf8(buffer.data(), static_cast<size_t>(count));
            }
            const int rects = FPDFText_CountRects(textPage.page, index, count);
            bool any = false;
            double minX = 0, minY = 0, maxX = 0, maxY = 0;
            for (int rectIndex = 0; rectIndex < rects; rectIndex++) {
                double left = 0, top = 0, right = 0, bottom = 0;
                if (!FPDFText_GetRect(textPage.page, rectIndex, &left, &top, &right, &bottom)) {
                    continue;
                }
                const PdfRect rect = mapper.displayRect(left, bottom, right, top);
                if (!any) {
                    minX = rect.x;
                    minY = rect.y;
                    maxX = rect.x + rect.width;
                    maxY = rect.y + rect.height;
                    any = true;
                } else {
                    minX = std::min(minX, rect.x);
                    minY = std::min(minY, rect.y);
                    maxX = std::max(maxX, rect.x + rect.width);
                    maxY = std::max(maxY, rect.y + rect.height);
                }
            }
            results.emplace_back(static_cast<double>(pageIndex), snippet, PdfRect(minX, minY, maxX - minX, maxY - minY));
        }
        FPDFText_FindClose(finder);
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

void OpenPdf::rotate(int pageIndex, int degrees) {
    if (degrees % 90 != 0) {
        throwPdfError("invalid-argument", "Rotation must be a multiple of 90 degrees, got " + std::to_string(degrees));
    }
    std::lock_guard<std::mutex> lock(impl_->mutex);
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    PageGuard page;
    page.page = loadPage(impl_->requireDocument(), pageIndex);
    const int turns = ((FPDFPage_GetRotation(page.page) + degrees / 90) % 4 + 4) % 4;
    FPDFPage_SetRotation(page.page, turns);
    impl_->dirty = true;
}

void OpenPdf::removePage(int pageIndex) {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    FPDF_DOCUMENT document = impl_->requireDocument();
    requirePage(document, pageIndex);
    if (FPDF_GetPageCount(document) <= 1) {
        throwPdfError("invalid-argument", "Cannot delete the only page of a PDF");
    }
    impl_->exitForm();
    FPDFPage_Delete(document, pageIndex);
    impl_->dirty = true;
}

void OpenPdf::movePage(int from, int to) {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    FPDF_DOCUMENT document = impl_->requireDocument();
    requirePage(document, from);
    requirePage(document, to);
    if (from == to) {
        return;
    }
    if (!FPDF_MovePages(document, &from, 1, to)) {
        throwPdfError("unknown", "Failed to move page " + std::to_string(from) + " to " + std::to_string(to));
    }
    impl_->dirty = true;
}

void OpenPdf::insertPages(const std::string& fromPath, int atIndex, const std::vector<int>& pages,
                          const std::optional<std::string>& password) {
    const std::string sourcePath = normalizePdfPath(fromPath);
    std::lock_guard<std::mutex> lock(impl_->mutex);
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    FPDF_DOCUMENT document = impl_->requireDocument();
    const int count = FPDF_GetPageCount(document);
    if (atIndex < 0 || atIndex > count) {
        throwPdfError("invalid-page", "Insert position " + std::to_string(atIndex) + " is out of range (0-" +
                                          std::to_string(count) + ")");
    }
    FPDF_DOCUMENT source = loadDocument(sourcePath, password);
    try {
        const int sourceCount = FPDF_GetPageCount(source);
        std::vector<int> indices = pages;
        if (indices.empty()) {
            for (int index = 0; index < sourceCount; index++) {
                indices.push_back(index);
            }
        }
        for (int index : indices) {
            if (index < 0 || index >= sourceCount) {
                throwPdfError("invalid-page", "Page " + std::to_string(index) + " does not exist in " + sourcePath);
            }
        }
        impl_->exitForm();
        if (!FPDF_ImportPagesByIndex(document, source, indices.data(), static_cast<unsigned long>(indices.size()), atIndex)) {
            throwPdfError("unsupported-pdf", "Failed to import pages from " + sourcePath);
        }
        FPDF_CloseDocument(source);
    } catch (...) {
        FPDF_CloseDocument(source);
        throw;
    }
    impl_->dirty = true;
}

int OpenPdf::addAnnotation(const AnnotationInput& input) {
    const int pageIndex = static_cast<int>(input.page);
    if (input.rect.width <= 0 || input.rect.height <= 0) {
        throwPdfError("invalid-argument", "Annotation rect must have a positive width and height");
    }
    std::lock_guard<std::mutex> lock(impl_->mutex);
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    FPDF_DOCUMENT document = impl_->requireDocument();
    PageGuard page;
    page.page = loadPage(document, pageIndex);
    const PageMapper mapper = mapperFor(page.page);
    const FS_RECTF rect = mapper.pageRect(input.rect);

    FPDF_ANNOTATION_SUBTYPE subtype = FPDF_ANNOT_HIGHLIGHT;
    Rgba fallback;
    switch (input.type) {
        case AddableAnnotationType::HIGHLIGHT: subtype = FPDF_ANNOT_HIGHLIGHT; fallback = {255, 235, 59, 255}; break;
        case AddableAnnotationType::INK: subtype = FPDF_ANNOT_INK; fallback = {229, 57, 53, 255}; break;
        case AddableAnnotationType::FREETEXT: subtype = FPDF_ANNOT_FREETEXT; fallback = {0, 0, 0, 255}; break;
        case AddableAnnotationType::NOTE: subtype = FPDF_ANNOT_TEXT; fallback = {255, 214, 0, 255}; break;
        case AddableAnnotationType::STAMP: subtype = FPDF_ANNOT_STAMP; fallback = {211, 47, 47, 255}; break;
    }
    const Rgba color = parseRgba(input.color, fallback);

    AnnotGuard annot;
    annot.annot = FPDFPage_CreateAnnot(page.page, subtype);
    if (annot.annot == nullptr) {
        throwPdfError("unsupported-operation", "PDFium cannot create this annotation type");
    }
    FPDFAnnot_SetRect(annot.annot, &rect);
    FPDFAnnot_SetFlags(annot.annot, FPDF_ANNOT_FLAG_PRINT);
    if (subtype != FPDF_ANNOT_STAMP) {
        FPDFAnnot_SetColor(annot.annot, FPDFANNOT_COLORTYPE_Color, color.r, color.g, color.b, color.a);
    }
    const std::string text = input.text.value_or("");
    if (!text.empty()) {
        const std::vector<unsigned short> wide = utf8ToUtf16(text);
        FPDFAnnot_SetStringValue(annot.annot, "Contents", wide.data());
    }

    if (subtype == FPDF_ANNOT_HIGHLIGHT) {
        FS_QUADPOINTSF quad;
        quad.x1 = rect.left;
        quad.y1 = rect.top;
        quad.x2 = rect.right;
        quad.y2 = rect.top;
        quad.x3 = rect.left;
        quad.y3 = rect.bottom;
        quad.x4 = rect.right;
        quad.y4 = rect.bottom;
        FPDFAnnot_AppendAttachmentPoints(annot.annot, &quad);
    } else if (subtype == FPDF_ANNOT_INK) {
        if (!input.strokes.has_value() || input.strokes->empty()) {
            FPDFPage_RemoveAnnot(page.page, FPDFPage_GetAnnotIndex(page.page, annot.annot));
            throwPdfError("invalid-argument", "Ink annotations need at least one stroke");
        }
        for (const InkStroke& stroke : *input.strokes) {
            std::vector<FS_POINTF> points;
            points.reserve(stroke.points.size());
            for (const PdfPoint& point : stroke.points) {
                double x = 0;
                double y = 0;
                mapper.toPage(point.x, point.y, &x, &y);
                points.push_back(FS_POINTF {static_cast<float>(x), static_cast<float>(y)});
            }
            if (!points.empty()) {
                FPDFAnnot_AddInkStroke(annot.annot, points.data(), points.size());
            }
        }
        FPDFAnnot_SetBorder(annot.annot, 0, 0, 2);
    } else if (subtype == FPDF_ANNOT_FREETEXT) {
        char appearance[64];
        std::snprintf(appearance, sizeof(appearance), "/Helv 12 Tf %.3f %.3f %.3f rg", color.r / 255.0, color.g / 255.0,
                      color.b / 255.0);
        const std::vector<unsigned short> wide = utf8ToUtf16(appearance);
        FPDFAnnot_SetStringValue(annot.annot, "DA", wide.data());
    } else if (subtype == FPDF_ANNOT_STAMP) {
        drawStamp(document, annot.annot, rect, color, text);
    }

    const int index = FPDFPage_GetAnnotIndex(page.page, annot.annot);
    impl_->dirty = true;
    return index;
}

std::vector<PdfAnnotation> OpenPdf::annotations(int pageIndex) {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    FPDF_DOCUMENT document = impl_->requireDocument();
    PageGuard page;
    page.page = loadPage(document, pageIndex);
    const PageMapper mapper = mapperFor(page.page);
    std::vector<PdfAnnotation> result;
    const int count = FPDFPage_GetAnnotCount(page.page);
    for (int index = 0; index < count; index++) {
        AnnotGuard annot;
        annot.annot = FPDFPage_GetAnnot(page.page, index);
        if (annot.annot == nullptr) {
            continue;
        }
        FS_RECTF rect {0, 0, 0, 0};
        FPDFAnnot_GetRect(annot.annot, &rect);
        unsigned int r = 0, g = 0, b = 0, a = 255;
        std::string color;
        if (FPDFAnnot_GetColor(annot.annot, FPDFANNOT_COLORTYPE_Color, &r, &g, &b, &a)) {
            color = formatColor(r, g, b, a);
        }
        const std::string contents = readWide([&](unsigned short* buffer, unsigned long length) {
            return FPDFAnnot_GetStringValue(annot.annot, "Contents", buffer, length);
        });
        result.emplace_back(pageIndex, index, annotationTypeOf(FPDFAnnot_GetSubtype(annot.annot)),
                            mapper.displayRect(std::min(rect.left, rect.right), std::min(rect.bottom, rect.top),
                                               std::max(rect.left, rect.right), std::max(rect.bottom, rect.top)),
                            color, contents);
    }
    return result;
}

void OpenPdf::removeAnnotation(int pageIndex, int index) {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    PageGuard page;
    page.page = loadPage(impl_->requireDocument(), pageIndex);
    const int count = FPDFPage_GetAnnotCount(page.page);
    if (index < 0 || index >= count) {
        throwPdfError("invalid-argument", "Annotation " + std::to_string(index) + " does not exist on page " +
                                              std::to_string(pageIndex));
    }
    if (!FPDFPage_RemoveAnnot(page.page, index)) {
        throwPdfError("unknown", "Failed to remove annotation " + std::to_string(index));
    }
    impl_->dirty = true;
}

std::vector<PdfFormField> OpenPdf::formFields() {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    FPDF_DOCUMENT document = impl_->requireDocument();
    std::vector<PdfFormField> fields;
    if (FPDF_GetFormType(document) == FORMTYPE_NONE) {
        return fields;
    }
    FPDF_FORMHANDLE form = impl_->requireForm();
    std::unordered_map<std::string, size_t> byName;
    const int count = FPDF_GetPageCount(document);
    for (int pageIndex = 0; pageIndex < count; pageIndex++) {
        FormPage page(form, document, pageIndex);
        if (page.page == nullptr) {
            continue;
        }
        const int annots = FPDFPage_GetAnnotCount(page.page);
        for (int index = 0; index < annots; index++) {
            AnnotGuard annot;
            annot.annot = FPDFPage_GetAnnot(page.page, index);
            if (annot.annot == nullptr || FPDFAnnot_GetSubtype(annot.annot) != FPDF_ANNOT_WIDGET) {
                continue;
            }
            const std::string name = readWide([&](unsigned short* buffer, unsigned long length) {
                return FPDFAnnot_GetFormFieldName(form, annot.annot, buffer, length);
            });
            if (name.empty()) {
                continue;
            }
            const int rawType = FPDFAnnot_GetFormFieldType(form, annot.annot);
            const FormFieldType type = formFieldTypeOf(rawType);
            const bool checked = (rawType == FPDF_FORMFIELD_CHECKBOX || rawType == FPDF_FORMFIELD_RADIOBUTTON) &&
                                 FPDFAnnot_IsChecked(form, annot.annot);
            std::string value = readWide([&](unsigned short* buffer, unsigned long length) {
                return FPDFAnnot_GetFormFieldValue(form, annot.annot, buffer, length);
            });
            if (rawType == FPDF_FORMFIELD_RADIOBUTTON) {
                value = checked ? readWide([&](unsigned short* buffer, unsigned long length) {
                    return FPDFAnnot_GetFormFieldExportValue(form, annot.annot, buffer, length);
                }) : "";
            }
            const auto existing = byName.find(name);
            if (existing != byName.end()) {
                PdfFormField& field = fields[existing->second];
                if (checked) {
                    field.checked = true;
                    if (rawType == FPDF_FORMFIELD_RADIOBUTTON) {
                        field.value = value;
                    }
                }
                if (rawType == FPDF_FORMFIELD_RADIOBUTTON) {
                    const std::string option = readWide([&](unsigned short* buffer, unsigned long length) {
                        return FPDFAnnot_GetFormFieldExportValue(form, annot.annot, buffer, length);
                    });
                    if (!option.empty() && std::find(field.options.begin(), field.options.end(), option) == field.options.end()) {
                        field.options.push_back(option);
                    }
                }
                continue;
            }
            std::vector<std::string> options;
            if (rawType == FPDF_FORMFIELD_COMBOBOX || rawType == FPDF_FORMFIELD_LISTBOX) {
                const int optionCount = FPDFAnnot_GetOptionCount(form, annot.annot);
                for (int option = 0; option < optionCount; option++) {
                    options.push_back(readWide([&](unsigned short* buffer, unsigned long length) {
                        return FPDFAnnot_GetOptionLabel(form, annot.annot, option, buffer, length);
                    }));
                }
            } else if (rawType == FPDF_FORMFIELD_RADIOBUTTON) {
                const std::string option = readWide([&](unsigned short* buffer, unsigned long length) {
                    return FPDFAnnot_GetFormFieldExportValue(form, annot.annot, buffer, length);
                });
                if (!option.empty()) {
                    options.push_back(option);
                }
            }
            const bool readOnly = (FPDFAnnot_GetFormFieldFlags(form, annot.annot) & FPDF_FORMFLAG_READONLY) != 0;
            byName.emplace(name, fields.size());
            fields.emplace_back(name, type, value, checked, options, pageIndex, readOnly);
        }
    }
    return fields;
}

void OpenPdf::setFormValues(const std::unordered_map<std::string, std::string>& values) {
    if (values.empty()) {
        return;
    }
    std::lock_guard<std::mutex> lock(impl_->mutex);
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    FPDF_DOCUMENT document = impl_->requireDocument();
    if (FPDF_GetFormType(document) == FORMTYPE_NONE) {
        throwPdfError("invalid-argument", "This PDF has no form fields");
    }
    FPDF_FORMHANDLE form = impl_->requireForm();
    std::set<std::string> found;
    bool changed = false;
    const int count = FPDF_GetPageCount(document);
    for (int pageIndex = 0; pageIndex < count; pageIndex++) {
        FormPage page(form, document, pageIndex);
        if (page.page == nullptr) {
            continue;
        }
        const int annots = FPDFPage_GetAnnotCount(page.page);
        for (int index = 0; index < annots; index++) {
            AnnotGuard annot;
            annot.annot = FPDFPage_GetAnnot(page.page, index);
            if (annot.annot == nullptr || FPDFAnnot_GetSubtype(annot.annot) != FPDF_ANNOT_WIDGET) {
                continue;
            }
            const std::string name = readWide([&](unsigned short* buffer, unsigned long length) {
                return FPDFAnnot_GetFormFieldName(form, annot.annot, buffer, length);
            });
            const auto wanted = values.find(name);
            if (wanted == values.end()) {
                continue;
            }
            found.insert(name);
            if ((FPDFAnnot_GetFormFieldFlags(form, annot.annot) & FPDF_FORMFLAG_READONLY) != 0) {
                continue;
            }
            const std::string& value = wanted->second;
            const int type = FPDFAnnot_GetFormFieldType(form, annot.annot);
            FS_RECTF rect {0, 0, 0, 0};
            FPDFAnnot_GetRect(annot.annot, &rect);
            const double centerX = (rect.left + rect.right) / 2;
            const double centerY = (rect.top + rect.bottom) / 2;
            if (type == FPDF_FORMFIELD_CHECKBOX || type == FPDF_FORMFIELD_RADIOBUTTON) {
                const std::string exportValue = readWide([&](unsigned short* buffer, unsigned long length) {
                    return FPDFAnnot_GetFormFieldExportValue(form, annot.annot, buffer, length);
                });
                const bool want = type == FPDF_FORMFIELD_CHECKBOX ? (isTruthy(value) || (!exportValue.empty() && value == exportValue))
                                                                  : value == exportValue;
                if (want != static_cast<bool>(FPDFAnnot_IsChecked(form, annot.annot)) && (type == FPDF_FORMFIELD_CHECKBOX || want)) {
                    FORM_OnLButtonDown(form, page.page, 0, centerX, centerY);
                    FORM_OnLButtonUp(form, page.page, 0, centerX, centerY);
                    FORM_ForceToKillFocus(form);
                    changed = true;
                }
            } else if (type == FPDF_FORMFIELD_COMBOBOX || type == FPDF_FORMFIELD_LISTBOX) {
                const int optionCount = FPDFAnnot_GetOptionCount(form, annot.annot);
                int match = -1;
                for (int option = 0; option < optionCount && match < 0; option++) {
                    const std::string label = readWide([&](unsigned short* buffer, unsigned long length) {
                        return FPDFAnnot_GetOptionLabel(form, annot.annot, option, buffer, length);
                    });
                    if (label == value) {
                        match = option;
                    }
                }
                FORM_SetFocusedAnnot(form, annot.annot);
                if (match >= 0) {
                    FORM_SetIndexSelected(form, page.page, match, true);
                } else if (type == FPDF_FORMFIELD_COMBOBOX) {
                    const std::vector<unsigned short> wide = utf8ToUtf16(value);
                    FORM_SelectAllText(form, page.page);
                    FORM_ReplaceSelection(form, page.page, wide.data());
                } else {
                    FORM_ForceToKillFocus(form);
                    throwPdfError("invalid-argument", "\"" + value + "\" is not an option of " + name);
                }
                FORM_ForceToKillFocus(form);
                changed = true;
            } else if (type == FPDF_FORMFIELD_TEXTFIELD) {
                const std::vector<unsigned short> wide = utf8ToUtf16(value);
                FORM_SetFocusedAnnot(form, annot.annot);
                FORM_SelectAllText(form, page.page);
                FORM_ReplaceSelection(form, page.page, wide.data());
                FORM_ForceToKillFocus(form);
                changed = true;
            }
        }
    }
    for (const auto& [name, value] : values) {
        if (found.find(name) == found.end()) {
            throwPdfError("invalid-argument", "No form field named \"" + name + "\"");
        }
    }
    if (changed) {
        impl_->dirty = true;
    }
}

void OpenPdf::flattenForms() {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
    FPDF_DOCUMENT document = impl_->requireDocument();
    if (impl_->form != nullptr) {
        FORM_ForceToKillFocus(impl_->form);
    }
    impl_->exitForm();
    const int count = FPDF_GetPageCount(document);
    bool changed = false;
    for (int pageIndex = 0; pageIndex < count; pageIndex++) {
        PageGuard page;
        page.page = FPDF_LoadPage(document, pageIndex);
        if (page.page == nullptr) {
            continue;
        }
        const int result = FPDFPage_Flatten(page.page, FLAT_NORMALDISPLAY);
        if (result == FLATTEN_FAIL) {
            throwPdfError("unknown", "Failed to flatten page " + std::to_string(pageIndex));
        }
        changed = changed || result == FLATTEN_SUCCESS;
    }
    if (changed) {
        impl_->dirty = true;
    }
}

std::string OpenPdf::save(const std::string& outputPath) {
    const std::string output = normalizePdfPath(outputPath);
    if (output.empty()) {
        throwPdfError("invalid-argument", "save() needs an output path");
    }
    std::vector<unsigned char> bytes;
    {
        std::lock_guard<std::mutex> lock(impl_->mutex);
        std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
        FPDF_DOCUMENT document = impl_->requireDocument();
        if (impl_->form != nullptr) {
            FORM_ForceToKillFocus(impl_->form);
        }
        bytes = saveToMemory(document);
    }
    // PDFium keeps its own handle on the source file, so replacing it by rename is safe.
    writeAtomically(output, bytes);
    std::lock_guard<std::mutex> lock(impl_->mutex);
    impl_->dirty = false;
    return output;
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
            throwPdfError("invalid-argument", "At least 2 PDF files are required for merging");
        }
        ensureLibrary();
        FPDF_DOCUMENT merged = FPDF_CreateNewDocument();
        if (merged == nullptr) {
            throwPdfError("out-of-memory", "Failed to create the merged PDF");
        }
        std::vector<FPDF_DOCUMENT> sources;
        try {
            for (const std::string& rawPath : filePaths) {
                const std::string path = normalizePdfPath(rawPath);
                FPDF_DOCUMENT source = loadFresh(path);
                sources.push_back(source);
                const int count = FPDF_GetPageCount(source);
                if (count <= 0) {
                    throwPdfError("unsupported-pdf", "PDF has no pages: " + path);
                }
                if (FPDF_ImportPages(merged, source, nullptr, FPDF_GetPageCount(merged)) == 0) {
                    throwPdfError("unsupported-pdf", "Failed to import pages from " + path);
                }
            }
            output = outputPath.empty()
                ? parentDirectory(normalizePdfPath(filePaths[0])) + "/merged-" +
                      std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()) + ".pdf"
                : normalizePdfPath(outputPath);
            bytes = saveToMemory(merged);
        } catch (...) {
            FPDF_CloseDocument(merged);
            for (FPDF_DOCUMENT source : sources) {
                FPDF_CloseDocument(source);
            }
            throw;
        }
        FPDF_CloseDocument(merged);
        for (FPDF_DOCUMENT source : sources) {
            FPDF_CloseDocument(source);
        }
    }
    writeAtomically(output, bytes);
    return output;
}

std::string pdfiumSplit(const std::string& filePath, const std::string& pageRangesJson, const std::string& outputDir) {
    std::vector<std::pair<std::string, std::vector<unsigned char>>> pieces;
    {
        std::lock_guard<std::mutex> pdfiumLock(gPdfiumMutex);
        const std::string path = normalizePdfPath(filePath);
        FPDF_DOCUMENT source = loadFresh(path);
        try {
            const std::string directory = outputDir.empty() ? parentDirectory(path) : normalizePdfPath(outputDir);
            const std::vector<PageRange> ranges = parseRanges(pageRangesJson);
            const int count = FPDF_GetPageCount(source);
            const auto stamp = std::chrono::duration_cast<std::chrono::milliseconds>(
                                   std::chrono::system_clock::now().time_since_epoch())
                                   .count();
            for (const PageRange& range : ranges) {
                if (range.start < 0 || range.end >= count || range.end < range.start) {
                    throwPdfError("invalid-page", "Invalid page range [" + std::to_string(range.start) + ", " +
                                                      std::to_string(range.end) + "]");
                }
                FPDF_DOCUMENT piece = FPDF_CreateNewDocument();
                if (piece == nullptr) {
                    throwPdfError("out-of-memory", "Failed to create a split PDF");
                }
                const std::string pageRange = std::to_string(range.start + 1) + "-" + std::to_string(range.end + 1);
                const std::string output = directory + "/split-" + std::to_string(range.start) + "-" +
                                           std::to_string(range.end) + "-" + std::to_string(stamp) + ".pdf";
                if (FPDF_ImportPages(piece, source, pageRange.c_str(), 0) == 0) {
                    FPDF_CloseDocument(piece);
                    throwPdfError("unsupported-pdf", "Failed to split pages " + pageRange);
                }
                try {
                    pieces.emplace_back(output, saveToMemory(piece));
                } catch (...) {
                    FPDF_CloseDocument(piece);
                    throw;
                }
                FPDF_CloseDocument(piece);
            }
        } catch (...) {
            FPDF_CloseDocument(source);
            throw;
        }
        FPDF_CloseDocument(source);
    }
    std::ostringstream out;
    out << '[';
    for (size_t index = 0; index < pieces.size(); index++) {
        writeAtomically(pieces[index].first, pieces[index].second);
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
        const std::string path = normalizePdfPath(filePath);
        FPDF_DOCUMENT source = loadFresh(path);
        FPDF_DOCUMENT extracted = FPDF_CreateNewDocument();
        if (extracted == nullptr) {
            FPDF_CloseDocument(source);
            throwPdfError("out-of-memory", "Failed to create the extracted PDF");
        }
        try {
            const std::vector<int> pages = parseIntArray(pageNumbersJson);
            const int count = FPDF_GetPageCount(source);
            for (int pageIndex : pages) {
                if (pageIndex < 0 || pageIndex >= count) {
                    throwPdfError("invalid-page", "Page " + std::to_string(pageIndex) + " is out of range");
                }
            }
            if (pages.empty()) {
                throwPdfError("invalid-argument", "No pages to extract");
            }
            if (!FPDF_ImportPagesByIndex(extracted, source, pages.data(), static_cast<unsigned long>(pages.size()), 0)) {
                throwPdfError("unsupported-pdf", "Failed to extract pages");
            }
            output = outputPath.empty()
                ? parentDirectory(path) + "/extract-" +
                      std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()) + ".pdf"
                : normalizePdfPath(outputPath);
            bytes = saveToMemory(extracted);
        } catch (...) {
            FPDF_CloseDocument(extracted);
            FPDF_CloseDocument(source);
            throw;
        }
        FPDF_CloseDocument(extracted);
        FPDF_CloseDocument(source);
    }
    writeAtomically(output, bytes);
    return output;
}

std::string pdfiumCompress(const std::string& inputPath, const std::string& outputPath, int compressionLevel) {
    const auto started = std::chrono::steady_clock::now();
    const std::string input = normalizePdfPath(inputPath);
    const long long originalSize = fileSizeOf(input);
    if (originalSize < 0) {
        throwPdfError("invalid-source", "PDF file not found: " + input);
    }
    std::string output = outputPath.empty()
        ? parentDirectory(input) + "/compressed-" + std::to_string(started.time_since_epoch().count()) + ".pdf"
        : normalizePdfPath(outputPath);
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
            throwPdfError("out-of-memory", "Failed to create the compressed PDF");
        }
        try {
            const int count = FPDF_GetPageCount(source);
            for (int index = 0; index < count; index++) {
                const PageGeometry size = pageGeometry(source, index);
                const std::vector<unsigned char> jpeg = renderJpeg(source, index, scale, jpegQuality);
                addJpegPage(compressed, jpeg, size.width, size.height);
            }
            bytes = saveToMemory(compressed);
        } catch (...) {
            FPDF_CloseDocument(compressed);
            FPDF_CloseDocument(source);
            throw;
        }
        FPDF_CloseDocument(compressed);
        FPDF_CloseDocument(source);
    }
    const std::string temp = output + ".recompress.tmp";
    writeBytes(temp, bytes);
    long long compressedSize = fileSizeOf(temp);
    if (compressedSize <= 0 || compressedSize >= originalSize) {
        std::remove(temp.c_str());
        if (input != output && !copyFile(input, output)) {
            throwPdfError("io-error", "Failed to copy the original PDF");
        }
        compressedSize = originalSize;
    } else if (std::rename(temp.c_str(), output.c_str()) != 0) {
        std::remove(temp.c_str());
        throwPdfError("io-error", "Failed to move the compressed PDF");
    }
    const auto elapsed = std::chrono::steady_clock::now() - started;
    const long long duration = std::chrono::duration_cast<std::chrono::milliseconds>(elapsed).count();
    const double ratio = originalSize > 0 ? static_cast<double>(compressedSize) / static_cast<double>(originalSize) : 1.0;
    const double saved = (1.0 - ratio) * 100.0;
    std::ostringstream json;
    json.setf(std::ios::fixed);
    json.precision(6);
    json << "{\"success\":true,\"originalSize\":" << originalSize << ",\"compressedSize\":" << compressedSize
         << ",\"durationMs\":" << duration << ",\"compressionRatio\":" << ratio << ",\"spaceSavedPercent\":" << saved
         << ",\"outputPath\":\"" << jsonEscape(output) << "\"}";
    return json.str();
}

} // namespace margelo::nitro::pdfjsi
