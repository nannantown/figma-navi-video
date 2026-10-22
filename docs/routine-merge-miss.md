# 朝ルーチンの原稿 PR が main に入らない件（2026-10-22 調査）

## 起きたこと

AI Ground の朝ルーチン（Claude Routine 07:30 JST、`trig_015qA2EomJ4EjDPN6KoQQhAT`）は、`routine-content-<日付>` の PR を作って自分で squash merge する手順になっている（[routine-prompt-news.md](routine-prompt-news.md) §6）。10/19（PR #197、今も open）と 10/21（PR #201、司令塔が 10/21 12:07 JST に手で merge）は main に入らなかった。そのため 08:15 の `daily-video.yml` が `no episode for <日付>` で落ち、YouTube と Instagram のどちらにも出なかった。

## 原因（証拠つき）

**ルーチンの merge（段階 C の `gh api --method PUT .../pulls/N/merge`）が、Claude Code の自動判定 `Merge Without Review` に拒否された。ルーチンは手順書どおりそこで止まった。** 原稿の中身や検証の問題ではない。

| 証拠 | 中身 |
|---|---|
| 10/19 のセッションログ（`session_013RLjNGj7QuWKoWZPrrQ8aY`、RemoteTrigger `get_run_log` で読めた） | 22:34:40Z に merge を実行 → 22:34:46Z に `permission_denied Bash [classifier]: [Merge Without Review]`。続く `deliver-jev.mjs` は `DELIVERY FAILED: PR #197 is not merged`。ルーチンは PushNotification で「08:15 までに #197 を merge して」と送って終了 |
| 10/21 のセッションログ（`session_01GKb3PfYDKYfMAMBCuYXPZB`） | 22:33:44Z に merge を実行 → 22:33:50Z に同じ `[Merge Without Review]` の拒否。読み取りだけの `deliver-jev.mjs` まで同じ理由で拒否された。PushNotification を送って終了 |
| 成功した日のログ（10/20 `session_016P46jSxCJbVM7dCSPNSeMR`、10/22 `session_01SMwKAKTS8M7MmQCPyeC6it`） | 同じコマンドの merge が通った。どちらの日も、差分を読んだあとに原稿を直してコミットし直している（#198 `2074ad86`、#203 `3a70e512`）。10/20 は merge のあとの `deliver-jev.mjs` が拒否された |
| PR のタイムライン（`gh api .../issues/{197,201}/timeline`） | #197・#201 とも `committed` が 1 つだけで、ルーチンの merge もコメントも無い。#201 の `merged` は 2026-10-21T03:07:01Z（手動） |
| 原稿の中身 | #197 と #201 の台帳を、それぞれの日付で `validateEpisodes` にかけると、どちらも通る（VALID） |
| 長期の傾向（`gh api pulls?state=all`） | 10/10〜10/22 の 13 朝のうち、ルーチンが自分で merge できたのは 10/12・10/20・10/22 の 3 朝だけ。open のまま: #185（10/10）#186（10/11）#189（10/13）#192〜#195（10/14〜10/17）#197（10/19）。手で merge: #196（10/18）#201（10/21）。10/09 まではどの日も PR 作成から 3〜5 秒で merge されていた。**理由をログで確かめたのは 10/19・10/21 だけ**。ほかの日も同じ拒否だと推定している |
| 一次資料: Claude Code 公式ドキュメント（[Permission modes — auto mode](https://code.claude.com/docs/en/permission-modes)、2026-10-22 取得） | 最初から止める対象として "Merging a pull request no human has approved" が載っている。判定が見るのは "user messages, tool calls … and your CLAUDE.md content" で、ツールの結果は渡されない。Claude 自身の文章は渡すものとして書かれていない |

### 推定（確かめていないこと）

- 判定は毎回同じ結果にならない。通った日は、差分を読んだあとの修正コミットというツール呼び出しが「見直した」と読まれた可能性がある。ただ 10 朝以上で拒否されているので、修正の有無で確実に通るとは言えない
- 10/10 ごろから拒否が続くようになったのは、Claude Code 側の判定の変化が考えられる（確かめていない）
- 手順書にある「評価の根拠を会話に書く」は、判定が Claude の文章を見ないなら効かない

## 直したこと（この PR）

オーナー決定（2026-09-27「B: 今のまま。自動取り込みの仕組みは足さない」）に沿って、**ルーチン以外が自動で merge する仕組みは作っていない**。`.github/workflows/**` も変えていない。

1. **08:15 の失敗をはっきりさせた**: `scripts/generate-data.mjs` は今日の回が main に無いとき、`git ls-remote` で `routine-content-<今日>` ブランチを探す。ブランチがあれば、GitHub Actions の注記 `::error title=原稿 PR が未マージ::…`（PR の検索 URL と「merge してから daily-video.yml を手で実行し直す」）を出して止まる。「ルーチンが書かなかった日」と「書いたが入らなかった日」が、エラーで見分けられる（`scripts/deliver-jev.mjs` の `unmergedRoutineHint`。テストは `scripts/deliver-jev.test.mjs`）
2. **手順書**（[routine-prompt-news.md](routine-prompt-news.md) §6 C・D）: 拒否はどの朝にも起こりうること、レビュー文を書き足しても言い換えても通らないことを書いた。拒否されたら PushNotification（PR 番号・SHA・08:15 の期限・過ぎたときの手での実行）と最終レポートの先頭への記載を必ず行い、そこで止まる。`deliver-jev.mjs` 自体が拒否されたときの、読み取りだけの代わりの確かめ方も書いた

### 再現（2026-10-22）

時計を 10/19 08:15 JST に合わせて（`node --import` で `Date` を固定）、今の main で `scripts/generate-data.mjs` を動かした。main には 10/19 の回が無く、`routine-content-2026-10-19` ブランチは残っている:

```
::error title=原稿 PR が未マージ::2026-10-19 の原稿は routine-content-2026-10-19 ブランチにあるが main に入っていない（ルーチンの merge が止まった）。PR を確かめて squash merge し、daily-video.yml を手で実行し直す: https://github.com/nannantown/figma-navi-video/pulls?q=is%3Apr+head%3Aroutine-content-2026-10-19
data/ai-news-episodes.json is invalid:
  - no episode for 2026-10-19 (…)
  - today's script is on routine-content-2026-10-19 but its PR is not merged — merge it, then re-run daily-video.yml
```

ブランチがまだ無い日（10/23）に合わせると、これまでどおり `no episode for 2026-10-23` だけが出る。

## 残ること（オーナーの判断が要る）

この直しで、入れ忘れは赤くはっきり分かる。ただし **08:15 までに人が merge しない限り、その朝は出ない**ことは変わらない。毎朝確実に届けるには、ルーチンの merge を判定に止めさせない設定が要る。たとえば子リポの `.claude/settings.json` に、このリポの merge の API だけを許す細い許可ルールを置く方法がある（公式ドキュメントでは、許可ルールに合う操作は判定を通らずに決まる）。ただしこれは安全確認を外すことになり、手順書の「許可設定の変更で続けない」にも当たる。クラウドのルーチンがリポの設定を読むかどうかも確かめていない。だからこの PR には入れず、司令塔からオーナーに判断を仰ぐ。
