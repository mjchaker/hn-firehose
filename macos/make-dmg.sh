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
# hdiutil occasionally fails with "Resource busy" while the staging volume is
# still being indexed (common on CI runners); retry a few times before giving up.
for attempt in 1 2 3 4 5; do
  if hdiutil create \
      -volname "HN Firehose" \
      -srcfolder "$STAGE" \
      -fs HFS+ \
      -format UDZO \
      -ov \
      "$DMG"; then
    break
  fi
  if [ "$attempt" -eq 5 ]; then
    echo "hdiutil create failed after $attempt attempts" >&2
    exit 1
  fi
  echo "hdiutil create failed (attempt $attempt), retrying…" >&2
  sleep 3
done

echo "==> Done: $DMG"
du -h "$DMG" | cut -f1
