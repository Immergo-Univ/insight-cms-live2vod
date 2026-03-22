#!/usr/bin/env bash
# Run logo_detector.py with the project venv (avoids system python without deps).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="$ROOT/.venv/bin/python"

if [[ ! -x "$PY" ]]; then
  echo "error: $PY not found. Run first: $ROOT/setup-python-env.sh" >&2
  exit 1
fi

# Reduce TTY/display side effects from OpenCV-linked Qt and Python I/O on some terminals.
export QT_QPA_PLATFORM="${QT_QPA_PLATFORM:-offscreen}"
export PYTHONIOENCODING="${PYTHONIOENCODING:-utf-8}"

exec "$PY" "$ROOT/logo_detector.py" "$@"
