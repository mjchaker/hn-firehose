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

# Strategy 1: one-shot from the staging folder. Retried because hdiutil
# occasionally reports "Resource busy" while the source is still being indexed.
create_from_folder() {
  local fs="$1" attempt
  for attempt in 1 2 3; do
    if hdiutil create -volname "HN Firehose" -srcfolder "$STAGE" -fs "$fs" -format UDZO -ov "$DMG"; then
      return 0
    fi
    echo "hdiutil create (-fs $fs) failed, attempt $attempt" >&2
    sleep 2
  done
  return 1
}

# Strategy 2: build a read-write image, mount it, copy the files in, then
# compress. Slower but avoids -srcfolder, which some CI runners reject.
create_by_mounting() {
  local rw="$STAGE.rw.dmg" mnt dev
  rm -f "$rw"
  hdiutil create -size 64m -fs HFS+ -volname "HN Firehose" -ov "$rw"
  mnt="$(mktemp -d)"
  dev="$(hdiutil attach -nobrowse -readwrite -mountpoint "$mnt" "$rw" | awk '/^\/dev\// {print $1; exit}')"
  cp -R "$APP" "$mnt/"
  ln -s /Applications "$mnt/Applications"
  sync
  hdiutil detach "$dev"
  hdiutil convert "$rw" -format UDZO -ov -o "$DMG"
  rm -f "$rw"
}

create_from_folder HFS+ || create_from_folder APFS || {
  echo "==> -srcfolder failed; building via a mounted image instead" >&2
  create_by_mounting
}

echo "==> Done: $DMG"
du -h "$DMG" | cut -f1
