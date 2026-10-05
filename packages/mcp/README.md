# MCP サーバー

ターミナルの Claude Code や Codex から、mymind の記録を参照するための MCP サーバーです（FR-M01〜M03、ADR-0014）。stdio で動き、読み取りの道具だけを出します。タスクや振り返りを書き換える道具はありません。

## 出す道具

| 道具 | 返すもの |
|---|---|
| `get_day` | その日（省くと今日）の計画のタスク、振り返り、記録のまとめ、FB、調子 |
| `get_backlog` | バックログ |
| `get_timeline` | 期間（2週間まで）のタスクの区間と日数の内訳、日ごとの調子 |
| `get_month` | 月の日ごとの調子・完了件数・振り返りと FB の有無、最新の月次総括 |
| `search_tasks` | タスク名の部分一致（新しく作った順に最大50件。振り返りやメモの本文は探さない） |

返す値はサーバーの API の応答そのもので、日数や件数はサーバーが計算した値です。

## 使う前に

MCP サーバーは DB を直接読まず、動いている mymind のサーバーの API を呼びます。先にサーバーを起動しておいてください。サーバーが動いていなければ、道具はそのことを返します。

データディレクトリとポートは、サーバーと同じ環境変数（`MYMIND_DATA_DIR`、既定は `~/.mymind`。`MYMIND_PORT`、既定は 4820）で決めます。セッショントークンはデータディレクトリの `session-token` から読みます。

## 登録のしかた

`/path/to/mymind` はこのリポジトリの場所に置き換えてください。

Claude Code：

```
claude mcp add mymind -- pnpm --silent --dir /path/to/mymind/packages/mcp start
```

Codex（`~/.codex/config.toml`）：

```toml
[mcp_servers.mymind]
command = "pnpm"
args = ["--silent", "--dir", "/path/to/mymind/packages/mcp", "start"]
```

## 送られるデータ

道具で読んだ振り返り、タスク、FB は、呼んだエージェントを通じて AI の提供元（Anthropic や OpenAI）に送られます（NFR-05）。どの道具を呼ぶかで、送る範囲を決めてください。アプリが依頼する FB や総括と違い、送る量の上限や送信内容の確認はありません。
