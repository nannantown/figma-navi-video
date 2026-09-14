# figma-navi-video

毎朝の縦型ショート動画「**新作AIツール TOP5**」（公式 API の日）/「**新作AIツール N選**」（公式フィードの日、2〜5 本）を作り、YouTube Shorts と Instagram Reels に投稿する。出典は Product Hunt で、扱うのは直近 48 時間以内に公開されたツールだけ。sns-hub の**ジャンル試行 #1**（2026-09-15 開始予定、判定 2026-09-29）。

- リポ名は旧ジャンル（Figmaナビ販促のデザインニュース, 2026-04〜09）の名残。改名は別途
- 戦略・ペルソナ・判定ルール: [docs/strategy.md](docs/strategy.md)
- 朝ルーチンの手順（正本）: [docs/routine-prompt.md](docs/routine-prompt.md)
- データ仕様: [docs/enrichment-schema.md](docs/enrichment-schema.md)
- キャプション・プロフィール文言の案: [docs/channel-copy.md](docs/channel-copy.md)

## Architecture

```
fetch-product-hunt.yml (18:30 JST 前夜 / 06:30 JST 予備)
  Product Hunt 公式 API（PRODUCT_HUNT_API_TOKEN があるとき）/ 公式 Atom フィード（ないとき）
  → data/product-hunt-daily.json

Claude Routine (07:30 JST)                     daily-video.yml (08:15 JST)
────────────────────────────                  ──────────────────────────────
PDCA（pdca-summary.mjs）→ 5 本を選ぶ →         generate-data → fetch-tool-images →
公式サイトで確認 → 日本語原稿 →                 TTS（60 秒未満に自動調整）→ Remotion →
validate-enriched.mjs → PR merge               YouTube + Instagram → performance-history
  → data/enriched-ai-tools.json
```

## Secrets

`nannantown/figma-navi-video` の Settings → Secrets and variables → Actions:

```
SNS_POST_ENABLED          # "true" で本番投稿
YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN
INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_USER_ID / FACEBOOK_PAGE_ID
GH_PAT                    # 週次の IG token 延長用
PRODUCT_HUNT_API_TOKEN    # 任意。Product Hunt の developer token。あると ranking モード（順位・票数・サムネイル）
```

値の取得方法は親 `sns-hub/CLAUDE.md` と `sns-hub/docs/shared-patterns.md` を参照。Product Hunt のデータ（公式 API・公式フィード）の利用条件はオーナー確認中（`docs/strategy.md` の「取得モード」）。トークンを登録するかどうかもオーナーが判断する。

## Verify

```bash
npm test                      # unit tests (node --test)
npm run typecheck             # tsc --noEmit
npm run fetch-ph -- --dry-run # Product Hunt 取得だけ試す（書き込みなし）
npm run dry-run               # サンプルデータで動画 + キャプションを作る（投稿・記録なし）
```

GitHub Actions 上の検証:

```bash
gh workflow run daily-video.yml --ref <branch> -f dry_run=true       # main 以外の ref は常に検証扱い（投稿・コミットしない）
gh workflow run fetch-product-hunt.yml --ref <branch> -f verify=true  # 取得して artifact に保存するだけ
```

## Files of note

```
docs/strategy.md                    # 試行 #1 の戦略（旧デザイン戦略は docs/strategy-archive/）
docs/routine-prompt.md              # 朝ルーチンの正本
data/enriched-ai-tools.json         # ルーチンが毎朝書く当日データ
data/product-hunt-daily.json        # fetch-product-hunt.yml のスナップショット
data/samples/                       # 検証用サンプル
scripts/fetch-product-hunt.mjs      # 公式 API / Atom フィードの取得
scripts/enriched-schema.mjs         # データ検証（パイプラインとルーチンで共通）
scripts/fetch-tool-images.mjs       # ロゴ / スクリーンショット取得（失敗しても止めない）
scripts/generate-caption.mjs        # YT タイトル 100 字・IG ハッシュタグ 5 個の制限を守る
scripts/pdca-summary.mjs            # IG views 中央値・保存合計・判定日を出す
src/compositions/AiToolsVideo.tsx   # Remotion composition (id: AiToolsTop5)
src/components/ToolCard.tsx         # ツール 1 本分のカード
```
