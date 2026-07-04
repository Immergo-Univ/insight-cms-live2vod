#!/usr/bin/env bash
#
# Build (optional) and (re)launch the insight-ad-recognition container.
#
# Behavior:
#   - If the container is already running/exists, it is stopped and removed first
#     so only the newest instance remains.
#   - The image is built automatically the first time (when it does not exist yet).
#   - Pass --build to force a rebuild of the image before launching.
#
# Usage:
#   ./run.sh [--build] [-- <extra docker run args>]
#
# Env overrides:
#   IMAGE_NAME      (default: insight-ad-recognition)
#   CONTAINER_NAME  (default: insight-ad-recognition)
#   HOST_PORT       (default: 8081)
#   API_SECRET      (default: change-me)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

IMAGE_NAME="${IMAGE_NAME:-insight-ad-recognition}"
CONTAINER_NAME="${CONTAINER_NAME:-insight-ad-recognition}"
HOST_PORT="${HOST_PORT:-8081}"
API_SECRET="${API_SECRET:-change-me}"

FORCE_BUILD=false
EXTRA_ARGS=()

# --- Parse arguments --------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build)
      FORCE_BUILD=true
      shift
      ;;
    --)
      shift
      EXTRA_ARGS=("$@")
      break
      ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: ./run.sh [--build] [-- <extra docker run args>]" >&2
      exit 1
      ;;
  esac
done

# --- Pick docker CLI --------------------------------------------------------------------------
if command -v docker >/dev/null 2>&1; then
  DOCKER="docker"
elif command -v podman >/dev/null 2>&1; then
  DOCKER="podman"
else
  echo "ERROR: neither 'docker' nor 'podman' found in PATH." >&2
  exit 1
fi

cd "$SCRIPT_DIR"

# --- Stop & remove any previous container -----------------------------------------------------
if $DOCKER ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo ">> Stopping and removing existing container '$CONTAINER_NAME'..."
  $DOCKER rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
fi

# --- Build image if needed --------------------------------------------------------------------
image_exists() {
  $DOCKER image inspect "$IMAGE_NAME" >/dev/null 2>&1
}

if $FORCE_BUILD; then
  echo ">> Building image '$IMAGE_NAME' (forced with --build)..."
  $DOCKER build -t "$IMAGE_NAME" .
elif ! image_exists; then
  echo ">> Image '$IMAGE_NAME' not found; building for the first time..."
  $DOCKER build -t "$IMAGE_NAME" .
else
  echo ">> Reusing existing image '$IMAGE_NAME' (pass --build to rebuild)."
fi

# --- Launch newest container ------------------------------------------------------------------
echo ">> Starting container '$CONTAINER_NAME' on host port $HOST_PORT..."
$DOCKER run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -p "${HOST_PORT}:8081" \
  -e "API_SECRET=${API_SECRET}" \
  "${EXTRA_ARGS[@]}" \
  "$IMAGE_NAME" >/dev/null

echo ">> Done."
echo "   Container : $CONTAINER_NAME"
echo "   Image     : $IMAGE_NAME"
echo "   Health    : http://localhost:${HOST_PORT}/health"
echo "   Detect    : http://localhost:${HOST_PORT}/detect?video=<url>&secret=${API_SECRET}"
echo "   Logs      : $DOCKER logs -f $CONTAINER_NAME"
