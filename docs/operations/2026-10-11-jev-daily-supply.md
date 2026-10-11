# AI Ground 日次原稿の供給停止 — 2026-10-11 調査と修正

調査基準 main は `b0dca7069f965321e8dd9097aadab79d735ddecb`。元の Mac checkout は変更せず、独立コピーの `fix/jev-daily-supply-20261011` で実装した。ユーザーは 10/11 03:40 UTC に Claude の当該非公開ログの読み取りと、本修正の push・draft PR・レビュー後の merge を承認した。過去原稿 PR の merge、手動 workflow、rerun/backfill、SNS 投稿、資格情報や許可設定の変更は今回に含まない。

## 原因と確定範囲

Claude 朝ルーチンは両日とも原稿を作って PR まで進んだ。停止点は **PR から main への反映**。動画側の当日欠落エラーは、それを正しく検出した。

| 日付 JST | 日次 Actions | 原稿の所在 | main |
|---|---|---|---|
| 10/09 | [37876908988](https://github.com/nannantown/figma-navi-video/actions/runs/37876908988)、success | [PR #184](https://github.com/nannantown/figma-navi-video/pull/184)、07:37:43 JST merge | 2-4 usecase あり |
| 10/10 | [38016528644](https://github.com/nannantown/figma-navi-video/actions/runs/38016528644/job/114107924591)、failure | [PR #185](https://github.com/nannantown/figma-navi-video/pull/185)、07:38:09 JST 作成、未マージ | 当日なし |
| 10/11 | [38103294186](https://github.com/nannantown/figma-navi-video/actions/runs/38103294186/job/114363490050)、failure | [PR #186](https://github.com/nannantown/figma-navi-video/pull/186)、07:37:43 JST 作成、未マージ | 当日なし |

**10/11 の直接原因**：承認された Claude 実行ログを Mac Chrome で読み取り確認した。PR 作成・squash merge の再試行・旧着弾確認・branch 削除をまとめた shell コマンドが、実行前に Claude Code の自動判定に拒否された。判定理由は `Merge Without Review`。その後ルーチンは REST API で PR #186 だけを作成し、main への着弾確認は実行しなかった。最終レポートも未マージと明記した。

ルーチンの最終レポートには `gh pr create` の GraphQL が使えないとの記載もある。実際に確認できた PR 作成は REST API による成功であり、GraphQL エラーの stderr 自体は今回確認していない。新手順は既存認証で REST API を使う。GitHub の token・権限不足や conflict が拒否原因だったという証拠はない。

10/10 は同じ未反映の症状が確認できたが、非公開実行ログを読んでいないため、同じ拒否理由だったとは断定しない。

GitHub 読み取り時点で #185/#186 は `mergeable=true`、`mergeable_state=clean`、チェックなし。main は保護なし（branch protection API 404）、rulesets は空、squash merge 有効。これは Mac の接続ユーザーでの読み取り結果であり、Claude 環境との資格情報・権限の同一性を証明するものではない。

両 PR の台帳は各当日を指定した既存 `validateEpisodes` に main の `performance-history.json` を添えても errors/warnings とも空。main は 10/09 成功、10/10・10/11・10/12 は `no episode for ...`。記事や原稿の不足ではなく、承認手順を満たさず main に届けられなかったことが問題だった。

失敗ログは 10/10 02:20:05 UTC、10/11 01:53:28 UTC とも Step 1 Generate Data で当日なし・exit 1。動画生成・投稿には未到達。予定 08:15 JST に対して run は 11:19 / 10:52 JST に遅れて起動したが、原稿 PR は先に作られており、この遅延は原稿欠落の原因ではない。

## 修正

- 朝手順を REST の PR 作成 → **完全な差分と調査した出典の実際のレビュー** → 別の読み取りで直前再確認 → 独立した SHA 固定の merge → main の照合に分けた。レビュー結果には PR 番号・SHA・根拠・問題を明記する。helper の成功や「OK」という自己申告をレビューの代用にしない。
- 自動判定が拒否したら停止して報告する。merge を wrapper に隠す、他の API に置き換えて拒否を回避する、認証・許可設定を変更する、保護を管理者権限で迂回する方法は使わない。
- `scripts/deliver-jev.mjs` は **GET のみ**。既定は merged 状態と main の完全な台帳一致を確認。未マージ・相違・読み取り不能は exit 1。`--prepare` は候補確認だけで、未マージなら「未配送・レビューが必要」と返す。merge を行うオプションはない。
- 既存の内容・順序・重複・主張・履歴・redo 検証を使う。最新原稿は今日 JST のみ。過去・未来日付、読み取り中の JST 日付変更は拒否する。
- repo/main・当日の routine branch・検証済み 40 桁 head SHA・対象ファイル（台帳と当日の PDCA）を限定。準備時は main と候補の過去台帳が完全一致することも確認する。
- 同日再開は同じ PR を使う。merged 済みなら再マージせず照合する。main/SHA が変わったら再検証・再レビュー。応答を失った書き込みも、再試行前に実際の状態を読む。

未反映を WARN/exit 0 で見逃す従来の件名・日付 grep を外した。コードは権限拒否を解消するための迂回ではなく、実際のレビューを行う手順と配送失敗の検出を追加する。

## 未来分の供給と編集方針

既存方針（Jev 特集、6 説明回 → 5 使用例 → 新情報、無い日は根拠のある解説）を維持。新企画・有料 API・Jev キー・SNS 権限の追加は不要。古い記事の日付変更、未来原稿の先行生成、架空情報の補充はしない。

main の最後は 10/09 の 2-4。未反映の #185/#186 は異なる内容の **2-5**。両台帳を組み合わせたローカル検証も、第2段階終了後にさらに stage 2 が来るエラーになるため、過去 PR はまとめて merge しない。未来の朝ルーチンは最新 main の 2-5 枠を当日調査で埋め、その後 stage 3 に進む。未確定の新しい企画判断はない。

**未検証の条件**：修正後の自然な朝ルーチンが、レビュー済みの単独 merge を Claude 自動判定で許可され、08:15 の動画処理前に main へ届くか。Mac の fix PR merge 成功だけではこのクラウド実運転の証明にならない。拒否が続くなら、拒否文とレビュー証跡をユーザーに返し、環境・運用に必要な変更を別途判断する。今回新しい権限設定は行わない。

## 検証

Node 22.17.0。既存依存を読み取り symlink で再利用し、検証後に symlink は削除。新規依存・費用なし。

```text
PATH=/Applications/Conductor.app/Contents/MacOS:$PATH \
  node --experimental-strip-types --test scripts/*.test.mjs
311 tests / 311 pass / 0 fail / 0 skipped
node node_modules/typescript/bin/tsc --noEmit
exit 0
git diff --check
exit 0
```

追加 33 件（配送確認 26 件、Step 1 隔離実行 7 件）。GitHub は mock GET のみ、Step 1 は資格情報のない一時フォルダ・mock 時刻で実行。欠落日・正常日・未来日・JST 00:00・年越し・閏日・原稿不正・SHA 変更・過去台帳変更・別 repo・対象外ファイルと rename・読み取り失敗・未マージ・main 相違・旧 merge オプション拒否・既存 redo 制約を確認。既存の caption・SNS 安全条件・pickup・シリーズ順序・画像取得なども回帰が通過。

既存の localhost mock サーバーのテストは sandbox の listen 許可付きで実施。既存 TS の直接 import 用に `--experimental-strip-types` を指定。投稿・TTS・動画 render は実行していない。TAP 証跡は独立コピーの `output/verification/jev-daily-supply-tests.tap`（ignored）。

## 反映の副作用と残る確認

修正対象は helper・テスト・手順書・この報告の 6 ファイル。台帳・履歴・credentials・workflow・trigger は変更しない。

| 操作 | 読み取り確認した挙動 |
|---|---|
| 今回の branch push / 修正 PR / main merge | workflow の push/PR path 条件に該当せず、即時の動画・SNS 投稿は起動しない |
| `.recovery-trigger` の push | `daily-video.yml`。main は本番、他 branch はサンプル検証 |
| main の `.retry-ig-trigger` の push | `post-today-instagram.yml`、実際の Instagram 投稿 |
| X / Product Hunt 取得の workflow・script 等を変更する PR | 取得の検証 workflow が起動（今回は対象外） |
| 修正反映後の既存スケジュール | 07:30 JST の Claude が main の朝手順を読み、当日原稿をレビュー・反映。その後 cron `15 23 * * *`（08:15 JST、遅延あり）が動画生成・SNS 投稿に進む |

ユーザー承認済みの順序は、当日の動画 run 完了後かつ翌 07:30 JST より前に、最新 main 再確認 → 修正 branch push → draft PR → 完全な差分レビュー → 問題がなければ ready / merge。過去 #185/#186、trigger、スケジュール設定、手動 dispatch は触らない。

次の自然な朝ルーチンの配送結果と、その当日だけの定時動画処理は実運転後の読み取り確認が必要。この報告自体は未来の公開成功を示すものではない。反映した PR と merge SHA は作業完了報告に記録する。
