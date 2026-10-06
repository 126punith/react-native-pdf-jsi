cmake_minimum_required(VERSION 3.13)

project(react-native-pdf-jsi)

set(PDFIUM_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/third_party/pdfium)
add_library(pdfium SHARED IMPORTED)
# pdfiumandroid already packages libpdfium.so for the Java viewer.
# This copy keeps a different SONAME so both can load in one process.
# libpdfn.so must not export _Unwind_*; those symbols belong to libc++_shared.
set_target_properties(pdfium PROPERTIES
    IMPORTED_LOCATION ${PDFIUM_ROOT}/lib/${ANDROID_ABI}/libpdfn.so
    INTERFACE_INCLUDE_DIRECTORIES ${PDFIUM_ROOT}/include
)

add_library(NitroPdfJsi SHARED
    src/main/cpp/cpp-adapter.cpp
    src/main/cpp/PdfiumSession.cpp
    src/main/cpp/HybridPdfLibrary.cpp
    src/main/cpp/HybridPdfDocument.cpp
    src/main/cpp/PdfDiskCache.cpp
)

set_target_properties(NitroPdfJsi PROPERTIES
    CXX_STANDARD 20
    CXX_STANDARD_REQUIRED ON
)

target_include_directories(NitroPdfJsi PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp
    ${PDFIUM_ROOT}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party/stb
)

target_link_options(NitroPdfJsi PRIVATE "-Wl,-z,max-page-size=16384")
target_link_libraries(NitroPdfJsi pdfium log)

include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/NitroPdfJsi+autolinking.cmake)
