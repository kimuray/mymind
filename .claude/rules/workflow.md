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
6. PR を作る前に、Codex にレビューを依頼して指摘に対応する（下の「Codex のレビュー」）
7. PR の説明に、要件ID、変更内容、確認方法、Codex レビューの指摘と対応、スクリーンショット（画面を変えた場合）を書く

## Codex のレビュー

Claude Code が作った変更は、PR を作る前に Codex にレビューを依頼します（ADR-0013）。別のエージェントの目を通すことで、実装したエージェント自身が見落としやすい誤りを、人のレビューの前に減らすためです。

レビューは1回、修正も1回で終えます。直したあとに再びレビューは依頼しません。

1. 変更をコミットし、`git fetch origin` で main を最新にする
2. `node scripts/codex-review.mjs` を単独で実行する。`origin/main` との差分を、読み取り専用の Codex がレビューし、結果を画面と `.data/reviews/<ブランチ名>.md` に出す。数分かかることがある
3. 指摘を1件ずつ判断する。正しい指摘は直し、誤りや要件・ADR と合わない指摘は、理由を添えて見送る。指摘に従うために要件や設計を変える必要があるときは、自分で決めずに issue で確認を求める
4. 直す指摘をまとめて1回で直し、`pnpm check` をやり直してコミットする
5. PR の「Codex レビュー」の欄に、指摘ごとの対応（直した / 見送った理由）を書く

レビューの観点は次の3つです。指示文は `scripts/codex-review.prompt.md`、出力の形は `scripts/codex-review.schema.json` にあります。

| 観点 | 見ること |
|---|---|
| 正しさ | 要件や ADR との食い違い、境界値、テストの不足、AGENTS.md の「必ず守ること」への違反 |
| セキュリティ | 外部入力の検証、Host・Origin とトークンの確認（ADR-0007）、待ち受けと通信先（NFR-02、NFR-11）、XSS、インジェクション、機微データや秘密情報の扱い（NFR-16、ADR-0009） |
| 非機能 | requirements.md の NFR-xx。性能、応答性、アクセシビリティ、耐久性と復旧、画面間の一貫性、保守性と移植性、AI への送信データ |

指摘には重要度（高・中・低）が付きます。高の指摘は、見送る場合も理由を必ず書きます。

| 終了コード | 意味 | すること |
|---|---|---|
| 0 | 指摘なし | そのまま PR を作る |
| 1 | 指摘あり | 指摘を判断して1回直す |
| 4 | サンドボックスの中で実行された | パイプや `;` を付けずに、単独で実行し直す |
| 5 | Codex を使えない（未インストール、未ログイン、通信エラー、出力の形が違うなど） | 止めずに進め、PR に「未実施」と理由を書く |

Codex が実装した変更では、このレビューを省略します。CI では実行しません（CI で実物の LLM を呼ばないため）。

## 文書の更新

要件の変更は `docs/requirements.md`、設計判断は新しい ADR、画面やキー操作は `DESIGN.md` に、実装と同じ PR の中で反映します。ロードマップの完了条件を満たしたら、`docs/roadmap.md` に完了した日付を追記します。

## プロンプトの変更

`prompts/` のプロンプトを変更したら、先頭のバージョンを上げます。変更の前後で、同じ入力に対する出力例を PR に添付します。

## Issue の運用

課題はすべて GitHub の issue で管理します。人の確認を待たずに連続して進める場合は、`.claude/rules/autonomy.md`（自律モード）に従います。エージェントは、ユーザーから特に指示がなければ、次の手順で取り組む issue を選びます。手順はスキル（`.claude/skills/issue-pick`、`.claude/skills/issue-work`）にもしてあります。

1. `status:ready` の issue だけを候補にする。`status:needs-decision`（人の判断待ち）と `status:blocked`（他の issue 待ち）には着手しない
2. 優先度（`priority:p0` → `p1` → `p2`）、マイルストーン（M1 → M5）、番号の順に選ぶ
3. 選んだ issue と方針を示し、ユーザーの了承を得てから着手する
4. 着手したら `status:in-progress` を付け、完了したら PR で `Closes #番号` として閉じる
5. 他の issue の完了を待つ issue は、本文に `依存: #12, #13` の形の行を1行書き、`status:blocked` を付ける。`issue-deps.yml` はこの行だけを読むので、文章で「#12 に依存する」と書いても自動では `status:ready` にならない
6. 作業中に見つけた別の課題は、issue の案として PR に列挙し、ユーザーが登録するか判断する

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
| `ci.yml` の `check` | PR と main への push | 依存関係の脆弱性（high 以上で失敗）、lint、型チェック、依存方向、デザイントークン、テスト（カバレッジ） |
| `ci.yml` の `e2e` | `check` の成功後 | 本番ビルドに対する E2E（偽のエージェント）。`ci.yml` の `E2E_ENABLED` を `false` にすると、中身を省略して成功扱いになる |
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

開発サーバーは `http://127.0.0.1:5173`（Vite）で開きます。4820 はサーバーの API で、画面の URL を開くと 5173 へリダイレクトします（開発中に古い本番ビルドを出さないため、#97）。

コンテナはチェックアウトの作業ツリーをそのままマウントするので、そこで別のブランチに切り替えると、その内容で動きます。起動時と再起動時に、動かしているブランチとコミットがログに `[docker-dev] ソース：…` の形で出ます。`pnpm-lock.yaml` の中身が変わると（ブランチの切り替えや `git pull`）、`scripts/docker-dev.mjs` が依存関係を入れ直して開発サーバーを再起動します。`Dockerfile` を変えたときは `docker compose up --build dev` でイメージを作り直してください。

VS Code では「Dev Containers: Reopen in Container」で同じ環境に入れます。それでも依存関係がおかしい場合は、`pnpm docker:reset` でボリュームを作り直してください。コンテナの中では実物のエージェント、launchd、通知は使えないため、それらの確認はホストで行います。Linux のホストでバインドマウントの所有者の問題が起きる場合は、ホストのユーザー ID が 1000 であることを確認してください。
