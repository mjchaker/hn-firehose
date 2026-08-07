#!/bin/bash
# Packages dist/HN Firehose.app into a shareable DMG with a drag-to-Applications layout.
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
DIST="$ROOT/dist"
APP="$DIST/HN Firehose.app"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null || echo 1.0)"
DMG="$DIST/HN-Firehose-$VERSION.dmg"

# Always package a fresh build.
./build.sh

echo "==> Staging DMG contents"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

echo "==> Creating DMG"
rm -f "$DMG"
hdiutil create \
  -volname "HN Firehose" \
  -srcfolder "$STAGE" \
  -fs HFS+ \
  -format UDZO \
  -quiet \
  "$DMG"

echo "==> Done: $DMG"
du -h "$DMG" | cut -f1
