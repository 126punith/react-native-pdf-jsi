#include "PdfDiskCache.hpp"

#include <fbjni/fbjni.h>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <mutex>
#include <stdexcept>
#include <vector>

namespace margelo::nitro::pdfjsi {

namespace {

constexpr int64_t kTtlMs = 30LL * 24 * 60 * 60 * 1000;
constexpr uintmax_t kMaxBytes = 500ULL * 1024 * 1024;
constexpr int kMaxFiles = 100;

std::mutex gCacheMutex;
int gHits = 0;
int gMisses = 0;

std::string cacheDirectory() {
    JNIEnv* env = facebook::jni::Environment::current();
    if (env == nullptr) {
        throw std::runtime_error("JNI environment is not available");
    }
    jclass threadClass = env->FindClass("android/app/ActivityThread");
    jmethodID currentApplication = env->GetStaticMethodID(threadClass, "currentApplication", "()Landroid/app/Application;");
    jobject application = env->CallStaticObjectMethod(threadClass, currentApplication);
    jclass contextClass = env->GetObjectClass(application);
    jmethodID getCacheDir = env->GetMethodID(contextClass, "getCacheDir", "()Ljava/io/File;");
    jobject cacheDir = env->CallObjectMethod(application, getCacheDir);
    jclass fileClass = env->GetObjectClass(cacheDir);
    jmethodID getAbsolutePath = env->GetMethodID(fileClass, "getAbsolutePath", "()Ljava/lang/String;");
    jstring path = static_cast<jstring>(env->CallObjectMethod(cacheDir, getAbsolutePath));
    const char* chars = env->GetStringUTFChars(path, nullptr);
    std::string directory = std::string(chars) + "/pdf-jsi-cache";
    env->ReleaseStringUTFChars(path, chars);
    std::filesystem::create_directories(directory);
    return directory;
}

std::string safeName(const std::string& identifier) {
    std::string name;
    name.reserve(identifier.size());
    for (unsigned char ch : identifier) {
        if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-' || ch == '_') {
            name.push_back(static_cast<char>(ch));
        } else {
            name.push_back('_');
        }
    }
    if (name.empty()) {
        name = "pdf";
    }
    return name;
}

int base64Value(unsigned char ch) {
    if (ch >= 'A' && ch <= 'Z') return ch - 'A';
    if (ch >= 'a' && ch <= 'z') return ch - 'a' + 26;
    if (ch >= '0' && ch <= '9') return ch - '0' + 52;
    if (ch == '+' || ch == '-') return 62;
    if (ch == '/' || ch == '_') return 63;
    return -1;
}

std::vector<unsigned char> decodeBase64(const std::string& input) {
    std::string cleaned;
    cleaned.reserve(input.size());
    for (unsigned char ch : input) {
        if (ch == '=' || base64Value(ch) >= 0) {
            cleaned.push_back(static_cast<char>(ch));
        }
    }
    std::vector<unsigned char> out;
    int value = 0;
    int bits = -8;
    for (unsigned char ch : cleaned) {
        if (ch == '=') {
            break;
        }
        const int digit = base64Value(ch);
        if (digit < 0) {
            continue;
        }
        value = (value << 6) + digit;
        bits += 6;
        if (bits >= 0) {
            out.push_back(static_cast<unsigned char>((value >> bits) & 0xFF));
            bits -= 8;
        }
    }
    return out;
}

int64_t nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
}

std::filesystem::path pdfPath(const std::string& identifier) {
    return std::filesystem::path(cacheDirectory()) / (safeName(identifier) + ".pdf");
}

std::filesystem::path metaPath(const std::filesystem::path& pdf) {
    return std::filesystem::path(pdf.string() + ".meta");
}

void writeStamp(const std::filesystem::path& pdf) {
    FILE* file = std::fopen(metaPath(pdf).c_str(), "wb");
    if (file == nullptr) {
        return;
    }
    const int64_t stamp = nowMs();
    std::fwrite(&stamp, sizeof(stamp), 1, file);
    std::fclose(file);
}

int64_t readStamp(const std::filesystem::path& pdf) {
    FILE* file = std::fopen(metaPath(pdf).c_str(), "rb");
    if (file == nullptr) {
        return 0;
    }
    int64_t stamp = 0;
    std::fread(&stamp, sizeof(stamp), 1, file);
    std::fclose(file);
    return stamp;
}

struct Victim {
    std::filesystem::path pdf;
    std::filesystem::path meta;
};

std::vector<Victim> collectExpiredLocked(const std::filesystem::path& directory) {
    std::vector<Victim> victims;
    if (!std::filesystem::exists(directory)) {
        return victims;
    }
    const int64_t now = nowMs();
    for (const auto& entry : std::filesystem::directory_iterator(directory)) {
        if (entry.path().extension() != ".pdf") {
            continue;
        }
        const int64_t stamp = readStamp(entry.path());
        if (stamp > 0 && now - stamp > kTtlMs) {
            victims.push_back(Victim{entry.path(), metaPath(entry.path())});
        }
    }
    return victims;
}

