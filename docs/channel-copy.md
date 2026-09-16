# 発信文言の案 — 新作AIツール N選（ジャンル試行 #1）

アカウント名・プロフィール・チャンネル説明文の**変更はオーナーが行う**。ここにあるのは案で、キャプションとハッシュタグは `scripts/generate-caption.mjs` が毎日自動で作る。

2026-09-15 のオーナー決定（Product Hunt は公式フィードだけを使う）により、**ランキング・投票数・順位は名乗らない**。見せ方は「新作AIツール N選」（使える新作が 5 本以上ある日は 5選）。

## ハッシュタグ

### Instagram（5 個に固定）

```
#AIツール #生成AI #業務効率化 #便利ツール #ProductHunt
```

- Instagram は 2025 年 12 月から、1 投稿あたりのハッシュタグを 5 個までに制限している（@creators の告知 https://www.instagram.com/p/DSaxmEWkfL4/ 、報道 https://www.socialmediatoday.com/news/instagram-implements-new-limits-on-hashtag-use/808309/ ）。旧デザインニュースは 9 個付けていた
- 選び方: 「AIツール」「生成AI」で AI に関心がある層を、「業務効率化」「便利ツール」で非エンジニアの会社員層を、「ProductHunt」で出典とツール好きの層を狙う
- 変えるときは試行の途中でも可（型ではないため）。変えた日は PDCA レポートに記録する

### YouTube

- 概要欄の末尾: `#AIツール #生成AI #ProductHunt #新作AIツール #Shorts`（YouTube は概要欄のハッシュタグのうち、反応が良いと判断したものを最大 3 個までタイトルの近くに表示する。YouTube ヘルプ https://support.google.com/youtube/answer/6390658 、2026-09-16 確認）
- タグ（`snippet.tags`）: `AIツール, 生成AI, ProductHunt, 新作AIツール, AI活用, 便利ツール, 業務効率化, Shorts` + その日のツール名（合計 500 字以内）

## 自動生成されるキャプションの例

`npm run dry-run`（検証用サンプル: 2026-09-14 分、5 本）の実際の出力。**TOP・トップ・ランキング・◯位 は使わない**（原稿の検証でもエラーになる）。

### YouTube タイトル（100 字以内。超えそうなときはツール名を減らす）

```
【新作AIツール5選】Resurf・GhostWriter by MyHandler・Visiby ほか｜2026/09/14 #Shorts
```

2026-09-13・14 の YouTube 投稿は、タイトルが 100 字を超えて失敗していた（`invalid or empty video title`）。新しいタイトルは必ず 100 字以内に収める。

### YouTube 概要欄（各ツールに Product Hunt ページの URL を付ける。Shorts の概要欄の URL はクリックできない仕様なので、出典の明記として載せる。YouTube ヘルプ https://support.google.com/youtube/answer/13748639 ）

```
2026/09/14 の新作AIツール 5選（Product Hunt の直近48時間の新着から厳選）

1. Resurf｜メモもリンクもPDFも1か所に保存
   誰向け: Macユーザー ／ 料金: 無料プランあり
   公式サイト: https://resurf.so/
   Product Hunt: https://www.producthunt.com/products/resurf-2

2. GhostWriter by MyHandler｜2タップで文章を下書き
   誰向け: Windowsユーザー ／ 料金: 無料プランあり
   公式サイト: https://myhandler.ai/ghostwriter
   Product Hunt: https://www.producthunt.com/products/ghostwriter-by-myhandler
（3〜5 本目も同じ形式）

出典: Product Hunt https://www.producthunt.com/
料金や仕様は変わることがあるので、使う前に公式サイトで確認してください。
毎朝、使える新作AIツールを1分で紹介しています。
気になるツールは保存して、あとで試してみてください。

#AIツール #生成AI #ProductHunt #新作AIツール #Shorts
```

### Instagram キャプション（リンクは効かないので出典は文字で書く）

```
新作AIツール 5選（9/14）

1. Resurf：メモもリンクもPDFも1か所に保存
   Macユーザー向け／無料プランあり／resurf.so
2. GhostWriter by MyHandler：2タップで文章を下書き
   Windowsユーザー向け／無料プランあり／myhandler.ai
3. Visiby：AI検索での自社の見え方を追跡
   マーケター向け／月$49〜／visiby.net
4. Perplexity Hybrid Compute：調べ物はクラウド、個人情報はMacで処理
   Perplexity有料会員向け／Pro以上の有料プラン／perplexity.ai
5. Cognition SWE-2：安く速いコーディング用AIモデル
   Devinを使う開発者向け／10/8まで無料／cognition.com

出典: Product Hunt の直近48時間の新着から厳選
料金や仕様は変わることがあるので、公式サイトで確認してください。
気になるツールは保存して、あとで試してみてください。

#AIツール #生成AI #業務効率化 #便利ツール #ProductHunt
```

新作が 2〜4 本の日は「新作AIツール 3選」のように本数が変わる。

## プロフィール・チャンネル説明文の案

### Instagram プロフィール（150 字以内）

**案 A（シンプル）**

```
毎朝、公開されたばかりの使えるAIツールを紹介
名前・できること・誰向け・料金を1分で
気になったら保存して、あとで試そう
出典: Product Hunt
```

**案 B（悩みから入る）**

```
「AIツール、多すぎて追えない」人へ
Product Hunt の新作から、仕事で使えるものを毎朝厳選
無料で試せるかも必ずチェック
```

### YouTube チャンネル説明文

```
世界中の新作が集まる Product Hunt から、公開されたばかりで仕事や創作にすぐ使える AI ツールを、毎朝 1 分で紹介するチャンネルです。

・何ができるか
・誰に向いているか
・無料で試せるか
をまとめて伝えるので、気になったツールは保存して、あとでゆっくり試してみてください。

※ ツールの情報は投稿時点のものです。料金や仕様は各公式サイトで確認してください。
※ 本チャンネルは Product Hunt の公式チャンネルではありません。紹介の順番は Product Hunt の順位ではありません。
```

### アカウント名（2026-09-16 オーナー決定: 変えない）

- **YouTube チャンネル名「HAL- AI情報カフェ」(@hal-ai-9000) はそのまま使う**。Figma 色がなく AI 汎用の名前なので、新ジャンルでも矛盾しないため（2026-09-16 オーナー回答）。
- **IG のアカウント名も変えない**。差し替えるのは上の「プロフィール・チャンネル説明文の案」の文章だけで、**変更操作はオーナーが YouTube Studio / Instagram アプリで行う**。
- 参考（採用しない）: 名前も変える案としては「AIツール図鑑」「毎朝AIツール」「新作AIツール便」を出していた。名前を変えたくなったときの候補としてここに残す（順位を名乗る「TOP5」案は 2026-09-15 の決定で外した）。

チャンネル名は 2026-09-14 に YouTube の埋め込み情報（oEmbed）から確認し、2026-09-16 にオーナー本人が確認した（sns-hub 側の記録は同日 main に入った）。
