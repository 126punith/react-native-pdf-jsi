#include <jni.h>
#include <fbjni/fbjni.h>
#include "NitroPdfJsiOnLoad.hpp"
#include "PdfiumSession.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
    return facebook::jni::initialize(vm, []() {
        margelo::nitro::pdfjsi::pdfiumInit();
        margelo::nitro::pdfjsi::registerAllNatives();
    });
}
