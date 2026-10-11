# AI Ground 日次原稿の供給停止 — 2026-10-11 ローカル調査

本番操作前の報告。push・PR 作成・merge・workflow_dispatch・rerun/backfill・スケジュール変更・公開・SNS 投稿は行っていない。実装とテストは独立コピー内だけ。

## 原因と確定範囲

動画生成に原稿を供給する Claude 朝ルーチンは、両日とも原稿を作って PR まで進んでいる。停止点は **PR から main への反映**。動画側の当日欠落エラーは、それを正しく検出している。

| 日付 JST | 日次 Actions | 原稿の所在 | main |
|---|---|---|---|
| 10/09 | [37876908988](https://github.com/nannantown/figma-navi-video/actions/runs/37876908988)、success | [PR #184](https://github.com/nannantown/figma-navi-video/pull/184)、07:37:43 JST merge | 2-4 usecase あり |
| 10/10 | [38016528644](https://github.com/nannantown/figma-navi-video/actions/runs/38016528644/job/114107924591)、failure | [PR #185](https://github.com/nannantown/figma-navi-video/pull/185)、07:38:09 JST 作成、未マージ | 当日なし |
| 10/11 | [38103294186](https://github.com/nannantown/figma-navi-video/actions/runs/38103294186/job/114363490050)、failure | [PR #186](https://github.com/nannantown/figma-navi-video/pull/186)、07:37:43 JST 作成、未マージ | 当日なし |

GitHub 読み取りの時点で #185/#186 はともに `mergeable=true`、`mergeable_state=clean`、ステータスチェックなし。main は保護なし（branch protection API 404）、rulesets 一覧は空、squash merge は有効。これは Mac の接続ユーザーの調査結果であり、Claude 環境の資格情報・権限が同じであることの証明ではない。

両 PR の `data/jev-episodes.json` は、各当日を指定した既存 `validateEpisodes` に本番 `performance-history.json` を添えても errors/warnings とも空。記事供給不足や原稿の検証失敗ではない。main の同じ検証は 10/09 成功、10/10・10/11・10/12 は `no episode for ...`。

失敗ログも読み取り確認した：

```text
2026-10-10T02:20:05Z Step 1: Generate Data
no episode for 2026-10-10
Process completed with exit code 1
2026-10-11T01:53:28Z Step 1: Generate Data
no episode for 2026-10-11
Process completed with exit code 1
```

両日とも動画生成・投稿には到達していない。スケジュール run の起動は 10/10 11:19 JST、10/11 10:52 JST と予定 08:15 より遅いが、原稿 PR はどちらも先に作られているため、この遅延は今回の原稿欠落の原因ではない。

**未確定**：ルーチンがマージを試みたか、試みた場合に何のエラーで失敗したか。PR の状態だけでは権限・接続・クラウド proxy・コマンド未実行の区別はできない。Claude の当該非公開実行ログ閲覧は、自動承認レビューに「別サービスへの明示承認不足」として拒否された。回避して別経路から読んでいない。ユーザーの当該ログ読み取り許可が必要。

## 修正した欠陥

現行の朝手順には、マージを 3 回失敗しても処理が続き、最後の着弾失敗も WARN の echo（exit 0）になる問題があった。件名の直近 10 commit と日付の grep だけでは、正確な当日原稿の到着も保証できない。

`scripts/deliver-jev.mjs` と朝手順を追加・修正した：

- 既定は読み取りだけ。朝ルーチンが `--merge` を明示した場合だけ、既存の当日原稿 PR を squash merge する。
- 検証済み commit SHA から原稿を読み、既存の内容・順序・重複・主張・履歴・redo の検証を使う。
- 最新の原稿は今日 JST に限定。過去・未来の日付、日付が変わった再試行は拒否。
- repo/main・当日の routine branch・head SHA・対象ファイル（台帳と当日 PDCA）を限定。マージは `--match-head-commit` 付き。
- 反映前に main の台帳が検証時の過去回と完全一致することを確認。別原稿が届いていたら再検証のため停止。
- 最大 3 回の同一 PR 再試行。応答を失っても、PR の merged 状態と main の正確な台帳が確認できれば成功。コマンドの exit 0 だけでは成功にしない。
- 未マージ・着弾相違・読み取り不能は exit 1。PR・SHA と取得できたエラーを報告。`--admin` での保護迂回とブランチ削除を外した。

この修正は未反映を正常終了で隠さず、一時的な反映失敗を再試行する。恒常的な接続・権限問題を直せたとは、実行ログを確認するまで断定できない。

## 未来分の供給と編集方針

既存方針（Jev の特集、6 説明回 → 5 使用例 → 新情報、無い日は根拠のある解説）を維持。新企画・有料 API・Jev キー・SNS 権限の追加は不要。任意の未来原稿の生成や古い原稿の日付変更はしていない。

main の最後は 10/09 の 2-4。未反映の #185/#186 はどちらも別の **2-5** なので、両方を後からまとめてマージしてはいけない。ローカルで両台帳を組み合わせた既存検証も、第2段階終了後にさらに stage 2 が来るエラーになる。過去分は別判断に保留し、未来の朝ルーチンは最新 main の 2-5 枠を当日調査で埋め、その後 stage 3 に進む。

編集方針の未決事項はない。残る判断は、Claude の実行ログ読み取り、判明した反映エラーへの接続修復、本修正の本番反映と翌朝以降の自動供給・公開を許可するか。#185/#186 の扱いは今回に含めない。

## ローカル検証

Node 22.17.0（Mac の `/Applications/Conductor.app/Contents/MacOS/node`）。既存依存を読み取り symlink で再利用し、検証後に symlink は削除した。新しい依存・費用はない。

```text
PATH=/Applications/Conductor.app/Contents/MacOS:$PATH \
  node --experimental-strip-types --test scripts/*.test.mjs
313 tests / 313 pass / 0 fail / 0 skipped
node node_modules/typescript/bin/tsc --noEmit
exit 0
git diff --check
exit 0
```

追加テスト 35 件（反映 helper 28 件、Step 1 隔離実行 7 件）。GitHub 呼び出しは mock、Step 1 は資格情報のない一時フォルダと mock 時刻で実行。欠落日・正常日・未来日・JST 00:00・年越し・閏日・原稿不正・SHA 変更・過去台帳変更・読み取り不能・merge 失敗・偽成功・応答紛失・既存 redo 制約を確認。既存の caption・SNS 安全条件・pickup・シリーズ順序・画像取得なども回帰が通過。

既存 2 件は localhost mock サーバーを使うため、sandbox の listen 拒否を外してテストした。既存 TS 直接 import 用に `--experimental-strip-types` を付けた。投稿や動画 render は実行していない。TAP 証跡は独立コピーの `output/verification/jev-daily-supply-tests.tap`（ignored）に保存。

## 本番反映時の副作用と承認手順

調査基準 main：`b0dca7069f965321e8dd9097aadab79d735ddecb`。修正対象は helper・テスト・手順書・この報告。台帳・履歴・credentials・workflow は変えていない。

| 操作 | 読み取り確認した挙動 |
|---|---|
| 今回のファイルを通常 push / 修正 PR 作成 / main merge | 既存 workflow の push/PR path 条件に該当せず、即時投稿は起動しない |
| `.recovery-trigger` の push | `daily-video.yml`。main は本番、他 branch はサンプル検証 |
| main の `.retry-ig-trigger` の push | `post-today-instagram.yml`、実際の Instagram 投稿 |
| X / Product Hunt の workflow や取得 script 等を変更する PR | 該当する取得検証 workflow が起動（今回は対象外） |
| main に修正を入れた後の既存スケジュール | 07:30 JST の Claude が main の朝手順を読み、当日原稿を反映。その後 `daily-video.yml` cron `15 23 * * *`（08:15 JST、実際には遅延あり）が動画生成・SNS 投稿へ進む |

本番は別承認待ち。安全に承認するための順序：

1. Claude の該当ルーチン実行ログの読み取りを許可し、反映失敗の正確な理由を特定する。接続・権限の変更が必要と分かった場合は、その具体的内容を別承認する。
2. 本差分を review し、**未来日だけの既存 Jev 方針での自動供給と定時公開につながる反映**をユーザーが承認する。朝原稿の作成から動画実行までの時間帯を避け、当日の run 完了後かつ翌 07:30 JST より前に、最新 main を取得して差分を再確認する。
3. 承認後に初めて独立 branch を push → 修正 PR → merge。trigger ファイルや既存の過去原稿 PR は触らない。スケジュール追加・有効化、手動 dispatch、過去日の再実行は不要。
4. 次の自然な朝ルーチンの PR が main に正確に届いたことと、その日だけの定時動画処理を読み取り確認する。

この手順は報告時点で未実行。
