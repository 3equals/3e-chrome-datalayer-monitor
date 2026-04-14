#!/usr/bin/env bash
set -euo pipefail

VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*"\([0-9.]*\)".*/\1/')
OUT="datalayer-monitor-v${VERSION}.zip"

rm -f "$OUT"
zip -r "$OUT" manifest.json icons/ src/

echo "Built: $OUT ($(du -sh "$OUT" | cut -f1))"
