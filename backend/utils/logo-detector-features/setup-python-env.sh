#!/usr/bin/env bash
# Creates a local virtualenv (PEP 668 safe) and installs requirements.txt.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 not found. Install python3 and python3-venv (e.g. apt install python3-venv)." >&2
  exit 1
fi

if [[ ! -d .venv ]]; then
  echo "Creating virtual environment at $ROOT/.venv ..."
  python3 -m venv .venv
fi

PIP="$ROOT/.venv/bin/pip"
PY="$ROOT/.venv/bin/python"

"$PY" -m pip install --upgrade pip
"$PIP" install -r "$ROOT/requirements.txt"

echo ""
echo "Done. Dependencies are installed in: $ROOT/.venv"
echo "Run:       $ROOT/run-logo-detector.sh <m3u8_url>"
echo "Or:        source $ROOT/.venv/bin/activate && python logo_detector.py <m3u8_url>"
