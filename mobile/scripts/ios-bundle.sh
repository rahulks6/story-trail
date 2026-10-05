#!/bin/sh
set -e
# Run through React Native's with-environment.sh so NODE_BINARY is resolved.
if [ "$CONFIGURATION" = "Release" ]; then
  "$NODE_BINARY" "$PROJECT_DIR/../scripts/check-release.cjs" --ios
fi
/bin/sh "$REACT_NATIVE_PATH/scripts/react-native-xcode.sh"
