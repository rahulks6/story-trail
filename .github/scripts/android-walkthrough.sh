#!/usr/bin/env bash
# Run by .github/workflows/android-e2e.yml inside a booted emulator: installs the release APK and
# walks through Katkee with Maestro. "tablet" runs it held sideways. Results go to android-e2e/<size>.
set -u
SIZE="$1"
# smoke: every main screen. tour: every feature, with a second account to chat with (tour.yaml).
# store: the Google Play screenshots, from demo accounts (store.yaml, store-seed.mjs).
FLOW="${2:-smoke}"
OUT="$GITHUB_WORKSPACE/android-e2e/$(case "$FLOW" in tour) echo tour ;; store) echo "store-$SIZE" ;; *) echo "$SIZE" ;; esac)"
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
if [ "$FLOW" = videotext ]; then
  # A short moving test video, in the gallery the photo picker shows.
  adb push "$GITHUB_WORKSPACE/mobile/.maestro/assets/tour-video.mp4" /sdcard/Movies/tour-video.mp4 > /dev/null
  adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Movies/tour-video.mp4 > /dev/null
fi
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
if [ "$FLOW" = store ]; then
  # The Play Store screenshots (mobile/.maestro/store.yaml). Photos from Unsplash (free to use
  # commercially, no attribution needed; scenery and food, no faces), by photo id, for what
  # Katkee's own photos don't cover.
  PHOTOS="$OUT/photos"; mkdir -p "$PHOTOS"
  get() { # name, Unsplash photo id, width, height
    curl -sfL -m 30 -o "$PHOTOS/$1.jpg" "https://images.unsplash.com/photo-$2?w=$3&h=$4&fit=crop&crop=entropy&fm=jpg&q=82" || true
  }
  get story-city 1477959858617-67f85cf4f1df 1080 1920
  get story-coffee 1495474472287-4d71bcdd2085 1080 1920
  get story-food 1565299624946-b28f40a0ca4b 1080 1920
  get cover-maya 1501785888041-af3ef285b470 1080 600
  get avatar-maya 1490750967868-88aa4486c946 400 400
  get avatar-arjun 1519681393784-d120267933ba 400 400
  get avatar-sofia 1504674900247-0877df9cc836 400 400
  get avatar-leo 1543466835-00a7907e9de1 400 400
  get avatar-zara 1514888286974-6c03e2ca1dba 400 400
  get avatar-kenji 1477959858617-67f85cf4f1df 400 400
  get gallery-1 1470071459604-3b5ec3a7fe05 1080 1920
  get gallery-2 1441974231531-c6227db76b6e 1080 1920
  # Katkee's own photos (brand/store/photos): most of the Stories, and the Story editor's photo.
  cp "$GITHUB_WORKSPACE"/brand/store/photos/*.jpg "$PHOTOS/"
  # A photo id that no longer exists: use one that downloaded, so the run still goes on.
  SPARE=$(find "$PHOTOS" -name '*.jpg' -size +20k | head -1)
  for f in story-street story-sunset story-lake story-city story-coffee story-beach story-food story-palms cover-maya avatar-maya avatar-arjun avatar-sofia avatar-leo avatar-zara avatar-kenji gallery-1 gallery-2; do
    if [ ! -s "$PHOTOS/$f.jpg" ] || [ "$(stat -c %s "$PHOTOS/$f.jpg")" -lt 20000 ]; then echo "photo missing: $f"; cp "$SPARE" "$PHOTOS/$f.jpg"; fi
  done
  # The gallery the Story editor and Layout pick from, newest last pushed.
  for f in gallery-2 gallery-1 story-beach story-lake story-palms story-street; do
    adb push "$PHOTOS/$f.jpg" "/sdcard/Pictures/$f.jpg" > /dev/null
    adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file:///sdcard/Pictures/$f.jpg" > /dev/null
    sleep 1
  done
  node "$GITHUB_WORKSPACE/.github/scripts/store-seed.mjs" "$PHOTOS" "$RUNNER_TEMP/accounts" "$PASSWORD" || exit 1
  EMAIL="support+e2e-store-${RUN}-maya@katkee.com"
  # A clean status bar: 9:41, full battery and signal, no notifications.
  adb shell settings put global sysui_demo_allowed 1
  adb shell am broadcast -a com.android.systemui.demo -e command enter > /dev/null
  adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941 > /dev/null
  adb shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false > /dev/null
  adb shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 > /dev/null
  adb shell am broadcast -a com.android.systemui.demo -e command network -e mobile show -e datatype none -e level 4 > /dev/null
  adb shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false > /dev/null
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
