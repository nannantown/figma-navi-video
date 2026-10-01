#!/bin/bash
# AI Ground — the official profile picture (2026-10-01): the face of "May, the senpai" (A).
# The artwork is Codex's (../may-2026-09-30/a-senpai/codex-profile.png, untouched).
# This only crops, resizes and checks it:
#   profile-icon.png  1100x1100 square around the face, resized to 1024x1024 (upload-ready)
#   crop-check.png    the Codex original with the crop square and the circle IG/YouTube cut out
#   preview.png       circle crop at 320px / 120px (= a 40pt avatar on a 3x phone) / real 40px / 40px zoomed x5,
#                     light screen over dark screen
# Needs ImageMagick 7 (magick). Run from anywhere.
set -euo pipefail
cd "$(dirname "$0")"
SRC=../may-2026-09-30/a-senpai/codex-profile.png   # 1254x1254
CROP=1100x1100+77+0                                # face bigger at 40px; whole head and earring stay inside the circle
FONT="/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"   # gothic (no mincho)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

magick "$SRC" -crop "$CROP" +repage -resize 1024x1024 -strip profile-icon.png

# Where the circle falls on the original (crop square = orange, circle = cyan).
magick "$SRC" -fill none -strokewidth 8 -stroke '#FF6B35' -draw "rectangle 77,0 1176,1099" \
  -stroke '#00B4D8' -draw "circle 627,550 627,0" -resize 600x600 crop-check.png

circle() { # src size out
  magick "$1" -resize "$2x$2" \( -size "$2x$2" xc:black -fill white -draw "circle $(( $2/2 )),$(( $2/2 )) $(( $2/2 )),0" \) \
    -alpha off -compose CopyOpacity -composite "$3"
}
circle profile-icon.png 320 "$tmp/320.png"
circle profile-icon.png 120 "$tmp/120.png"
circle profile-icon.png 40 "$tmp/40.png"
magick "$tmp/40.png" -filter point -resize 200x200 "$tmp/40z.png"
for bg in white '#141414'; do
  fg=$([ "$bg" = white ] && echo '#333' || echo '#ddd')
  magick -size 920x400 "xc:$bg" \
    "$tmp/320.png" -geometry +30+30 -composite \
    "$tmp/120.png" -geometry +390+130 -composite \
    "$tmp/40.png" -geometry +560+170 -composite \
    "$tmp/40z.png" -geometry +660+90 -composite \
    -font "$FONT" -pointsize 16 -fill "$fg" \
    -annotate +126+380 "丸く切った見え方" -annotate +392+282 "スマホの細かさ" \
    -annotate +548+232 "実寸 40px" -annotate +680+312 "40px を 5 倍に拡大" \
    "$tmp/p-$([ "$bg" = white ] && echo l || echo d).png"
done
magick "$tmp/p-l.png" "$tmp/p-d.png" -append -depth 8 preview.png
echo "rendered: profile-icon.png crop-check.png preview.png"
