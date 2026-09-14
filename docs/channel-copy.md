# 発信文言の案 — 新作AIツール TOP5（ジャンル試行 #1）

アカウント名・プロフィール・チャンネル説明文の**変更はオーナーが行う**。ここにあるのは案で、キャプションとハッシュタグは `scripts/generate-caption.mjs` が毎日自動で作る。

## ハッシュタグ

### Instagram（5 個に固定）

```
#AIツール #生成AI #業務効率化 #便利ツール #ProductHunt
```

- Instagram は 2025 年 12 月から、1 投稿あたりのハッシュタグを 5 個までに制限している（@creators の告知 https://www.instagram.com/p/DSaxmEWkfL4/ 、報道 https://www.socialmediatoday.com/news/instagram-implements-new-limits-on-hashtag-use/808309/ ）。旧デザインニュースは 9 個付けていた
- 選び方: 「AIツール」「生成AI」で AI に関心がある層を、「業務効率化」「便利ツール」で非エンジニアの会社員層を、「ProductHunt」で出典とツール好きの層を狙う
- 変えるときは試行の途中でも可（型ではないため）。変えた日は PDCA レポートに記録する

### YouTube

- 概要欄の末尾: `#AIツール #生成AI #ProductHunt #新作AIツール #Shorts`（最初の 3 個がタイトルの上に表示される）
- タグ（`snippet.tags`）: `AIツール, 生成AI, ProductHunt, 新作AIツール, AI活用, 便利ツール, 業務効率化, Shorts` + その日のツール名（合計 500 字以内）

## 自動生成されるキャプションの例（検証用サンプル 2026-09-15 分）

### YouTube タイトル（100 字以内。超えそうなときはツール名を減らす）

```
【新作AIツールTOP5】Resurf・Perplexity Hybrid Compute・Cognition SWE-2 ほか｜2026/09/15 #Shorts
```

2026-09-13・14 の YouTube 投稿は、タイトルが 100 字を超えて失敗していた（`invalid or empty video title`）。新しいタイトルは必ず 100 字以内に収める。

### YouTube 概要欄

```
2026/09/15 の新作AIツール TOP5（Product Hunt 9/13 ランキングより）

1. Resurf｜メモもリンクもPDFも1か所に保存
   誰向け: Macユーザー ／ 料金: 無料プランあり
   https://resurf.so/

2. Perplexity Hybrid Compute｜調べ物はクラウド、個人情報はMacで処理
   誰向け: Perplexity有料会員 ／ 料金: Pro以上の有料プラン
   https://www.perplexity.ai/hub/products/hybrid-compute
（3〜5 本目も同じ形式）

出典: Product Hunt。料金や仕様は変わることがあるので、使う前に公式サイトで確認してください。
毎朝、使える新作AIツールを1分で紹介しています。
気になるツールは保存して、あとで試してみてください。

#AIツール #生成AI #ProductHunt #新作AIツール #Shorts
```

### Instagram キャプション

```
新作AIツール TOP5（9/15）

1. Resurf：メモもリンクもPDFも1か所に保存
   Macユーザー向け／無料プランあり／resurf.so
2. Perplexity Hybrid Compute：調べ物はクラウド、個人情報はMacで処理
   Perplexity有料会員向け／Pro以上の有料プラン／perplexity.ai
3. Cognition SWE-2：安く速いコーディング用AIモデル
   Devinを使う開発者向け／10/8まで無料／cognition.com
4. Visiby：AI検索での自社の見え方を追跡
   マーケター向け／月$49〜／visiby.net
5. GhostWriter by MyHandler：2タップで文章を下書き
   Windowsユーザー向け／無料プランあり／myhandler.ai

Product Hunt 9/13 ランキングより。料金や仕様は変わることがあるので、公式サイトで確認してください。
気になるツールは保存して、あとで試してみてください。

#AIツール #生成AI #業務効率化 #便利ツール #ProductHunt
```

## プロフィール・チャンネル説明文の案

### Instagram プロフィール（150 字以内）

**案 A（シンプル）**

```
毎朝、使える新作AIツールを5つ紹介
名前・できること・誰向け・料金を1分で
気になったら保存して、あとで試そう
出典: Product Hunt
```

**案 B（悩みから入る）**

```
「AIツール、多すぎて追えない」人へ
Product Hunt の新作から、仕事で使える5本を毎朝厳選
無料で試せるかも必ずチェック
```

### YouTube チャンネル説明文

```
世界中の新作が集まる Product Hunt から、仕事や創作にすぐ使える AI ツールを毎朝 5 本、1 分で紹介するチャンネルです。

・何ができるか
・誰に向いているか
・無料で試せるか
をまとめて伝えるので、気になったツールは保存して、あとでゆっくり試してみてください。

※ ツールの情報は投稿時点のものです。料金や仕様は各公式サイトで確認してください。
※ 本チャンネルは Product Hunt の公式チャンネルではありません。
```

### アカウント名の候補（決めるのはオーナー）

| 案 | ねらい |
|---|---|
| AIツール図鑑 | 保存して見返す「図鑑」を連想させる |
| 毎朝AIツール | 毎日更新であることが名前で分かる |
| 新作AIツール TOP5 | 動画の中身をそのまま名前にする |

現在の YouTube チャンネル名は「HAL- AI情報カフェ」（sns-hub docs/strategy/README.md の一覧より）。すでに AI 寄りの名前なので、YouTube は名前を変えずに説明文だけ差し替える選択肢もある。
