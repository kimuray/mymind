# ADR-0006：SQLite のドライバは node:sqlite を第一候補にする

- ステータス：提案（スパイク待ち：issue 002）
- 日付：2026-09-22

## 背景

当初は better-sqlite3 を想定していました。better-sqlite3 はネイティブモジュールのため、pnpm 10 のインストール時スクリプトの制限、Node のメジャー更新時のABI不一致、ビルドのための通信（サンドボックスの許可ドメイン）といった手間が発生します。一方、Node.js には組み込みの `node:sqlite` があり、Drizzle もこれに対応するドライバを提供しています。

## 比較

| 観点 | node:sqlite | better-sqlite3 |
|---|---|---|
| インストール | 不要（Node に組み込み） | ネイティブビルドまたはバイナリ取得が必要。pnpm 10 ではビルドの許可設定が必要 |
| Node 更新時 | 影響なし | ABI不一致で再ビルドが必要になることがある |
| 成熟度 | Node 24 で Release Candidate 相当。新しいAPIが追加中 | 長年の実績があり安定 |
| Drizzle ORM（実行時） | `drizzle-orm/node-sqlite` で対応 | 対応 |
| drizzle-kit（マイグレーションCLI） | DB接続を伴うコマンドは未対応の報告あり | 対応 |
| 同期API | あり（DatabaseSync） | あり |

## 決定

`node:sqlite` を第一候補とし、スパイク（issue 002）で次を確かめてから確定します。

- `drizzle-kit generate`（DB接続なしでSQLを生成）と、実行時に drizzle-orm のマイグレーターで適用する構成が成り立つか
- WAL モード、`busy_timeout`、`VACUUM INTO`（バックアップ）が使えるか
- Vitest でインメモリDBを使ったテストが問題なく動くか

いずれかが成り立たない場合は better-sqlite3 を採用し、`pnpm-workspace.yaml` でビルドを許可し、必要な通信先をサンドボックスに追加します。どちらを選んでも、DBアクセスは `packages/db` のリポジトリ層に閉じ込め、ドライバの違いを外に漏らしません。

## 結果

node:sqlite を採用できれば、依存関係からネイティブモジュールがなくなり、インストールとNodeの更新が単純になります。Node のエンジン指定は 24 以上を維持します。
