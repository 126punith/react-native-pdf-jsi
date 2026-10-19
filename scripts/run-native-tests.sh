#!/bin/bash
# Builds android/src/test/cpp/PdfiumSessionTest.cpp with the NDK and runs it on
# the connected device or emulator (adb). Needs node_modules (Nitro headers).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
NDK="${ANDROID_NDK_HOME:-$(ls -d "$SDK"/ndk/* | sort -V | tail -1)}"
HOST="$(ls "$NDK/toolchains/llvm/prebuilt" | head -1)"
ADB="$SDK/platform-tools/adb"
ABI="$("$ADB" shell getprop ro.product.cpu.abi | tr -d '\r')"
case "$ABI" in
  arm64-v8a) TARGET=aarch64-linux-android24 ;;
  x86_64) TARGET=x86_64-linux-android24 ;;
  *) echo "Unsupported ABI $ABI"; exit 1 ;;
esac

BUILD="$ROOT/android/build/native-tests"
mkdir -p "$BUILD/include/NitroModules"
NITRO="$ROOT/node_modules/react-native-nitro-modules/cpp"
find "$NITRO" -name '*.hpp' -exec cp {} "$BUILD/include/NitroModules/" \;

cd "$ROOT"
"$NDK/toolchains/llvm/prebuilt/$HOST/bin/clang++" --target="$TARGET" -std=c++20 -O1 -fPIE -pie \
  -Iandroid/src/main/cpp -Iandroid/third_party/pdfium/include -Iandroid/third_party/stb \
  -Initrogen/generated/shared/c++ -I"$BUILD/include" \
  -Inode_modules/react-native/ReactCommon/jsi -Inode_modules/react-native/ReactCommon/callinvoker \
  -Inode_modules/react-native/ReactCommon \
  android/src/main/cpp/PdfiumSession.cpp android/src/test/cpp/PdfiumSessionTest.cpp \
  -Landroid/third_party/pdfium/lib/"$ABI" -lpdfn -static-libstdc++ \
  -o "$BUILD/pdfium-session-test"

python3 scripts/make-fixtures.py "$BUILD/fixtures" >/dev/null
REMOTE=/data/local/tmp/pdf-jsi-tests
"$ADB" shell rm -rf "$REMOTE"
"$ADB" shell mkdir -p "$REMOTE"
"$ADB" push "$BUILD/pdfium-session-test" "android/third_party/pdfium/lib/$ABI/libpdfn.so" "$REMOTE/" >/dev/null
"$ADB" push "$BUILD/fixtures/." "$REMOTE/" >/dev/null
"$ADB" shell "cd $REMOTE && chmod +x pdfium-session-test && LD_LIBRARY_PATH=. ./pdfium-session-test $REMOTE"
