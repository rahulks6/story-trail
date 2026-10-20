#!/usr/bin/env bash
# Run by .github/workflows/android-e2e.yml inside a booted emulator: installs the release APK and
# walks through Katkee with Maestro. "tablet" runs it held sideways. Results go to android-e2e/<size>.
set -u
SIZE="$1"
OUT="$GITHUB_WORKSPACE/android-e2e/$SIZE"
mkdir -p "$OUT"
adb install -r "$GITHUB_WORKSPACE/katkee-release.apk"
adb shell wm size > "$OUT/device.txt"
adb shell wm density >> "$OUT/device.txt"
if [ "$SIZE" = tablet ]; then
  adb shell settings put system accelerometer_rotation 0
  # A Pixel Tablet's natural position is already landscape (rotation 0).
  adb shell settings put system user_rotation 0
  echo "landscape" >> "$OUT/device.txt"
fi
# A just-booted emulator's own launcher can stall ("isn't responding"); let it settle and close
# any system dialog so the walk-through starts on Katkee.
sleep 20
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS > /dev/null 2>&1 || true
adb logcat -c
adb logcat -v time > "$OUT/logcat.txt" &
LOGCAT=$!
adb shell screenrecord --time-limit 180 /sdcard/walkthrough.mp4 &
REC=$!

RUN="${GITHUB_RUN_ID: -6}"
PASSWORD="E2e-$(openssl rand -hex 8)"
USERNAME="e2e_and_${RUN}_${SIZE}"
EMAIL="support+e2e-and-${RUN}-${SIZE}@katkee.com"
echo "$USERNAME $EMAIL $PASSWORD" >> "$RUNNER_TEMP/accounts"
status=0
( cd "$OUT" && maestro test "$GITHUB_WORKSPACE/mobile/.maestro/smoke.yaml" \
    -e USERNAME="$USERNAME" -e EMAIL="$EMAIL" -e PASSWORD="$PASSWORD" \
    -e OIDC_URL="$ACTIONS_ID_TOKEN_REQUEST_URL" -e OIDC_TOKEN="$ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
    --format junit --output "$OUT/report.xml" --test-output-dir "$OUT/maestro" ) || status=1

kill -INT "$REC" 2>/dev/null; sleep 3
adb pull /sdcard/walkthrough.mp4 "$OUT/walkthrough.mp4" > /dev/null 2>&1 || true
kill "$LOGCAT" 2>/dev/null
# Crashes (including a class R8 removed) show up as FATAL EXCEPTION in the log.
grep -A 30 "FATAL EXCEPTION\|AndroidRuntime" "$OUT/logcat.txt" > "$OUT/crashes.txt" || true
exit $status
