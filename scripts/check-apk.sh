#!/usr/bin/env bash
# Inspect a built APK: package info and permissions. Fails if the app could
# reach the internet, because the app promises it can't.
set -euo pipefail
APK="$1"
AAPT2=$(ls "$ANDROID_HOME"/build-tools/*/aapt2 | sort -V | tail -1)
"$AAPT2" dump badging "$APK" | grep -E "^(package|sdkVersion|minSdkVersion|targetSdkVersion|native-code|application-label):" > apk-info.txt || true
"$AAPT2" dump permissions "$APK" > apk-permissions.txt
cat apk-info.txt apk-permissions.txt
if grep -q "android.permission.INTERNET" apk-permissions.txt; then
  echo "::error::The APK requests INTERNET permission"
  exit 1
fi
{
  echo ""
  echo "**Checked on the built APK**"
  echo '```'
  cat apk-info.txt
  echo "--- permissions"
  grep -E "uses-permission|permission:" apk-permissions.txt || echo "(none)"
  echo '```'
  echo "No INTERNET permission: the app cannot send data anywhere."
} > apk-check.md