void deleteVictims(const std::vector<Victim>& victims) {
    for (const Victim& victim : victims) {
        std::error_code error;
        std::filesystem::remove(victim.pdf, error);
        std::filesystem::remove(victim.meta, error);
    }
}

void evictIfNeeded(const std::filesystem::path& directory) {
    std::vector<Victim> victims;
    {
        std::lock_guard<std::mutex> lock(gCacheMutex);
        if (!std::filesystem::exists(directory)) {
            return;
        }
        struct Item {
            std::filesystem::path pdf;
            int64_t stamp = 0;
            uintmax_t bytes = 0;
        };
        std::vector<Item> items;
        uintmax_t total = 0;
        for (const auto& entry : std::filesystem::directory_iterator(directory)) {
            if (entry.path().extension() != ".pdf") {
                continue;
            }
            const uintmax_t bytes = entry.file_size();
            total += bytes;
            items.push_back(Item{entry.path(), readStamp(entry.path()), bytes});
        }
        std::sort(items.begin(), items.end(), [](const Item& a, const Item& b) {
            return a.stamp < b.stamp;
        });
        size_t index = 0;
        while ((items.size() - index > static_cast<size_t>(kMaxFiles) || total > kMaxBytes) && index < items.size()) {
            victims.push_back(Victim{items[index].pdf, metaPath(items[index].pdf)});
            total -= items[index].bytes;
            index++;
        }
    }
    deleteVictims(victims);
}

} // namespace

PdfCacheInfo cacheStore(const std::string& base64, const std::string& identifier) {
    const std::vector<unsigned char> bytes = decodeBase64(base64);
    if (bytes.size() < 5 || std::string(reinterpret_cast<const char*>(bytes.data()), 5) != "%PDF-") {
        throw std::runtime_error("Invalid PDF data");
    }
    const std::filesystem::path directory(cacheDirectory());
    evictIfNeeded(directory);
    const std::filesystem::path pdf = pdfPath(identifier);
    {
        FILE* file = std::fopen(pdf.c_str(), "wb");
        if (file == nullptr) {
            throw std::runtime_error("Failed to write cached PDF");
        }
        const size_t written = std::fwrite(bytes.data(), 1, bytes.size(), file);
        std::fclose(file);
        if (written != bytes.size()) {
            std::filesystem::remove(pdf);
            throw std::runtime_error("Failed to write cached PDF");
        }
    }
    writeStamp(pdf);
    return PdfCacheInfo(identifier, pdf.string(), static_cast<double>(bytes.size()));
}

std::string cachePath(const std::string& identifier) {
    const std::filesystem::path pdf = pdfPath(identifier);
    std::lock_guard<std::mutex> lock(gCacheMutex);
    if (!std::filesystem::exists(pdf)) {
        gMisses++;
        return "";
    }
    const int64_t stamp = readStamp(pdf);
    if (stamp > 0 && nowMs() - stamp > kTtlMs) {
        gMisses++;
        return "";
    }
    gHits++;
    return pdf.string();
}

bool cacheRemove(const std::string& identifier) {
    const std::filesystem::path pdf = pdfPath(identifier);
    std::error_code error;
    const bool removed = std::filesystem::remove(pdf, error);
    std::filesystem::remove(metaPath(pdf), error);
    return removed;
}

bool cacheClear() {
    const std::filesystem::path directory(cacheDirectory());
    std::vector<Victim> victims;
    {
        std::lock_guard<std::mutex> lock(gCacheMutex);
        if (std::filesystem::exists(directory)) {
            for (const auto& entry : std::filesystem::directory_iterator(directory)) {
                if (entry.path().extension() == ".pdf") {
                    victims.push_back(Victim{entry.path(), metaPath(entry.path())});
                }
            }
        }
        gHits = 0;
        gMisses = 0;
    }
    deleteVictims(victims);
    return true;
}

double cacheClearExpired() {
    const std::filesystem::path directory(cacheDirectory());
    std::vector<Victim> victims;
    {
        std::lock_guard<std::mutex> lock(gCacheMutex);
        victims = collectExpiredLocked(directory);
    }
    deleteVictims(victims);
    return static_cast<double>(victims.size());
}

PdfCacheStats cacheStats() {
    const std::filesystem::path directory(cacheDirectory());
    std::lock_guard<std::mutex> lock(gCacheMutex);
    double count = 0;
    double bytes = 0;
    if (std::filesystem::exists(directory)) {
        for (const auto& entry : std::filesystem::directory_iterator(directory)) {
            if (entry.path().extension() != ".pdf") {
                continue;
            }
            count += 1;
            bytes += static_cast<double>(entry.file_size());
        }
    }
    const int lookups = gHits + gMisses;
    const double ratio = lookups == 0 ? 0 : static_cast<double>(gHits) / lookups;
    return PdfCacheStats(count, bytes, ratio);
}

} // namespace margelo::nitro::pdfjsi
