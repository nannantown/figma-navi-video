#!/bin/bash
# AIの手習い — the adopted profile icon (Codex reference traced to vector, 2026-09-30).
# profile-icon.svg -> profile-icon.png (1024x1024)
#                  -> preview.png  (circle crop at 320px / real 40px / 40px zoomed x5, on light and dark)
#                  -> compare.png  (Codex reference | this SVG | differing pixels in red)
# Needs rsvg-convert and ImageMagick 7 (magick). Run from anywhere.
set -euo pipefail
cd "$(dirname "$0")"
REF=../ai-2026-09-30b/b-tenarai/codex-reference.png
FONT=.Hiragino-Kaku-Gothic-Interface-W6   # gothic (no mincho)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

rsvg-convert -w 1024 -h 1024 profile-icon.svg -o profile-icon.png

circle() { # src size out
  magick "$1" -resize "$2x$2" \( -size "$2x$2" xc:black -fill white -draw "circle $(( $2/2 )),$(( $2/2 )) $(( $2/2 )),0" \) \
    -alpha off -compose CopyOpacity -composite "$3"
}
circle profile-icon.png 320 "$tmp/320.png"
circle profile-icon.png 40 "$tmp/40.png"
magick "$tmp/40.png" -filter point -resize 200x200 "$tmp/40z.png"
for bg in white '#141414'; do
  magick -size 760x380 "xc:$bg" \
    "$tmp/320.png" -geometry +30+30 -composite \
    "$tmp/40.png" -geometry +400+170 -composite \
    "$tmp/40z.png" -geometry +500+90 -composite "$tmp/p-$([ "$bg" = white ] && echo l || echo d).png"
done
magick "$tmp/p-l.png" "$tmp/p-d.png" -append -depth 8 preview.png

# Same pixel grid as the reference (1254) so the two can be compared pixel by pixel.
rsvg-convert -w 1254 -h 1254 profile-icon.svg -o "$tmp/svg1254.png"
magick "$REF" -alpha off "$tmp/ref.png"
magick "$tmp/svg1254.png" -alpha off "$tmp/new.png"
ae=$(magick compare -metric AE -fuzz 30% "$tmp/ref.png" "$tmp/new.png" "$tmp/diff.png" 2>&1 >/dev/null || true)
ae=${ae%% *}
ink=$(magick "$tmp/ref.png" -colorspace gray -threshold 55% -negate -format '%[fx:round(mean*w*h)]' info:)
pct=$(awk -v a="$ae" -v b="$ink" 'BEGIN{printf "%.1f", 100*a/b}')
panel() { # src label out
  magick "$1" -resize 400x400 -background white -fill '#222' -font "$FONT" -pointsize 20 \
    label:"$2" -gravity center -append -bordercolor white -border 12 "$3"
}
panel "$tmp/ref.png" "Codex の参考画像（元）" "$tmp/c1.png"
panel "$tmp/new.png" "清書した SVG（正式）" "$tmp/c2.png"
panel "$tmp/diff.png" "違う画素（赤。縁に細く出るだけ）" "$tmp/c3.png"
magick "$tmp/c1.png" "$tmp/c2.png" "$tmp/c3.png" +append \
  \( -background white -fill '#444' -font "$FONT" -pointsize 18 \
     label:"違う画素 ${ae} 個 = 黒い字の面積の ${pct}%（字の縁の線だけ。形・位置・色は元のまま）" \) \
  -gravity center -append -bordercolor white -border 8 -depth 8 compare.png
echo "rendered: profile-icon.png preview.png compare.png (diff ${ae}px = ${pct}% of ink)"
