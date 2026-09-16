# figma-navi-video

毎朝の縦型ショート動画「**新作AIツール N選**」（2〜5 本、使える新作が 5 本以上ある日は 5選）を作り、YouTube Shorts と Instagram Reels に投稿する。出典は Product Hunt の公式フィードで、扱うのは直近 48 時間以内に公開されたツールだけ。順位・票数は名乗らない（2026-09-15 オーナー決定）。sns-hub の**ジャンル試行 #1: AI ツール TOP5（Product Hunt）**（2026-09-17 開始予定、最初の判定 2026-10-01、以降 14 日ごと）。

- リポ名は旧ジャンル（Figmaナビ販促のデザインニュース, 2026-04〜09）の名残。改名は別途
- 戦略・ペルソナ・判定ルール: [docs/strategy.md](docs/strategy.md)
- 朝ルーチンの手順（正本）: [docs/routine-prompt.md](docs/routine-prompt.md)
- データ仕様: [docs/enrichment-schema.md](docs/enrichment-schema.md)
- キャプション・プロフィール文言の案: [docs/channel-copy.md](docs/channel-copy.md)

## Architecture

```
fetch-product-hunt.yml (15:00 JST 太平洋日の変わり目の直前 / 18:17 JST 前夜 / 03:47 JST 予備)
  Product Hunt 公式 Atom フィード（PH_SOURCE=feed。main の最新スナップショットから掲載の初出を引き継ぐ。
  掲載の記録が働かないときは保存後にジョブを失敗させて通知）
  → data/product-hunt-daily.json

Claude Routine (07:30 JST)                     daily-video.yml (08:15 JST)
────────────────────────────                  ──────────────────────────────
PDCA（pdca-summary.mjs）→ 2〜5 本を選ぶ →      generate-data → fetch-tool-images →
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
```

値の取得方法は親 `sns-hub/CLAUDE.md` と `sns-hub/docs/shared-patterns.md` を参照。Product Hunt 用の Secret は**不要**: 2026-09-15 のオーナー決定で公式 API は使わず、`fetch-product-hunt.yml` はトークンを渡さない（`PRODUCT_HUNT_API_TOKEN` を登録しても何も変わらない）。API に切り替えるにはオーナーの判断と PR が必要（`docs/strategy.md` の「取得モード」）。

## Verify

```bash
npm test                      # unit tests (node --test)
npm run typecheck             # tsc --noEmit
npm run fetch-ph -- --dry-run # Product Hunt 取得だけ試す（書き込みなし）
npm run dry-run               # pickup（5選）のサンプルで動画 + キャプションを作る（投稿・記録なし）
npm run dry-run:skip          # 休止の日のサンプル（動画は作らず、警告と要約だけ）
npm run dry-run:ranking       # 旧 ranking（TOP5）のサンプル。PH_ALLOW_RANKING=1 を付けて検証を通す参考用（本番では無効）
```

GitHub Actions 上の検証:

```bash
gh workflow run daily-video.yml --ref <branch> -f dry_run=true   # main 以外の ref は常に検証扱い（投稿・コミットしない）
# fetch-product-hunt.yml は、取得まわり（ワークフロー / fetch-product-hunt.mjs / pacific-time.mjs）を変える PR で自動的に検証実行される（コミットしない）。
# 手動の workflow_dispatch はワークフローが main にあるときだけ使える（GitHub の仕様）:
gh workflow run fetch-product-hunt.yml -f verify=true            # main で取得して artifact に保存するだけ
```

## Files of note

```
docs/strategy.md                    # 試行 #1 の戦略（旧デザイン戦略は docs/strategy-archive/）
docs/routine-prompt.md              # 朝ルーチンの正本
data/enriched-ai-tools.json         # ルーチンが毎朝書く当日データ
data/product-hunt-daily.json        # fetch-product-hunt.yml のスナップショット
data/samples/                       # 検証用サンプル
scripts/fetch-product-hunt.mjs      # 公式 Atom フィードの取得と掲載の初出（API は PH_SOURCE=api のときだけ）
scripts/enriched-schema.mjs         # データ検証（パイプラインとルーチンで共通）
scripts/snapshot.mjs                # 照合用スナップショットの読み込み（パイプラインはルーチンのコミット時点の版）
scripts/fetch-tool-images.mjs       # ロゴ / スクリーンショット取得（失敗しても止めない）
scripts/generate-caption.mjs        # YT タイトル 100 字・IG ハッシュタグ 5 個の制限を守る
scripts/pdca-summary.mjs            # IG views 中央値・保存合計・判定日を出す
src/compositions/AiToolsVideo.tsx   # Remotion composition (id: AiToolsTop5)
src/components/ToolCard.tsx         # ツール 1 本分のカード
```
