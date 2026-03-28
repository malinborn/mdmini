#!/usr/bin/env bash
set -euo pipefail

APP_NAME="md-mini"
APP_BUNDLE="/Applications/${APP_NAME}.app"
SYMLINK="/usr/local/bin/mdmini"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Building ${APP_NAME}..."
cd "$PROJECT_DIR"
npm run tauri build

# Find the built .app bundle
BUILD_APP=$(find "$PROJECT_DIR/src-tauri/target/release/bundle/macos" -name "*.app" -maxdepth 1 | head -1)

if [ -z "$BUILD_APP" ]; then
  echo "ERROR: Build artifact not found in src-tauri/target/release/bundle/macos/"
  exit 1
fi

echo "==> Installing to /Applications..."
if [ -d "$APP_BUNDLE" ]; then
  rm -rf "$APP_BUNDLE"
fi
cp -R "$BUILD_APP" "$APP_BUNDLE"

echo "==> Installing CLI wrapper: ${SYMLINK}"
sudo cp "${PROJECT_DIR}/scripts/mdmini" "$SYMLINK"
sudo chmod +x "$SYMLINK"

echo "==> Done! Run: mdmini [file.md]"
