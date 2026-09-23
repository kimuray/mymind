@AGENTS.md

## Claude Code 向けの補足

- ファイルを編集すると、フック（`.claude/hooks/post-edit.sh`）が Biome で自動整形と lint を行います。エラーが返ってきたら、その場で修正してください
- 作業を終えようとすると、フック（`.claude/hooks/stop-check.sh`）が型チェック、依存方向、デザイントークン、変更に関係するテストを実行します。失敗した場合は修正してから終えてください
- Bash コマンドはサンドボックスの中で実行されます。書き込めるのはリポジトリ内（と pnpm のストア、Playwright のブラウザキャッシュ）だけで、通信できるのは npm レジストリ、GitHub、Playwright の配布元だけです。サンドボックスで失敗したコマンドを外で再実行する場合は、必ず理由を説明してユーザーの承認を得てください
- `gh` は認証情報（`~/.config/gh` とキーチェーン）を読むため、サンドボックスの外で実行する設定（`excludedCommands`）にしています。ただし外で実行されるのは、コマンド全体が `gh`（と除外済みのコマンド）だけでできている場合に限ります。パイプ（`| head`）、`$(...)`、ヒアドキュメント、他のコマンドとの `&&` を含めるとサンドボックスの中で実行され、`failed to read configuration` で失敗します。`gh` は単独で実行し、絞り込みは `--json` と `--jq`、PR や issue の本文は `$TMPDIR` にファイルを書いてから `--body-file` で渡してください
- 権限は `.claude/settings.json` で管理しています。依存関係の追加、push、PR の作成、エージェントの起動は確認を求められます
- 複数のパッケージにまたがる変更や、要件・設計に関わる変更は、先に計画を示してから着手してください
- ルールは `.claude/rules/` にあります（coding / architecture / testing / ui / workflow / autonomy）。実装の前に、対象に合うものを読んでください
- 手順はスキルとして `.claude/skills/` にあります。次の課題を選ぶときは `issue-pick`、着手して PR まで進めるときは `issue-work`、人の確認を待たずに連続して進めるときは `autopilot` を使ってください
- 画面を実装するときは、Figma「mymind view design」（fileKey `VLCoEFLm1ujvYPq8xyEQFg`）の該当フレームを `get_design_context` で確認します。どのフレームを見るかは `docs/design/README.md` にあります
