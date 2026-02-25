#!/usr/bin/env bash
set -euo pipefail

UTIL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$UTIL_DIR/build_ads_detector.sh"

BIN="$UTIL_DIR/bin/ads_detector"
M3U8_URL="https://ch14channel14.encoders.immergo.tv/app/2/streamPlaylist.m3u8?startTime=1771909800&endTime=1771918200"
OUT_JSON="$UTIL_DIR/ads_detector_test_output.json"

"$BIN" --m3u8 "$M3U8_URL" --tr --output "$OUT_JSON" --debug

echo "Test output written to: $OUT_JSON"

