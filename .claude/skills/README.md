# スキル（エージェントの手順）

エージェントが繰り返し使う手順を、Claude Code のスキルとして置いています。ルール（`.claude/rules/`）が「守ること」、スキルが「やり方」です。

| スキル | 使う場面 |
|---|---|
| [issue-pick](./issue-pick/SKILL.md) | 次に取り組む課題を選ぶとき |
| [issue-work](./issue-work/SKILL.md) | 特定の issue に着手して PR まで進めるとき |
| [autopilot](./autopilot/SKILL.md) | 人の確認を待たずに、issue を連続して片付けるとき |

Codex など Claude Code 以外のエージェントは、スキルとして自動では読み込まれません。AGENTS.md の指示に従い、必要な SKILL.md を直接読んでください。
