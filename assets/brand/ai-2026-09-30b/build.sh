#!/bin/bash
# Re-render the 2026-09-30b icon options: profile-icon.svg -> profile-icon.png (1024),
# preview.png (circle crop at 320px / real 40px / 40px zoomed x5, on light and dark),
# and overview-40px.png (all options at 40px, light and dark).
# Needs rsvg-convert and ImageMagick 7 (magick). Run from anywhere.
set -euo pipefail
cd "$(dirname "$0")"
OPTS=(a-shihou b-tenarai c-enshu d-shishoku)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

circle() { # src size out
  magick "$1" -resize "$2x$2" \( -size "$2x$2" xc:black -fill white -draw "circle $(( $2/2 )),$(( $2/2 )) $(( $2/2 )),0" \) \
    -alpha off -compose CopyOpacity -composite "$3"
}

for o in "${OPTS[@]}"; do
  rsvg-convert -w 1024 -h 1024 "$o/profile-icon.svg" -o "$o/profile-icon.png"
  circle "$o/profile-icon.png" 320 "$tmp/$o-320.png"
  circle "$o/profile-icon.png" 40 "$tmp/$o-40.png"
  magick "$tmp/$o-40.png" -filter point -resize 200x200 "$tmp/$o-40z.png"
  for bg in white '#141414'; do
    magick -size 760x380 "xc:$bg" \
      "$tmp/$o-320.png" -geometry +30+30 -composite \
      "$tmp/$o-40.png" -geometry +400+170 -composite \
      "$tmp/$o-40z.png" -geometry +500+90 -composite "$tmp/$o-$([ "$bg" = white ] && echo l || echo d).png"
  done
  magick "$tmp/$o-l.png" "$tmp/$o-d.png" -append "$o/preview.png"
done

row() { # bg out
  local args=(-size 280x100 "xc:$1")
  local x=30
  for o in "${OPTS[@]}"; do args+=("$tmp/$o-40.png" -geometry "+$x+30" -composite); x=$((x + 60)); done
  magick "${args[@]}" "$2"
}
row white "$tmp/row-l.png"; row '#141414' "$tmp/row-d.png"
magick "$tmp/row-l.png" "$tmp/row-d.png" -append overview-40px.png
echo "rendered: ${OPTS[*]}"
