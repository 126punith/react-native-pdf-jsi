#!/bin/bash
# Packs android/third_party/pdfium/lib/<abi>/libpdfn.so into the zip that
# android/build.gradle downloads, and prints its SHA-256. Upload the zip to the
# GitHub Release named by PDFIUM_VERSION, then update pdfiumVersion and
# pdfiumSha256 in android/build.gradle.
#
#   ./scripts/package-pdfium.sh r1
set -euo pipefail

VERSION="${1:?usage: $0 <pdfium-version>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/android/third_party/pdfium"
OUT="$ROOT/android/build/pdfium-dist"
NAME="pdfium-android-$VERSION.zip"
ABIS=(arm64-v8a armeabi-v7a x86 x86_64)

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

for abi in "${ABIS[@]}"; do
  mkdir -p "$STAGE/lib/$abi"
  cp "$SRC/lib/$abi/libpdfn.so" "$STAGE/lib/$abi/"
done
cp "$SRC/LICENSE" "$STAGE/LICENSE"

# Fixed mtimes and sorted entries so the same inputs give the same checksum.
find "$STAGE" -exec touch -t 202001010000 {} +
mkdir -p "$OUT"
rm -f "$OUT/$NAME"
(cd "$STAGE" && find . -type f | sed 's|^\./||' | LC_ALL=C sort | zip -X -q "$OUT/$NAME" -@)

SHA="$(shasum -a 256 "$OUT/$NAME" | cut -d' ' -f1)"
echo "$SHA  $NAME" > "$OUT/$NAME.sha256"

echo "Wrote $OUT/$NAME"
echo "SHA-256: $SHA"
echo "Upload to: https://github.com/126punith/react-native-pdf-jsi/releases/tag/pdfium-android-$VERSION"
