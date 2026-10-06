cmake_minimum_required(VERSION 3.13)

# Pdfium and the Nitro hybrid are compiled by the parent NitroPdfJsi target
# in android/CMakeLists.txt. This directory no longer builds a separate JNI
# library.
project(pdfjsi-sources)
