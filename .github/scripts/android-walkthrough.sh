#!/usr/bin/env bash
# Run by .github/workflows/android-e2e.yml inside a booted emulator: installs the release APK and
# walks through Katkee with Maestro. "tablet" runs it held sideways. Results go to android-e2e/<size>.
set -u
SIZE="$1"
# smoke: every main screen. tour: every feature, with a second account to chat with (tour.yaml).
FLOW="${2:-smoke}"
OUT="$GITHUB_WORKSPACE/android-e2e/$([ "$FLOW" = tour ] && echo tour || echo "$SIZE")"
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
EXTRA=()
if [ "$FLOW" = tour ]; then
  # The tour's photo, in the gallery the photo picker shows.
  adb push "$GITHUB_WORKSPACE/mobile/.maestro/assets/tour-photo.jpg" /sdcard/Pictures/tour-photo.jpg > /dev/null
  adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/tour-photo.jpg > /dev/null
  # A second account to find, follow and chat with, verified the same way as the first.
  P_PASSWORD="E2e-$(openssl rand -hex 8)"; P_USERNAME="e2e_and_${RUN}_partner"; P_EMAIL="support+e2e-and-${RUN}-partner@katkee.com"
  echo "$P_USERNAME $P_EMAIL $P_PASSWORD" >> "$RUNNER_TEMP/accounts"
  API=https://api.katkee.com
  curl -s -o /dev/null -w "partner signup: %{http_code}\n" -X POST $API/api/v1/auth/signup -H 'Content-Type: application/json' \
    -d "{\"displayName\":\"Katkee Partner\",\"username\":\"$P_USERNAME\",\"email\":\"$P_EMAIL\",\"birthDate\":\"1994-05-05\",\"password\":\"$P_PASSWORD\"}"
  P_TOKEN=$(curl -s -X POST $API/api/v1/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$P_EMAIL\",\"password\":\"$P_PASSWORD\"}" | jq -r '.tokens.accessToken // empty')
  OIDC=$(curl -s "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=katkee-e2e" -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" | jq -r .value)
  curl -s -o /dev/null -w "partner verified: %{http_code}\n" -X POST $API/api/v1/auth/email/ci-verify -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $P_TOKEN" -d "{\"token\":\"$OIDC\"}"
  EXTRA=(-e PARTNER_USERNAME="$P_USERNAME" -e PARTNER_EMAIL="$P_EMAIL" -e PARTNER_PASSWORD="$P_PASSWORD")
fi
status=0
( cd "$OUT" && maestro test "$GITHUB_WORKSPACE/mobile/.maestro/$FLOW.yaml" "${EXTRA[@]}" \
    -e USERNAME="$USERNAME" -e EMAIL="$EMAIL" -e PASSWORD="$PASSWORD" \
    -e OIDC_URL="$ACTIONS_ID_TOKEN_REQUEST_URL" -e OIDC_TOKEN="$ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
    --format junit --output "$OUT/report.xml" --test-output-dir "$OUT/maestro" ) || status=1

kill -INT "$REC" 2>/dev/null; sleep 3
adb pull /sdcard/walkthrough.mp4 "$OUT/walkthrough.mp4" > /dev/null 2>&1 || true
kill "$LOGCAT" 2>/dev/null
# Crashes (including a class R8 removed) show up as FATAL EXCEPTION in the log.
grep -A 30 "FATAL EXCEPTION\|AndroidRuntime" "$OUT/logcat.txt" > "$OUT/crashes.txt" || true
exit $status
