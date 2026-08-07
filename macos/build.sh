#!/bin/bash
# Builds dist/HN Firehose.app — a native WKWebView wrapper around the site.
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
DIST="$ROOT/dist"
APP="$DIST/HN Firehose.app"
CONTENTS="$APP/Contents"

echo "==> Cleaning"
rm -rf "$APP"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources/web"

echo "==> Copying web assets"
cp "$ROOT/index.html" "$ROOT/style.css" "$ROOT/app.js" "$CONTENTS/Resources/web/"

echo "==> Writing Info.plist"
cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>              <string>HN Firehose</string>
  <key>CFBundleDisplayName</key>       <string>HN Firehose</string>
  <key>CFBundleIdentifier</key>        <string>dev.mchaker.hnfirehose</string>
  <key>CFBundleVersion</key>           <string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleExecutable</key>        <string>HN Firehose</string>
  <key>CFBundlePackageType</key>       <string>APPL</string>
  <key>CFBundleIconFile</key>          <string>AppIcon</string>
  <key>LSMinimumSystemVersion</key>    <string>12.0</string>
  <key>NSHighResolutionCapable</key>   <true/>
  <key>NSPrincipalClass</key>          <string>NSApplication</string>
</dict>
</plist>
PLIST

echo "==> Rendering icon"
ICON_TMP="$(mktemp -d)"
swift makeicon.swift "$ICON_TMP/appicon_1024.png" > /dev/null
ICONSET="$ICON_TMP/AppIcon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s       "$ICON_TMP/appicon_1024.png" --out "$ICONSET/icon_${s}x${s}.png"      > /dev/null
  sips -z $((s*2)) $((s*2)) "$ICON_TMP/appicon_1024.png" --out "$ICONSET/icon_${s}x${s}@2x.png" > /dev/null
done
iconutil -c icns "$ICONSET" -o "$CONTENTS/Resources/AppIcon.icns"
rm -rf "$ICON_TMP"

echo "==> Compiling"
swiftc -O -framework Cocoa -framework WebKit main.swift -o "$CONTENTS/MacOS/HN Firehose"

echo "==> Signing (ad-hoc)"
codesign --force -s - "$APP"

echo "==> Done: $APP"
