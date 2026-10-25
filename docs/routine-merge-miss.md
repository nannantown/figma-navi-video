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

1. **08:15 の失敗をはっきりさせた**: `scripts/generate-data.mjs` は、台帳が正しい形のまま今日の回だけが無いとき（エラーが `no episode for <今日>`）に限って、`git ls-remote` で `routine-content-<今日>` ブランチを探す。ブランチがあれば、GitHub Actions の注記 `::error title=原稿 PR が未マージかもしれない::…` を出して止まる。注記には「PR が未作成・未マージ、またはルーチンがまだ実行中の可能性」、PR の検索 URL、「merge したら daily-video.yml を手で実行し直す」が入る。「ルーチンが書かなかった日」と「書いたが入らなかった日」が、エラーで見分けられる。ブランチは merge のあとも消えずに残るので、台帳が壊れている日にはこの注記を出さない（`scripts/deliver-jev.mjs` の `unmergedRoutineHint`。テストは `scripts/deliver-jev.test.mjs`）
2. **手順書**（[routine-prompt-news.md](routine-prompt-news.md) §6 C・D。休止中の型 [routine-prompt-jev.md](routine-prompt-jev.md)・[routine-prompt-pickup.md](routine-prompt-pickup.md) にも同じ止まり方を入れた）: 拒否はどの朝にも起こりうること、レビュー文を書き足しても言い換えても通らないことを書いた。拒否されたら PushNotification（PR 番号・SHA・08:15 の期限・過ぎたときの手での実行）と最終レポートの先頭への記載を必ず行い、そこで止まる。`deliver-jev.mjs` 自体が拒否されたときの、読み取りだけの代わりの確かめ方も書いた

### 再現（2026-10-22）

時計を 10/19 08:15 JST に合わせて（`node --import` で `Date` を固定）、今の main で `scripts/generate-data.mjs` を動かした。main には 10/19 の回が無く、`routine-content-2026-10-19` ブランチは残っている:

```
::error title=原稿 PR が未マージかもしれない::routine-content-2026-10-19 ブランチがあり、2026-10-19 の回が main に無い。PR が未作成・未マージ、またはルーチンがまだ実行中の可能性がある。PR を確かめ、merge したら daily-video.yml を手で実行し直す: https://github.com/nannantown/figma-navi-video/pulls?q=is%3Apr+head%3Aroutine-content-2026-10-19
data/ai-news-episodes.json is invalid:
  - no episode for 2026-10-19 (…)
  - routine-content-2026-10-19 exists but today's episode is not on main — check its PR (unmerged, not opened, or the routine still running); after a merge, re-run daily-video.yml
```

ブランチがまだ無い日（10/23）に合わせると、これまでどおり `no episode for 2026-10-23` だけが出る。

## 残ること（オーナーの判断が要る）

この直しで、入れ忘れは赤くはっきり分かる。ただし **08:15 までに人が merge しない限り、その朝は出ない**ことは変わらない。毎朝確実に届けるには、ルーチンの merge を判定に止めさせない設定が要る。たとえば子リポの `.claude/settings.json` に、このリポの merge の API だけを許す細い許可ルールを置く方法がある（公式ドキュメントでは、許可ルールに合う操作は判定を通らずに決まる）。ただしこれは安全確認を外すことになり、手順書の「許可設定の変更で続けない」にも当たる。クラウドのルーチンがリポの設定を読むかどうかも確かめていない。だからこの PR には入れず、司令塔からオーナーに判断を仰ぐ（→ 下の「2026-10-23 オーナー決定 A」で対応した）。

## 2026-10-23 オーナー決定 A: merge の 1 操作だけを許す細い許可を入れた

オーナー回答「受け渡しもちろん許可するよ」（2026-10-23）。2026-09-27 の決定 B（自動取り込みの仕組みを作らない）は、この 1 操作に限って上書きされた。上の「残ること」はこれで対応する。

