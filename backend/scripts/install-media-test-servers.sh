#!/usr/bin/env sh
# Builds the local servers the media integration tests run against (pinned, from source):
#   - Versity S3 gateway v1.8.0 (Apache-2.0): an S3 API that verifies AWS SigV4
#     signatures, signed headers and expiry like Amazon S3 (test/mediaS3.test.ts).
#   - goaws v0.5.4 (MIT): an SQS-compatible server (test/mediaQueue.test.ts).
# Needs Go 1.22+. Default destination /opt/s3test; tests read VERSITYGW_BIN and GOAWS_BIN.
# Without these binaries the S3/SQS suites are reported as skipped, never as passed.
set -eu
DEST="${1:-/opt/s3test}"
mkdir -p "$DEST"
GOBIN="$DEST" go install github.com/versity/versitygw/cmd/versitygw@v1.8.0
GOBIN="$DEST" go install github.com/Admiral-Piett/goaws/app/cmd@v0.5.4
mv -f "$DEST/cmd" "$DEST/goaws"
"$DEST/versitygw" --version | head -1
echo "Installed versitygw and goaws to $DEST"
