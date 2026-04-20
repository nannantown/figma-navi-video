# figma-navi-video

Daily short-form SNS videos for **Figmaナビ** plugin promotion — AI-powered design generation.

Generates 55-58s vertical videos (1080×1920) and posts to YouTube Shorts + Instagram Reels every morning at 08:15 JST.

Forked from `coffee-daily-video` as the 3rd pipeline in the `sns-hub` family.

## Architecture

```
Claude Routine (~07:45 JST)         GitHub Actions (08:15 JST)
────────────────────────           ──────────────────────────
英語優先で当日のデザインニュース     data/enriched-design-news.json
をリサーチ → PDCA → discovery       を読んで動画生成 → YT + IG 投稿
method 決定 → enriched JSON commit
```

コンテンツ戦略・ペルソナ・コンテンツ柱・discovery method・KPI は [docs/strategy.md](docs/strategy.md) に集約されています。ルーチンはこのファイルを毎朝読んで判断します。

## Setup (User action required)

このリポジトリは sns-hub 配下の**ローカル雛形**。本番運用するには以下が必要:

### 1. GitHub リポジトリを作成

```bash
cd /Users/kokinaniwa/projects/sns-hub/figma-navi-video
git init
git add -A
git commit -m "Initial fork from coffee-daily-video"
gh repo create nannantown/figma-navi-video --public --source=. --remote=origin --push
```

### 2. Secrets を設定

`nannantown/figma-navi-video` リポの Settings → Secrets and variables → Actions:

```
SNS_POST_ENABLED         # "true" で本番投稿有効化

# YouTube (既存デザイン講座チャンネル)
YOUTUBE_CLIENT_ID
YOUTUBE_CLIENT_SECRET
YOUTUBE_REFRESH_TOKEN    # node scripts/auth-youtube.mjs で取得

# Instagram (既存デザインアカウント)
INSTAGRAM_ACCESS_TOKEN   # Meta App "Social Media Manager" から取得
INSTAGRAM_USER_ID        # Figmaナビ用 IG Business アカウントの user_id
FACEBOOK_PAGE_ID         # 対応 Facebook Page の ID

# 週次 token 延長用
GH_PAT                   # Fine-grained PAT, Secrets: RW
```

値の取得方法は親 `sns-hub/CLAUDE.md` と `sns-hub/docs/shared-patterns.md` を参照。

### 3. Claude Routine を作成

sns-hub の他の 2 プロジェクトと同じパターン:
- cron: `0 22 * * *` (07:00 JST、daily-video.yml より 1 時間前)
- environment: 自動生成 (初回ルーチン作成時)
- allow_unrestricted_git_push: true
- events: 専用プロンプト (策定後ユーザーから依頼)
- session_context とのセット更新必須 (理由は sns-hub/docs/shared-patterns.md の "RemoteTrigger API 関連" 参照)

### 4. refresh-instagram-token workflow を有効化

60 日で失効する IG Long-lived Token を週次で延長する workflow。coffee-daily-video から継承済み。

## Files of note

```
docs/strategy.md           # ペルソナ/コンテンツ柱/Discovery Methods/KPI
data/enriched-design-news.json  # Claude Routine が毎朝書き出す当日コンテンツ
scripts/pipeline.mjs       # メイン: fetch-stats → generate-data → audio → render → post
scripts/generate-data.mjs  # enriched JSON → trending-data.json に変換
scripts/record-upload.mjs  # performance-history.json に discovery 含めて記録
src/compositions/TrendingVideo.tsx  # Remotion composition (id: FigmaNaviVideo)
src/components/ProjectCard.tsx      # メインカード (text-first、ビジュアル機能は Phase 2)
.github/workflows/daily-video.yml   # 08:15 JST 起動
```

## Phase 1 → Phase 2

**Phase 1 (現在)**: テキスト中心のニュース動画。ProjectCard は Coffee から継承した text-first レイアウト。
**Phase 2 (将来)**: ビジュアル重視コンテンツ(Before/After スクリーンショット、タイマー比較、UI 批評)に合わせて ProjectCard を再設計。

移行トリガー: Phase 1 で週次安定運用が 1 ヶ月続いた時点。
