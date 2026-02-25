#!/usr/bin/env bash
set -euo pipefail

UTIL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$UTIL_DIR/ads-detector"
OUT_DIR="$UTIL_DIR/bin"

mkdir -p "$OUT_DIR"

CXX="${CXX:-g++}"
CXXFLAGS="${CXXFLAGS:--O2 -std=c++17}"

if ! command -v "$CXX" >/dev/null 2>&1; then
  echo "Error: compiler not found: $CXX" >&2
  exit 1
fi

# Prefer pkg-config, but allow manual override for custom OpenCV installs:
#   OPENCV_CFLAGS="..." OPENCV_LIBS="..." bash build_ads_detector.sh
OPENCV_CFLAGS="${OPENCV_CFLAGS:-}"
OPENCV_LIBS="${OPENCV_LIBS:-}"

if [[ -z "$OPENCV_CFLAGS" || -z "$OPENCV_LIBS" ]]; then
  if ! command -v pkg-config >/dev/null 2>&1; then
    cat >&2 <<'EOF'
Error: pkg-config not found.

Install build dependencies (Ubuntu/Debian):
  sudo apt update
  sudo apt install -y pkg-config libopencv-dev libcurl4-openssl-dev

Or compile with a custom OpenCV install by setting:
  OPENCV_CFLAGS="..." OPENCV_LIBS="..."
EOF
    exit 1
  fi

  OPENCV_PKG=""
  if pkg-config --exists opencv4; then
    OPENCV_PKG="opencv4"
  elif pkg-config --exists opencv; then
    OPENCV_PKG="opencv"
  fi

  if [[ -z "$OPENCV_PKG" ]]; then
    cat >&2 <<'EOF'
Error: OpenCV pkg-config file not found (opencv4/opencv).

Install OpenCV dev package (Ubuntu/Debian):
  sudo apt update
  sudo apt install -y libopencv-dev
EOF
    exit 1
  fi

  OPENCV_CFLAGS="$(pkg-config --cflags "$OPENCV_PKG")"
  OPENCV_LIBS="$(pkg-config --libs "$OPENCV_PKG")"
fi

"$CXX" $CXXFLAGS \
  -o "$OUT_DIR/ads_detector" \
  "$SRC_DIR/main.cpp" \
  "$SRC_DIR/http.cpp" \
  "$SRC_DIR/m3u8.cpp" \
  "$SRC_DIR/logo_detector.cpp" \
  $OPENCV_CFLAGS \
  $OPENCV_LIBS \
  -lcurl

echo "Built: $OUT_DIR/ads_detector"

