# instagram-agent-skill-ja（同梱）

AI Ground の見せ方の試行（2026-11-02 オーナー決定。`docs/ig-skill-format.md`）で使う、Instagram 用の Claude Code スキル。

- 出どころ: https://github.com/ya-a11y/instagram-agent-skill-ja のコミット `0e7ac86402817fe54a170f7b62e9070f53a63184`（2026-10-29）。13 個のうち 4 つ（`ig-reel` / `ig-caption` / `ig-human` / `ig-profile`）をそのまま写した（中身は変えていない）
- ライセンス: MIT（[LICENSE-instagram-agent-skill-ja](LICENSE-instagram-agent-skill-ja)。Copyright (c) 2026 Jake Schincariol / あるまん）
- 道具は Python 3 の標準機能だけで動き、ネットにつながない。無料・鍵なし。スキル自体は投稿しない
- 各 SKILL.md は話し方の設定を `~/.claude/instagram/voice.md` から読む。このリポでは **`docs/ig-voice.md` が正本**。朝ルーチンは最初に `mkdir -p ~/.claude/instagram && cp docs/ig-voice.md ~/.claude/instagram/voice.md` で写してから使う
- このリポでの回し方（点数をまとめて付けて原稿に残す）: `node scripts/ig-craft.mjs`
- 更新するときは、新しいコミットを同じ 4 つのフォルダに写し、このファイルと `scripts/ig-craft.mjs` の `SKILL_VERSION` を直す（`jp.py` は 3 つのフォルダに同じものがある）
