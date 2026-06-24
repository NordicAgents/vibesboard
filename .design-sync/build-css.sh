#!/usr/bin/env sh
# Compile the design system's Tailwind stylesheet for /design-sync.
# Output: apps/web/.ds-tw.css  (referenced as cfg.cssEntry, bounded to apps/web).
# It contains: a remote @import for the brand Google fonts (Manrope + Roboto
# Mono, what next/font serves at runtime), :root font-var definitions, then the
# full compiled Tailwind output (preflight + utilities + the globals.css tokens).
# Run from the repo root (the wrapper config's content globs are root-relative).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="apps/web/.ds-tw.css"
RAW="apps/web/.ds-tw.css.raw"

TW="./node_modules/.bin/tailwindcss"
[ -x "$TW" ] || TW="$(command -v tailwindcss)"

"$TW" -c .design-sync/tw.config.cjs -i apps/web/app/globals.css -o "$RAW"

{
  printf "%s\n" "@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Roboto+Mono:wght@400;500;600;700&display=swap');"
  printf "%s\n" ":root{--font-sans:'Manrope',ui-sans-serif,system-ui,-apple-system,sans-serif;--font-mono:'Roboto Mono',ui-monospace,SFMono-Regular,Menlo,monospace;}"
  cat "$RAW"
} > "$OUT"
rm -f "$RAW"

echo "wrote $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
