#!/usr/bin/env bash
# Removes logo live-matching state JSON and all logo-detector-features output artifacts.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

DATA_DIR="${BACKEND_ROOT}/data"
FEATURES_OUTPUT="${SCRIPT_DIR}/logo-detector-features/output"

rm -f "${DATA_DIR}/logo-live-matching-state.json"

if [[ -d "${FEATURES_OUTPUT}" ]]; then
  # Remove all generated files (JSON, images, debug, etc.)
  find "${FEATURES_OUTPUT}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
fi

echo "Done: removed logo-live-matching-state.json and logo-detector-features/output contents."
