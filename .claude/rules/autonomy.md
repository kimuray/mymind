---
description: 自律モードのループ、保留の判断、マージの手順、終了時の報告。人の確認を待たずに連続して作業するときに参照する。
---

# 自律モード

エージェントが人の確認を待たずに、issue を順に片付け続けるための約束です。ユーザーが「自律モードで進めて」と指示したとき、または `autopilot` スキルが呼ばれたときに適用します。自律モードでないときは、`.claude/rules/workflow.md` の通常の手順（着手前にユーザーの了承を得る）に従います。

## 基本の考え方

**止まらずに、保留して次へ進む。** 人の判断が必要なことに出会っても、その場で待ちません。質問を issue にコメントし、その issue を保留にして、着手できる別の issue に移ります。

**安全の線は機械が守る。** 何をマージしてよいか、どこに push してよいかは、エージェントの判断ではなく、権限設定（`.claude/settings.json`）、GitHub のブランチ保護、`scripts/merge-if-allowed.mjs` が決めます。エージェントはこれらを回避しようとしません。

## ループ

1. **再開の確認**：`pnpm doctor` を実行し、`docs/progress.md` の直近の記録と、`status:in-progress` の issue を確認する。作業途中の issue があれば、それを先に仕上げる
2. **選ぶ**：`status:ready` の issue から、優先度（p0 → p2）、マイルストーン（M1 → M5）、番号の順に1つ選ぶ。`depends_on` の issue がすべて閉じているか確認する
3. **着手を記録する**：ラベルを `status:in-progress` にし、ブランチを作る
4. **実装する**：`.claude/rules/workflow.md` の手順と AGENTS.md の完了の定義に従う
5. **PR を作る**：タイトルを Conventional Commits の形式にし、本文に `Closes #番号` を書く。`gh pr checks <PR番号> --watch` で `check`・`e2e`・`pr-policy` の結果を待ち、失敗したら直して push し直す
6. **マージを試みる**：`node scripts/merge-if-allowed.mjs <PR番号>` を実行する。レビュー必須の変更を含む場合、スクリプトは `review:required` を付けてマージを拒否するので、その PR は開いたまま次へ進む
7. **依存を確認する**：GitHub では issue が閉じると `issue-deps.yml` が依存先のラベルを自動で更新する。GitHub 登録前（`docs/issues/`）は、閉じた issue を `depends_on` に持つ issue を探し、依存がすべて解消していれば手で `status:ready` に変える
8. **記録する**：`docs/progress.md` に1行追記する（日付、issue、PR、結果、次の予定）
9. 2 に戻る。`status:ready` の issue がなくなったら、下の「終了するとき」に従う

## 保留にするとき

次の場合は、実装を止めて保留にします。保留にしたら、理由と必要な判断を issue にコメントし、ラベルを `status:needs-decision` に変え、ブランチに途中までの作業があれば draft PR として push してから、次の issue に移ります。

- 要件や暫定決定に書かれていない仕様を決める必要がある
- 要件同士、または要件と ADR が矛盾している
- ADR の変更、新しい依存関係の追加、スキーマの大きな変更が必要だと判断した
- 同じ原因で CI が3回続けて失敗し、原因を特定できない
- 実データ、認証情報、外部サービスへのアクセスが必要になった

## レビュー必須の PR に依存する issue

レビュー待ちの PR（`review:required`）の変更が必要な issue は、その PR のブランチを土台にして作業してよいです（PR のベースブランチをそのブランチにする）。ただし、土台の PR が3つ以上積み重なったら、それ以上は積まずに別の issue に移ります。

## してはいけないこと

- `status:needs-decision`、`status:needs-human`、`status:blocked` の issue に着手する
- `gh pr merge` を直接実行する、ブランチ保護やフックを無効化する、`--no-verify` を使う
- テストを消したり弱めたりして CI を通す
- 自分の判断で ADR や requirements.md の決定を書き換える（提案は PR か issue のコメントで行う）
- 暫定決定を「確定」として扱う文言に書き換える

## 終了するとき

着手できる issue がなくなったら、最後に次をまとめて報告して終了します。

- 完了した issue と、マージした PR
- レビュー待ちの PR（`review:required`）
- 保留にした issue と、それぞれ必要な判断
- 人の作業が必要な issue（`status:needs-human`）のうち、着手できれば進む作業が多いもの
