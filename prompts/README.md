# FB の方針とプロンプト

| 文書 | 内容 |
|---|---|
| [coaching-policy.md](./coaching-policy.md) | すべてのプロンプトが従う、コーチとしての振る舞いの方針（変更は Yoshihiro が判断） |
| [daily-feedback.md](./daily-feedback.md) | 日次 FB のプロンプト（1.0.0、#22 の評価で確定）。読み込むときに `{{coaching_policy}}` へ方針の本文を差し込む |
| [monthly-summary.md](./monthly-summary.md) | 月次総括のプロンプト（0.1.0、下書き。評価は #140）。日次 FB と同じく `{{coaching_policy}}` に方針の本文を差し込む |
| [eval/](./eval/README.md) | 日次 FB のプロンプトの評価用サンプルと、評価の結果 |

プロンプトを変えたら先頭のバージョンを上げ、変更の前後の出力例を PR に添付します（.claude/rules/workflow.md）。
