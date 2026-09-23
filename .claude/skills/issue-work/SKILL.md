---
name: issue-work
description: 特定の issue に着手するとき、「issue 19 をやって」と指示されたときに使う。着手の記録、ブランチ作成、実装、pnpm check、PR 作成、マージ判定までを一続きで行う。
---

# issue に着手して PR まで進める

ユーザーが指定した issue（番号。指定がなければ issue-pick で選んだもの）に着手します。以下では <issue番号> と書きます。AGENTS.md の「完了の定義」と .claude/rules/ のルールに従ってください。

1. `gh issue view <issue番号>` で内容を読む。`status:ready` 以外（`needs-decision`、`needs-human`、`blocked`、`provisional`）なら着手せずに理由を報告して終える
2. 着手を記録する：`gh issue edit <issue番号> --add-label "status:in-progress" --remove-label "status:ready" --add-assignee @me`
3. ブランチを作る：`<type>/<issue番号>-<短い英語の説明>`（例：`feat/19-auto-rules`）
4. 計画を issue にコメントしてから実装する。途中で仕様の穴を見つけたら、推測で埋めずに issue にコメントして確認を求める
5. `pnpm check` を通し、必要なら E2E も実行する
6. PR を作る。本文に `Closes #<issue番号>`、要件ID、確認方法を書く（PR テンプレートに従う）
7. CI が通ったら `node scripts/merge-if-allowed.mjs <PR番号>` でマージを試みる。レビュー必須と判定された場合はそのまま開いておく
8. 閉じた issue に依存していた issue のラベルを見直し、`docs/progress.md` に1行追記する
9. 作業中に見つけた別の課題は、新しい issue の案として PR の説明に列挙する（勝手に作らない）
