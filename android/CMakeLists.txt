cmake_minimum_required(VERSION 3.13)

project(react-native-pdf-jsi)

# Existing JNI library (C++17). Nitro is a separate target so its JNI_OnLoad
# does not replace the pdfjsi JNI exports.
add_subdirectory(src/main/cpp)

if(BUILD_NITRO_PDF_JSI)
    add_library(NitroPdfJsi SHARED
        src/main/cpp/cpp-adapter.cpp
        src/main/cpp/PDFJSIPlatform.cpp
        ../cpp/HybridPDFJSI.cpp
    )

    set_target_properties(NitroPdfJsi PROPERTIES
        CXX_STANDARD 20
        CXX_STANDARD_REQUIRED ON
    )

    target_include_directories(NitroPdfJsi PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/../cpp
        ${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp
    )

    target_link_options(NitroPdfJsi PRIVATE "-Wl,-z,max-page-size=16384")

    include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/NitroPdfJsi+autolinking.cmake)
endif()
