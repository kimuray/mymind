---
description: 変更の単位、進め方、文書の更新、issue の運用、CI、設計文書の HTML、Docker での開発。作業の段取りを決めるときに参照する。
---

# 作業の進め方

## 変更の単位

1つのブランチ・1つの PR では、1つの要件または1つの改善だけを扱います。ブランチ名は `feat/FR-T06-auto-pause` のように、種別、要件ID、短い説明をつなげます。

## 進め方

1. 対応する要件IDと完了条件を `docs/requirements.md` と `docs/roadmap.md` で確認する
2. 要件が足りない、または曖昧な場合は、実装の前に要件の追加・修正を提案する
3. 設計判断が必要な場合は、ADR の案を書いてから実装する
4. テストを先に書くか、実装と同時に書く
5. `pnpm check` を通す
6. PR の説明に、要件ID、変更内容、確認方法、スクリーンショット（画面を変えた場合）を書く

## 文書の更新

要件の変更は `docs/requirements.md`、設計判断は新しい ADR、画面やキー操作は `DESIGN.md` に、実装と同じ PR の中で反映します。ロードマップの完了条件を満たしたら、`docs/roadmap.md` に完了した日付を追記します。

## プロンプトの変更

`prompts/` のプロンプトを変更したら、先頭のバージョンを上げます。変更の前後で、同じ入力に対する出力例を PR に添付します。

## Issue の運用

課題はすべて GitHub の issue で管理します（GitHub に登録するまでは `docs/issues/`）。人の確認を待たずに連続して進める場合は、`.claude/rules/autonomy.md`（自律モード）に従います。エージェントは、ユーザーから特に指示がなければ、次の手順で取り組む issue を選びます。手順はスキル（`.claude/skills/issue-pick`、`.claude/skills/issue-work`）にもしてあります。

1. `status:ready` の issue だけを候補にする。`status:needs-decision`（人の判断待ち）と `status:blocked`（他の issue 待ち）には着手しない
2. 優先度（`priority:p0` → `p1` → `p2`）、マイルストーン（M1 → M5）、番号の順に選ぶ
3. 選んだ issue と方針を示し、ユーザーの了承を得てから着手する
4. 着手したら `status:in-progress` を付け、完了したら PR で `Closes #番号` として閉じる
5. 作業中に見つけた別の課題は、issue の案として PR に列挙し、ユーザーが登録するか判断する

| ラベル | 意味 |
|---|---|
| `type:feat` / `type:chore` / `type:spike` / `type:decision` | 種類。`decision` は人が決める事項 |
| `priority:p0` / `p1` / `p2` | 優先度 |
| `area:domain` / `db` / `server` / `web` / `agent` / `ops` / `design` / `docs` | 対象の領域 |
| `status:ready` | 着手できる |
| `status:blocked` | 他の issue の完了待ち。依存が解消したら `ready` にする |
| `status:needs-decision` | Yoshihiro の判断待ち。エージェントは着手しない |
| `status:needs-human` | アカウント、認証、実機など人の作業が必要。エージェントは着手しない |
| `status:provisional` | 暫定決定で進めている決定事項。エージェントは暫定決定に従って関連する実装を進めてよい。issue 自体は人がレビューして閉じる |
| `review:required` | 人のレビューが必須の PR。`scripts/merge-if-allowed.mjs` が変更ファイルから自動で付ける |
| `status:in-progress` | 作業中 |

`type:decision` の issue で決定が出たら、決定内容を issue に記録し、requirements.md や ADR に反映する PR を作ってから閉じます。

## CI（GitHub Actions）

| ワークフロー | タイミング | 内容 |
|---|---|---|
| `ci.yml` の `check` | PR と main への push | lint、型チェック、依存方向、デザイントークン、テスト（カバレッジ） |
| `ci.yml` の `e2e` | `check` の成功後 | 本番ビルドに対する E2E（偽のエージェント）。`apps/web` ができるまでは中身を省略して成功扱い |
| `pr-policy.yml` の `pr-policy` | PR の作成・更新・編集 | タイトルが Conventional Commits か、本文が issue を参照しているか。レビュー必須の変更なら `review:required` を付ける |
| `issue-deps.yml` | issue が閉じたとき | 依存していた issue の `status:blocked` を `status:ready` に変え、閉じた issue の `status:in-progress` を外す |
| `dependabot.yml` | 毎週月曜 | 依存関係と Actions の更新 PR（依存関係の変更なのでレビュー必須） |

main の保護で必須にするチェックは `check`、`e2e`、`pr-policy` の3つです（`scripts/github-setup.mjs` が設定します）。PR のタイトルは `feat: 〜 (FR-T06)` のような Conventional Commits の形式にし、本文には `Closes #番号` を書いてください。`pr-policy` が失敗したら、`gh pr edit` でタイトルか本文を直せば再実行されます。

## 設計文書の HTML

設計まわりの文書（`docs/`、`DESIGN.md`、`AGENTS.md`、`prompts/`）は、人が読みやすいように HTML に変換して読みます。**正本は Markdown** です。エージェントは Markdown を読み書きし、HTML は `scripts/docs-build.mjs` が生成します。HTML を手で編集したり、リポジトリにコミットしたりしません（`docs-site/` は .gitignore 済み）。

| コマンド | 内容 |
|---|---|
| `pnpm docs:build` | `docs-site/` に HTML を出力する |
| `pnpm docs:open` | 出力してブラウザで開く |
| `pnpm docs:check` | 出力せずに、リンク切れと、存在しない要件ID・ADR・issue への参照を検査する（`pnpm check` と CI に含まれる） |

HTML では、要件ID（`FR-T06` など）、`ADR-0007`、`issue 034` が自動でリンクになり、要件の表の各行にアンカーが付きます。DESIGN.md の色の値には色見本が表示され、issue のページにはラベルと依存関係がチップで表示されます。

文書を変更したときの流れは次のとおりです。

1. Markdown を編集する。新しいディレクトリへのリンクを張る場合は、そのディレクトリに `README.md`（目次）を置く
2. `pnpm docs:check` を通す（Claude Code では作業終了時のフックでも実行される）
3. PR を作ると、CI の `docs.yml` が HTML を生成し、`design-docs` という名前のアーティファクトとして添付する。レビュー必須の PR では、Yoshihiro はこの HTML で内容を確認する

GitHub Pages で公開する場合は、リポジトリの変数 `DOCS_PAGES` を `true` にすると、main への反映のたびに公開されます。ただし、プランによっては非公開リポジトリの Pages も誰でも閲覧できる状態になるため、公開してよい内容かを確認してから有効にしてください。

## Docker での開発

ホストに Node や Chromium を入れずに開発・検証したい場合は、Docker Compose を使います（ADR-0010）。

| コマンド | 内容 |
|---|---|
| `pnpm docker:dev` | 開発サーバーを起動し、`http://127.0.0.1:5173` で開く |
| `pnpm docker:check` | コンテナ内で `pnpm check` を実行する |
| `pnpm docker:e2e` | コンテナ内で E2E を実行する |
| `pnpm docker:down` / `pnpm docker:reset` | 停止する / 依存関係のボリュームも消して作り直す |

VS Code では「Dev Containers: Reopen in Container」で同じ環境に入れます。lockfile を更新したあとに依存関係がおかしい場合は、`pnpm docker:reset` でボリュームを作り直してください。コンテナの中では実物のエージェント、launchd、通知は使えないため、それらの確認はホストで行います。Linux のホストでバインドマウントの所有者の問題が起きる場合は、ホストのユーザー ID が 1000 であることを確認してください。
