# ADR-0016：Electron の版、サーバーの束ね方、エージェントの PATH（ADR-0015 の spike の結果）

- ステータス：採用
- 日付：2026-10-05

## 背景

ADR-0015 は、デスクトップアプリを作る前に3点を spike で確かめると決めました（#205）。`node:sqlite` が使えるか、GUI から起動したアプリでエージェントの CLI が動くか、`.app` から成果物を読めるか、です。この ADR はその結果と、結果から決めたことの記録です。

## 確かめたこと

| 項目 | 結果 |
|---|---|
| Electron の版 | 44.5.1。同梱の Node.js は 24.21.0（Chromium 152）で、`engines` の `node >=24` と開発環境の Node.js と同じ版 |
| `node:sqlite` | Electron の Node.js で、WAL、トランザクション、`VACUUM INTO` が動いた。メインプロセスでも `DatabaseSync` を開けた |
| 子プロセス（`utilityProcess`） | 起動できた。ただし `execArgv: ['--import', 'tsx']` は効かず、Node.js の型の除去だけで TS を読んだため、拡張子のない import（`./claude`）で止まった |
| サーバーを束ねる | Vite の SSR ビルド（`apps/web` がすでに使っている Vite）で `apps/server/src/main.ts` を1つの ESM ファイルに束ね、Node.js で起動して、API と画面の両方が返ることを確かめた |
| 成果物の場所 | 画面のビルド（`main.ts` の `WEB_DIST`）、プロンプト（`prompts.ts`）、マイグレーション（`packages/db` の `MIGRATIONS_FOLDER`）は、ソースのファイルからの相対で決まっている。束ねると場所がずれる |
| GUI から起動したときの PATH | Finder や Dock から開いたアプリの PATH は `/usr/bin:/bin:/usr/sbin:/sbin` で、`claude` も `codex` も見つからない。ログインシェル（`$SHELL -ilc`）の PATH にも、`~/.local/bin`（`claude` の場所）が入らないことがあった。ターミナルで使うシェル（fish）とログインシェル（zsh）が違い、`~/.local/bin` を fish の設定でだけ足していたため |
| Electron の本体の取得 | `electron` のインストール時のスクリプトで、GitHub のリリース（`release-assets.githubusercontent.com`）から落とす |
| Claude Code のサンドボックス | Electron は、起動時に Mach サービスを登録できずに落ちる（Chromium と同じ、#15）。`--single-process` にすると子プロセスを作れないので、サーバーを子プロセスで動かす構成は確かめられない |

束ねたサーバーを Electron の子プロセスで動かすことは、サンドボックスの外での実行が必要なため、この spike では確かめていません。殻の issue（#206）で、CI の上で確かめます。

## 決定

**Electron は 44 系を使う。** 同梱の Node.js が開発環境と同じ 24 系なので、`node:sqlite` の挙動の違いを気にせずに済みます。Electron の版を上げるときは、同梱の Node.js の版を確かめます。

**サーバーは Vite の SSR ビルドで1つの JS ファイルに束ね、子プロセスで動かす。** 依存関係を新しく足さずに済みます。Node.js の組み込みモジュールは束ねず、ほかの依存関係（Hono、Drizzle、zod など）は束ねます。開発時（`pnpm desktop:dev`）も、束ねたファイルを動かします（`tsx` を子プロセスで使えないため）。

**成果物の場所は、起動するときに渡す。** サーバーは、画面のビルド、プロンプト、マイグレーションの場所を環境変数で受け取れるようにします。渡されなければ、今のソースからの相対の場所を使います。デスクトップアプリは `.app` の中の場所を渡します。

**エージェントの PATH は、ログインシェルの PATH によく使われる場所を足して作る。** デスクトップアプリは起動時に `$SHELL -ilc` で PATH を読み、`~/.local/bin`、`~/.asdf/shims`、`/opt/homebrew/bin`、`/usr/local/bin` などを足して、サーバーの子プロセスに渡します。見つからなければ、設定の状態（NFR-21）にこれまでどおり「見つかりません」と出ます。それでも足りなければ、CLI の場所を設定で指定できるようにすることを、別の issue で検討します。

**`.app` は `@electron/packager` で作る。** 当面の配布は自分用の署名なしのビルドなので（ADR-0015）、インストーラーや自動更新を持つ electron-builder は要りません。`@electron/packager` は Electron の公式の道具で、`.app` を作るだけの機能に絞られています。追加は配布の issue（#211）で行います。

**Electron の本体の取得とサンドボックスの扱いを決める。**

- `pnpm-workspace.yaml` の `onlyBuiltDependencies` に `electron` だけを書き、インストール時のスクリプトを許可します。ほかの依存関係（esbuild など）の扱いは #15 で決めます
- Claude Code のサンドボックスの中で本体を落とすときは、`release-assets.githubusercontent.com` への通信を許可し、`NODE_USE_ENV_PROXY=1`（Node.js の `fetch` にプロキシを使わせる）と、`electron_config_cache` をリポジトリの `.data` に向ける指定で実行します（手順は CLAUDE.md）。CI（GitHub Actions）では、特別な指定なしに `pnpm install` で落とせます
- Electron を起動する確かめは、Claude Code のサンドボックスの中ではできません。エージェントは、Electron に依存しない部分を単体テストで確かめ、Electron の起動は CI（Linux、仮想ディスプレイ）で確かめます。手元で起動するときは、人が承認してサンドボックスの外で実行します

## 結果

- `apps/desktop` に `electron` を開発用の依存として加えました（この spike の PR。依存関係の追加なので、人のレビューが必須です）
- 殻の issue（#206）で、サーバーが成果物の場所を環境変数で受け取れるようにし、Vite の SSR ビルドで束ねる設定を足します
- Electron の起動を CI で確かめる issue（#210）は、殻を確かめる手段になるので、殻と同時に進めます
- `.app` の中で成果物を読めるかは、配布の issue（#211）で、`@electron/packager` で作った `.app` を CI と実機で確かめます
