#pragma once

#include "PdfCacheInfo.hpp"
#include "PdfCacheStats.hpp"

#include <string>

namespace margelo::nitro::pdfjsi {

PdfCacheInfo cacheStore(const std::string& base64, const std::string& identifier);
std::string cachePath(const std::string& identifier);
bool cacheRemove(const std::string& identifier);
bool cacheClear();
double cacheClearExpired();
PdfCacheStats cacheStats();

} // namespace margelo::nitro::pdfjsi
