# ADR-0005：エージェントCLIの起動方法をスパイクで確定する

- ステータス：採用（スパイク：issue 001 / #10、2026-10-04）
- 日付：2026-09-22

## 背景

ADR-0003 で、FB生成ではエージェントを決まった入出力で起動すると決めました。しかし、Claude Code と Codex をヘッドレスで起動するときの具体的なフラグ、ツールを無効化する方法、構造化出力の指定方法、ログイン状態の検出方法は、どちらも更新が速く、推測で実装すると動かない可能性が高い部分です。

## 決定

M3 の実装に入る前に、スパイク（issue 001）で次を実機で確かめ、その結果でこのADRを「採用」に更新します。

- ヘッドレス起動のコマンドとフラグ（標準入力でプロンプトを渡す方法、出力形式の指定）
- ツールの使用とファイル書き込みを確実に無効化する設定と、その確認方法
- ログインしていない、利用上限に達した、バージョンが古い、といった状態の検出方法と終了コード
- 1回の生成にかかる時間の目安（タイムアウトの初期値を決める材料）
- launchd から起動したサーバーの子プロセスとして動かしたときの `PATH` と認証情報（issue 003 と合わせて確認）

## 結果

スパイクの成果物として、`packages/agent` に各アダプタの最小実装と、実際の出力を保存した fixture を残します。スパイクで分かった制約は、このADRの「決定」に追記します。

## スパイクの結果（2026-10-04 追記）

Claude Code（Pro のアカウントでログイン）と codex-cli 0.160.0（ChatGPT のアカウントでログイン）で、`prompts/daily-feedback.md` の入力を実行し、どちらも本番の検証（`parseDailyFeedback`）を通る出力を得ました。実際の出力は `packages/agent/fixtures/` の `claude-*`、`codex-*` に残しています。

### 確定した起動方法

どちらも、空の一時ディレクトリを作業ディレクトリにし、プロンプトを標準入力で渡します。リポジトリの `CLAUDE.md` / `AGENTS.md` や設定を読ませないためです。環境変数からは `ANTHROPIC_API_KEY` と `OPENAI_API_KEY` を外し、ログインしたアカウント（プランの利用枠）で動かします。API キーがあると、プランがあっても従量課金になるためです。

| | Claude Code | Codex |
|---|---|---|
| 起動 | `claude -p` | `codex exec -` |
| ツール | `--tools ""` ですべて無効 | `-s read-only` に加えて、`-c features.<名前>=false` で `shell_tool`、`unified_exec`、`browser_use`、`browser_use_external`、`computer_use`、`apps`、`plugins`、`image_generation`、`multi_agent` を無効 |
| 設定・MCP | `--setting-sources ""`、`--strict-mcp-config` | ユーザーの設定（`~/.codex/config.toml`）は読む |
| 構造化出力 | `--output-format json --json-schema <スキーマ>`。FB は結果の `structured_output` | `--output-schema <ファイル> --output-last-message <ファイル>`。FB は最後の返答のファイル |
| モデル | 指定しなければ CLI の既定 | `-m` で指定できる（`MYMIND_AGENT_MODEL`） |
| 失敗の判定 | 終了コードが 0 以外か、結果の `is_error` | 終了コードが 0 以外か、最後の返答が空。理由はログの `ERROR:` の行 |
| 1回の時間 | 15〜20 秒 | 約 22 秒 |

構造化出力のスキーマは `dailyFeedbackSchema` から draft-07 で作り、`"$schema"` を外して渡します。Claude Code は 2020-12 の `"$schema"` を解釈できずに止まります（anthropics/claude-code #80402）。

### 分かった制約

- **`claude --bare` は使わない**：ログイン（OAuth）とキーチェーンを読まず、`ANTHROPIC_API_KEY` だけで認証するため、プランの利用枠で動かせない。代わりに `--setting-sources ""` と `--strict-mcp-config` と空の作業ディレクトリで設定やフックを読ませない。ユーザー全体の `~/.claude/CLAUDE.md` は読まれうる
- **Codex の `-s read-only` は書き込みしか止めない**：スパイクでは、読み取りのコマンド（`rg` でホームディレクトリ全体を検索）を実行した。コマンドの実行を止める機能（`shell_tool`、`unified_exec`）を無効にすると、コマンドを1つも実行しなくなった。機能の名前は版で変わりうるので、確かめた版（`CODEX_TESTED_VERSION`）と違う版を使うときは、`codex features list` で止める機能を確かめ直す
- **Codex のモデル**：設定ファイルで ChatGPT のアカウントでは使えないモデル（`gpt-5-codex`）に固定されていると、400 のエラーになる。codex-cli 0.41.0 ではエラーでも終了コードが 0 だった
- **ツールを止めても、ツールを使ったと言うことがある**：ファイルの作成を頼むと、Claude Code は作っていないのに「作成しました」と返した。FB は構造化出力（JSON）だけを使い、それ以外の文章は捨てる
- **プロンプトがファイルを指すと、エージェントは探しに行く**：`prompts/daily-feedback.md` の「`prompts/coaching-policy.md` の方針に従って」を見て、Codex が方針のファイルを探した。方針の中身をプロンプトに含める（#22）

### 検証できなかった項目

- ログインしていない状態、利用上限に達した状態、古い版の Claude Code での終了コードと出力。何らかのエラーになる前提で、終了コードと `is_error` で失敗として扱い、ログインの確認を促す理由を出す
- launchd から起動したサーバーの子プロセスとして動かしたときの `PATH` と認証情報（#12 で確かめる）

