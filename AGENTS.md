# AGENTS.md

このファイルは、mymind のリポジトリで作業するAIエージェント（Claude Code、Codex など）への指示です。人間の開発者にもそのまま当てはまります。

## プロジェクトの概要

mymind は、日々のTODOと振り返りを管理し、ローカルのAIエージェントからフィードバックを受け取る個人用ツールです。PC上のNode.jsサーバーを `127.0.0.1` で動かし、ブラウザから使います。

## 作業を始める前に読むもの

| 目的 | 文書 |
|---|---|
| 何を作るか | `docs/requirements.md`（要件ID：`FR-xx` / `NFR-xx`） |
| どう作るか | `docs/architecture.md` |
| 見た目とキー操作 | `DESIGN.md` |
| 今どこを作っているか | `docs/roadmap.md` |
| なぜそう決めたか | `docs/adr/` |
| 守るルール | `.claude/rules/`（coding / architecture / testing / ui / workflow / autonomy） |
| 画面の構成 | Figma「mymind view design」（fileKey `VLCoEFLm1ujvYPq8xyEQFg`）。どのフレームを見るかと手順は `docs/design/README.md`。接続できないときは `docs/design/mockup-source/` |
| 暫定決定 | `docs/requirements.md` 5章（エージェントはこれに従って実装してよい） |
| 作業記録 | `docs/progress.md` |
| FB の方針 | `prompts/coaching-policy.md` |

タスクに対応する要件IDを最初に特定してください。要件IDが見つからない変更は、実装する前に `docs/requirements.md` への追加を提案してください。

## 作業の開始と再開

セッションを始めたとき、またはコンテキストが途切れて再開するときは、最初に次を行ってください。

1. `pnpm doctor` で環境を確認する
2. `docs/progress.md` の直近の記録を読む
3. `status:in-progress` の issue があれば、それを先に仕上げる

## 自律モード

ユーザーが「自律モードで進めて」と指示した場合、または `autopilot` スキル が実行された場合は、`.claude/rules/autonomy.md` に従い、着手前の了承を求めずに issue を順に片付けます。人の判断が必要になったら、待たずに保留にして次へ進みます。マージは `node scripts/merge-if-allowed.mjs` だけを使います。

## 取り組む課題の選び方

特に指示がなければ、GitHub の issue（登録前は `docs/issues/`）から `status:ready` のものを選びます。選び方と着手の手順は `.claude/rules/workflow.md` の「Issue の運用」に従ってください。`status:needs-decision` の issue には着手しないでください。未決定の事項の一覧は `docs/open-questions.md` にあります。

## リポジトリの構成

```
apps/server     API、静的配信、ジョブランナー、スケジューラ、通知
apps/web        画面、キーボード操作、Mame コンポーネント
packages/domain 状態遷移、業務日、自動ルール、集計（純粋関数）
packages/db     Drizzle スキーマ、マイグレーション、リポジトリ
packages/agent  エージェント起動アダプタ、入力の組み立て、出力の検証
packages/mcp    対話用 MCP サーバー
prompts/        FB と総括のプロンプト（バージョン付き）
e2e/            Playwright の E2E テスト
```

## コマンド

| コマンド | 内容 |
|---|---|
| `pnpm install` | 依存関係のインストール |
| `pnpm dev` | 開発サーバーの起動（偽のエージェントを使う場合は `MYMIND_AGENT=fake`） |
| `pnpm lint` / `pnpm lint:fix` | Biome による lint と format の確認 / 自動修正 |
| `pnpm typecheck` | 全パッケージの型チェック |
| `pnpm deps:check` | パッケージ間の依存方向の検証 |
| `pnpm design:check` | デザイントークン以外の色の直書きを検出 |
| `pnpm test` | 単体テストと結合テスト |
| `pnpm test:e2e` | E2E テスト |
| `pnpm docs:check` / `pnpm docs:build` | 設計文書のリンク・参照の検査 / 人が読むための HTML の生成 |
| `pnpm check` | 上記のうち E2E 以外をすべて実行 |
| `pnpm doctor` | 開発環境の前提を確認 |
| `pnpm docker:dev` / `docker:check` / `docker:e2e` | Docker で開発サーバー / チェック / E2E を実行（ADR-0010。実行には承認が必要） |

## 完了の定義

変更を「完了」と報告する前に、次をすべて満たしてください。

1. `pnpm check` が通る
2. 挙動を変えた場合、その要件IDを名前に含むテストを追加または更新している
3. 画面やキー操作を変えた場合、`DESIGN.md` を同じ変更の中で更新している
4. 設計文書を変えた場合、`pnpm docs:check` が通っている（HTML は生成物なのでコミットしない）
5. 要件や設計判断を変えた場合、`docs/requirements.md` の更新または新しいADRの追加をしている
6. 変更の要約に、対応する要件IDと、確認した方法（実行したテストやコマンド）を書いている

テストを通すためにテストを削除したり、`skip` にしたり、期待値を実装に合わせて書き換えたりしないでください。テストが間違っていると判断した場合は、理由を説明して確認を求めてください。

## 必ず守ること

- 状態の変更（タスクのステータス、計画への出し入れ）は、必ず `packages/domain` の関数を経由させる。`tasks.status` を直接更新しない
- `packages/domain` は他のパッケージ、Node.js の API、DB、HTTP に依存させない。現在時刻は引数で受け取る
- 外部から入ってくるデータ（HTTP リクエスト、エージェントの出力、設定ファイル）は zod で検証してから使う
- 色、角の丸み、余白、書体は `DESIGN.md` のトークンを使う。値を直書きしない
- AI に数値を計算させない。件数や日数はコードで計算して渡す
- 仕様の穴を見つけたら、推測で埋めずに issue にコメントして確認を求める
- `prompts/coaching-policy.md` の方針を変えない。プロンプトの改善は方針の範囲内で行う

## してはいけないこと

- 実データのディレクトリ（`~/.mymind/`）を読んだり、書き換えたりしない。開発とテストでは `MYMIND_DATA_DIR=./.data` を使う
- `sqlite3` などで DB ファイルを直接操作しない。スキーマの変更は Drizzle のマイグレーションで行う
- `.env` や秘密情報を読まない、出力しない、コミットしない
- 既存の ADR の本文を書き換えない。判断を変えるときは新しい ADR を追加し、古い ADR のステータスだけを更新する
- CI で実物の LLM やエージェントを呼ぶテストを書かない
- 依頼されていない大規模なリファクタリングや依存関係の追加をしない。必要だと考えた場合は提案にとどめる

## 書き方の約束

コードの識別子は英語、コメント・ドキュメント・画面の文言は日本語で書きます。コミットメッセージは Conventional Commits の種別（`feat:` `fix:` `docs:` `test:` `refactor:` `chore:`）に続けて日本語で要約し、関係する要件IDを末尾に括弧で付けます。例：`feat: 着手中のタスクをバックログへ移すと中断にする (FR-T06)`
