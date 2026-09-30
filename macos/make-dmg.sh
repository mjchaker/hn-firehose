#!/bin/bash
# Packages dist/HN Firehose.app into a shareable DMG with a drag-to-Applications layout.
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
DIST="$ROOT/dist"
APP="$DIST/HN Firehose.app"

# Package a fresh build unless the caller already built (and possibly
# notarized) the app and just wants it wrapped: SKIP_BUILD=1 ./make-dmg.sh
if [ -z "${SKIP_BUILD:-}" ]; then
  ./build.sh
fi

# Read the version only after build.sh has written Info.plist: on a clean
# checkout PlistBuddy would otherwise print "File Doesn't Exist, Will Create:
# <path>" to stdout and that text would end up in the DMG filename.
VERSION="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$APP/Contents/Info.plist")"
DMG="$DIST/HN-Firehose-$VERSION.dmg"

echo "==> Staging DMG contents"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

echo "==> Creating DMG"
rm -f "$DMG"
# hdiutil occasionally reports "Resource busy" while the staging folder is
# still being indexed (seen on CI runners); retry a few times before giving up.
for attempt in 1 2 3; do
  if hdiutil create -volname "HN Firehose" -srcfolder "$STAGE" -fs HFS+ -format UDZO -ov "$DMG"; then
    break
  fi
  [ "$attempt" -eq 3 ] && { echo "hdiutil create failed after $attempt attempts" >&2; exit 1; }
  echo "hdiutil create failed (attempt $attempt), retrying…" >&2
  sleep 3
done

echo "==> Done: $DMG"
du -h "$DMG" | cut -f1
