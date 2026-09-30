#!/bin/bash
# Previews for the 2026-09-30 "May" avatar options. The artwork itself is Codex's
# (codex-*.png, untouched); this only resizes and crops it:
#   <opt>/profile-icon.png  codex-profile.png resized to 1024x1024 (upload-ready)
#   <opt>/preview.png       circle crop at 320px / real 40px / 40px zoomed x5, light over dark
#   compare-profile.png     avatar faces A/B/C next to the decided "Ai" icon, 160px / 120px / 40px, light and dark
# Needs ImageMagick 7 (magick). Run from anywhere.
set -euo pipefail
cd "$(dirname "$0")"
OPTS=(a-senpai b-shizuku c-aibou)
AI_ICON=../final/profile-icon.png
FONT="/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

circle() { # src size out
  magick "$1" -resize "$2x$2" \( -size "$2x$2" xc:black -fill white -draw "circle $(( $2/2 )),$(( $2/2 )) $(( $2/2 )),0" \) \
    -alpha off -compose CopyOpacity -composite "$3"
}

for o in "${OPTS[@]}"; do
  magick "$o/codex-profile.png" -resize '1024x1024!' "$o/profile-icon.png"
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

# Side-by-side: which profile picture? (3 avatar faces vs the decided Ai icon)
NAMES=("A 先輩" "B しずく" "C 相棒" "今の Ai")
SRCS=(a-senpai/profile-icon.png b-shizuku/profile-icon.png c-aibou/profile-icon.png "$AI_ICON")
# 160px / 120px (= a 40pt avatar on a 3x phone screen) / 40px raw pixels, one column per option.
panel() { # bg fg out
  local args=(-size 1000x480 "xc:$1" -font "$FONT" -pointsize 26 -fill "$2")
  for i in 0 1 2 3; do
    local x=$((40 + i * 240))
    circle "${SRCS[$i]}" 160 "$tmp/c160-$i.png"; circle "${SRCS[$i]}" 120 "$tmp/c120-$i.png"; circle "${SRCS[$i]}" 40 "$tmp/c40-$i.png"
    args+=("$tmp/c160-$i.png" -geometry "+$x+30" -composite "$tmp/c120-$i.png" -geometry "+$((x + 20))+210" -composite
      "$tmp/c40-$i.png" -geometry "+$((x + 60))+350" -composite -annotate "+$x+450" "${NAMES[$i]}")
  done
  magick "${args[@]}" "$3"
}
panel white '#1A1A1A' "$tmp/cmp-l.png"; panel '#141414' '#F2F2F2' "$tmp/cmp-d.png"
magick "$tmp/cmp-l.png" "$tmp/cmp-d.png" -append compare-profile.png
echo "rendered: ${OPTS[*]} + compare-profile.png"