- **置いたもの**: リポの [`.claude/settings.json`](../.claude/settings.json)。許可（allow）は `Bash(gh api --method PUT repos/nannantown/figma-navi-video/pulls/*/merge -f merge_method=squash -f sha=* --jq '{merged,message,sha}')` の 1 本だけ（手順書の 3 行の形 = squash で、`-f sha=` で検証済みの SHA を指定し、最後が `--jq '{merged,message,sha}'` のもの。`\` の改行は Claude Code が 1 行にまとめてから照らし合わせるので、この 1 行の書き方で 3 行の形にも当たる）。ワイルドカードは PR 番号と SHA の値の 2 か所に置いたが、**`*` は空白や引用符もまたぐ**ので、許可だけでは `pulls/1/merge -f 'x=/merge -f merge_method=squash -f sha=' --jq …` のような形（GitHub には `x` だけが届き、既定の merge になる）も通ってしまう（差し戻し 2 で独立レビューが指摘）。そこで **PreToolUse hook [`.claude/hooks/merge-guard.mjs`](../.claude/hooks/merge-guard.mjs)** を足した。PUT・`pulls/`・`merge` を含む Bash のコマンドは、手順書の形（数字の PR 番号・`-f merge_method=squash -f sha=` + 40 桁の SHA・`--jq '{merged,message,sha}'`、`\` の改行は可）に**コマンド全体が厳密に一致するときだけ**通し、それ以外は exit 2 で止める（hook は許可ルールより先に動き、確かめを外すモードでも止める）。それ以外のコマンドには口を出さない。`onFailure: "block"` なので、hook が動けない（node が無い・ファイルが無い）ときは、このリポの Bash がすべて止まる（そのときルーチンは原稿 PR を作れず、08:15 はネタ帳の回が出る）。テストは `scripts/merge-guard.test.mjs`。あわせて拒否（deny）で `merge_method=merge` / `rebase`（引用符つきも）・空の `sha`・ `gh pr merge`・`gh workflow run`・workflow の dispatch・`gh api` の DELETE と `-X` / 2 つ目の `--method`（別の操作への差し替え）・`@`（`-F key=@ファイル` で手元のファイルを読み込む）・`--input`・`--hostname`・`commit_title` / `commit_message`（このリポは公開なので、merge のコミットに任意の文を書かせない）・`git push` の force / 削除 / main 宛て（`git push … main`・`…:main`・`…refs/heads/main` の形だけ。`domain` などの名前は塞がない）を塞いだ（拒否は許可より先に効く。手順書のほかの操作はどれにも当たらない）。`.gitignore` の `.claude/` は `.claude/*` + `!.claude/settings.json` + `!.claude/hooks/` + `*/**/.claude/` に変えた（ほかの `.claude/` の中身と、下の階層の `.claude/` は今までどおり無視）
- **公式ドキュメントで確かめたこと**（2026-10-24 取得）: auto mode では、許可・拒否のルールに合う操作は判定より先に決まる（[Permission modes](https://code.claude.com/docs/en/permission-modes)）。クラウドの定時タスク（ルーチン）は auto mode で始まり、リポが 1 つのセッションではリポの `.claude/settings.json` を読む（[Settings — Settings in cloud sessions](https://code.claude.com/docs/en/settings)、[Routines](https://code.claude.com/docs/en/routines)）。このルーチンのリポは figma-navi-video の 1 つだけ。判定の設定（`autoMode`）はリポの設定からは読まれないので使っていない
- **手元で再現したこと**（2026-10-24、Claude Code 2.1.310、存在しない PR 0 に向けて実行 = 通っても GitHub が 404 を返すだけ）: 設定なしの auto mode では朝と同じ `Merge Without Review` で止まった。設定ありでは、手順書と同じ 3 行の形（`\` の改行つき）で、PR 番号と SHA を書き込んだものは通った（404 が返った）。**`$PR_NUMBER` や `"$VALIDATED_HEAD"` の変数が入ったものは許可に当たらなかった**。だから手順書（lesson・news・jev の C）の merge の形を「値をそのまま書き込む」に直した。ほかのリポの merge・`&&` でつないだもの・`> ファイル` を付けたものは当たらず、`-F commit_message=@…` を付けたものと `gh workflow run` は拒否で止まった。**差し戻し 1（2026-10-25）で絞ったあと**も同じ方法で確かめた: 手順書の 3 行の形と 1 行の形は通り（auto mode でも 404）、`sha` 無し・空の `sha=""`・`merge_method=merge`・`rebase`・`merge_method=merge` を先に入れて squash を後ろに足したすり替えは止まった（すり替えと merge / rebase / 空の sha は、確かめを外すモードでも拒否で止まる = deny が効いている）。push は使い捨てのリポ（手元の bare リポ宛て）で試し、`git push -u origin "$BRANCH"`（`routine-content-2026-10-26`）と `git push -u origin domain` は通り、`git push origin main`・`git push origin HEAD:main` は拒否で止まった
- **効いたかの確かめ**: この設定が main に入った次の朝（07:30 JST〜）のルーチンのログ（RemoteTrigger `list_runs` → `get_run_log`）で、merge の行に `permission_denied … [classifier]` が無く、`deliver-jev.mjs` が `OK: main received …` を出したかを見る。拒否されたときの PushNotification して止まる手順はそのまま残している（許可が効かなかった朝の安全網）
- **戻し方**: `.claude/settings.json` を消す PR を main に入れる（消せば次の朝から元の判定に戻る）。手順書の「値を書き込む」形は、許可が無くても今までどおり動く
- **気をつけること**: この設定は、ルーチンだけでなく**このリポで動くすべての Claude Code のセッション**（swarm の作業者・人の手元のセッションを含む）に効く。拒否は確かめを外すモードでも止まるので、このリポの中から Claude に `gh workflow run`（たとえば親リポ `CLAUDE.md` の確認モードや、[routine-prompt-pickup.md](routine-prompt-pickup.md) の「daily-video.yml を手で実行」）・main への push・`gh pr merge`・force push をさせることはできない。人が自分のターミナルで打つのは止まらない。Claude から要るときは、別のフォルダから `--repo nannantown/figma-navi-video` を付けて打つか、この設定を外す PR を先に入れる。休止中の型 pickup の `gh pr merge --admin --delete-branch` と、trigger 本文に残る旧手順（デザインニュース。`docs/routine-prompt.md` が無い日だけ使う）の `gh pr merge` は拒否で止まる
- **残るリスク**: hook も PR 番号は「数字」としか見ないので、**このリポの PR なら、どの番号でも squash で merge できる**（中身の確かめは手順書の validate・差分レビュー・`deliver-jev.mjs --prepare` が担い、許可そのものは番号を見ない）。2026-10-25 時点で、古い原稿 PR が open のまま残っている: #173（09-29）#174（09-30）#177（10-03）#185（10-10）#186（10-11）#189（10-13）#192〜#195（10-14〜10-17）#197（10-19）。ルーチンが番号を取り違えても、`-f sha=` の値がその PR の先頭と違えば GitHub が断る（許可は sha の指定を必須にしている）。ただし古い PR の先頭の SHA を読んで渡せば通るので、これらの古い台帳が main に入りうる道は残る。古い PR を閉じるのは司令塔（作業者は閉じない）
- **差し戻し 2（2026-10-25）の再現**（Claude Code 2.1.310、PR 0）: 抜け道の形（`-f 'x=/merge -f merge_method=squash -f sha='`）は auto mode でも確かめを外すモードでも hook で止まった。sha の引用符の中に `-f merge_method=me''rge` を入れたすり替え、`sha` 無し、`merge_method=merge` / `rebase` も auto mode で hook が止めた。手順書の 3 行の形と 1 行の形は今までどおり通り（404）、`git log` などのほかのコマンドも通った。hook のファイルが見つからないフォルダでは、`onFailure: "block"` によって Bash が止まった
- **差し戻し 3（2026-10-25）**: Monitor ツール（コマンドを裏で走らせて出力を読む道具）は Bash と同じ許可ルールを使う（[Tools reference — Monitor](https://code.claude.com/docs/en/tools-reference)）。hook が Bash しか見ていなかったので、抜け道の形を Monitor で送ると通った。hook の対象を `Bash|Monitor` にし、Monitor のコマンドも同じ厳密さで調べるようにした。あわせて、merge らしいかの入口の判定を、引用符・`\`・`$` を取り除いてから行うようにした（`P''UT`・`pu"ll"s/`・`$'merge'` のように崩した書き方も厳密照合に回る。`-XPUT` も）。手元（Claude Code 2.1.310、auto mode、PR 0）で、Monitor の抜け道は hook が止め、Monitor の手順書の形は通った（404）
