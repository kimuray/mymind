@AGENTS.md

## Claude Code 向けの補足

- ファイルを編集すると、フック（`.claude/hooks/post-edit.sh`）が Biome で自動整形と lint を行います。エラーが返ってきたら、その場で修正してください
- 作業を終えようとすると、フック（`.claude/hooks/stop-check.sh`）が型チェック、依存方向、デザイントークン、変更に関係するテストを実行します。失敗した場合は修正してから終えてください
- Bash コマンドはサンドボックスの中で実行されます。書き込めるのはリポジトリ内（と pnpm のストア、Playwright のブラウザキャッシュ）だけで、通信できるのは npm レジストリ、GitHub、Playwright の配布元、Aikido Safe Chain のマルウェア一覧（`malware-list.aikido.dev`）だけです。Safe Chain は `pnpm` を包んで、インストールの前に既知のマルウェアと照合します。一覧を取得できないと古い一覧で照合するので、このドメインは外さないでください。サンドボックスで失敗したコマンドを外で再実行する場合は、必ず理由を説明してユーザーの承認を得てください
- `gh` は認証情報（`~/.config/gh` とキーチェーン）を読むため、サンドボックスの外で実行する設定（`excludedCommands`）にしています。ただし外で実行されるのは、コマンド全体が `gh`（と除外済みのコマンド）だけでできている場合に限ります。パイプ（`| head`）、`$(...)`、ヒアドキュメント、他のコマンドとの `&&` を含めるとサンドボックスの中で実行され、`failed to read configuration` で失敗します。`gh` は単独で実行し、絞り込みは `--json` と `--jq`、PR や issue の本文は `$TMPDIR` にファイルを書いてから `--body-file` で渡してください
- `git push` も、SSH の鍵（`~/.ssh`）を使うためサンドボックスの外で実行する設定にしています。`gh` と同じく、単独で実行してください。force push と main への push は `permissions.deny` で禁止したままです。`git fetch` と `git pull` も同じ理由で、サンドボックスの外で実行します
- `node scripts/merge-if-allowed.mjs <PR番号>` と `node scripts/github-setup.mjs` も、中で `gh` を呼ぶためサンドボックスの外で実行する設定にしています。`gh` と同じく単独で実行してください。終了コード（0 / 2 / 3）は Bash ツールの結果に表示されるので、`; echo $?` や `2>&1` を付ける必要はありません。付けるとサンドボックスの中で実行され、終了コード 4 で止まります
- PR を作る前の Codex のレビュー（`node scripts/codex-review.mjs`）も、`~/.codex` の認証情報を読むためサンドボックスの外で確認なしに実行する設定にしています。単独で実行し、数分かかるので Bash のタイムアウトを 600000 にしてください。手順は `.claude/rules/workflow.md` の「Codex のレビュー」にあります
- E2E（`pnpm test:e2e`、`pnpm exec playwright test`）と `pnpm screenshots` は、サンドボックスの中で実行します。サンドボックスは Mach サービスの登録を禁じていて、Chromium は普通に起動すると子プロセスとの通信の準備で落ちます（#15）。そのため `SANDBOX_RUNTIME=1` のときだけ、`--single-process` で起動し、1つのブラウザコンテキストをテスト間で使い回します（`playwright.config.ts` の `reuseContext`）。使い回しても Cookie やストレージは Playwright がテストごとに消しますが、CDP で直接変えた設定は残るので、テストの後で戻してください（`e2e/accessibility.spec.ts`）。ポート 4820 で開発サーバーが動いていると E2E はそれを使ってしまうので、そのときは `MYMIND_E2E_PORT` で別のポートを指定してください
- サンドボックスの中からは `.git/config` に書き込めません。`git switch -c <名前> origin/main` はブランチの追跡設定を書き込むところで失敗し、ブランチが切り替わらないまま進んでしまいます。ブランチは `git switch --no-track -c <名前> origin/main` で作り、追跡の設定は最初の `git push -u` に任せてください
- 権限は `.claude/settings.json` で管理しています。依存関係の追加、push、PR の作成、エージェントの起動は確認を求められます
- 複数のパッケージにまたがる変更や、要件・設計に関わる変更は、先に計画を示してから着手してください
- ルールは `.claude/rules/` にあります（coding / architecture / testing / ui / workflow / autonomy）。実装の前に、対象に合うものを読んでください
- 手順はスキルとして `.claude/skills/` にあります。次の課題を選ぶときは `issue-pick`、着手して PR まで進めるときは `issue-work`、人の確認を待たずに連続して進めるときは `autopilot` を使ってください
- 画面を実装するときは、Figma「mymind view design」（fileKey `VLCoEFLm1ujvYPq8xyEQFg`）の該当フレームを `get_design_context` で確認します。どのフレームを見るかは `docs/design/README.md` にあります
