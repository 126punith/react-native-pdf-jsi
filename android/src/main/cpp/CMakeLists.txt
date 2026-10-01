# Copyright (c) 2025-present, Punith M (punithm300@gmail.com)
# Enhanced PDF JSI CMakeLists with high-performance operations
# All rights reserved.
# 
# CMake configuration for PDF JSI native module

cmake_minimum_required(VERSION 3.13)

# Set project name
project(pdfjsi)

# Set C++ standard
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Set React Native directory from environment variable
if(NOT DEFINED REACT_ANDROID_DIR)
    set(REACT_ANDROID_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../../react-native/ReactAndroid")
endif()

# Include directories
include_directories(
    ${REACT_ANDROID_DIR}/ReactCommon
    ${REACT_ANDROID_DIR}/ReactCommon/jsi
    ${REACT_ANDROID_DIR}/ReactCommon/callinvoker
    ${REACT_ANDROID_DIR}/ReactAndroid/src/main/jni/react/jni
    ${REACT_ANDROID_DIR}/ReactAndroid/src/main/jni/first-party/fbjni/headers
    ${CMAKE_CURRENT_SOURCE_DIR}
)

# Source files
set(SOURCES
    PDFJSI.cpp
    PDFJSIBridge.cpp
)

# Create shared library
add_library(
    pdfjsi
    SHARED
    ${SOURCES}
)

# Link libraries - simplified for compatibility
target_link_libraries(
    pdfjsi
    log
    android
)

# Compiler flags
target_compile_definitions(
    pdfjsi
    PRIVATE
    -DANDROID
    -DPDFJSI_VERSION="2.0.0"
    -DANDROID_PAGE_SIZE_AGNOSTIC=ON
    -DANDROID_16KB_PAGES=ON
)

# Optimization flags - Enhanced for maximum performance
target_compile_options(
    pdfjsi
    PRIVATE
    -O3                      # Maximum optimization
    -ffast-math             # Fast floating-point operations
    -funroll-loops          # Loop unrolling
    -fomit-frame-pointer    # Remove frame pointer
    -fvisibility=hidden     # Hide symbols by default
    -flto                   # Link-time optimization
    -finline-functions      # Aggressive inlining
    -fno-exceptions         # Disable exceptions (if not needed)
    -fno-rtti              # Disable RTTI (if not needed)
)

# Architecture-specific optimizations (conditional to prevent ARMv7 build errors)
if(ANDROID_ABI STREQUAL "arm64-v8a")
    target_compile_options(
        pdfjsi
        PRIVATE
        -march=armv8-a+simd    # ARM SIMD instructions (ARMv8 only)
    )
endif()

# 16KB page size alignment for shared objects
set(CMAKE_SHARED_LINKER_FLAGS "${CMAKE_SHARED_LINKER_FLAGS} -Wl,-z,max-page-size=16384")
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -Wl,-z,max-page-size=16384")