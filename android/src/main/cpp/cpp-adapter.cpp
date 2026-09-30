#include <jni.h>
#include <fbjni/fbjni.h>
#include "NitroPdfJsiOnLoad.hpp"
#include "PDFJSIPlatform.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
    return facebook::jni::initialize(vm, []() {
        margelo::nitro::pdfjsi::cachePdfNitroOpsClass();
        margelo::nitro::pdfjsi::registerAllNatives();
    });
}
