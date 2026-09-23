# 判断の記録（ADR）

設計上の重要な判断と、その理由を記録しています。判断を変えるときは既存の ADR を書き換えず、新しい ADR を追加して、古い ADR のステータスだけを更新します。

| No. | 判断 | ステータス |
|---|---|---|
| [ADR-0001](./0001-localhost-first.md) | localhost を主軸にする | 採用 |
| [ADR-0002](./0002-explicit-feedback-request.md) | FBはユーザーが明示的に依頼する | 採用 |
| [ADR-0003](./0003-agent-as-pipeline.md) | エージェントは決まった入出力のパイプラインとして使う | 採用 |
| [ADR-0004](./0004-events-as-source-of-truth.md) | 状態の履歴はイベントを正本にする | 採用 |
| [ADR-0005](./0005-agent-cli-spike.md) | エージェントCLIの起動方法をスパイクで確定する | 提案（スパイク待ち：issue 001） |
| [ADR-0006](./0006-sqlite-driver.md) | SQLite のドライバは node:sqlite を第一候補にする | 採用（ADR-0011 で確定） |
| [ADR-0007](./0007-dev-topology-and-local-security.md) | 開発時と本番時のサーバー構成と、ローカルサーバーの保護 | 採用 |
| [ADR-0008](./0008-realtime-channel.md) | 画面へのリアルタイム通知は SSE ＋ BroadcastChannel にする | 採用 |
| [ADR-0009](./0009-sensitive-data.md) | 機微なデータは「クラウドに置いた場合」を基準に扱う | 採用 |
| [ADR-0010](./0010-docker-dev-environment.md) | Docker と Docker Compose で開発環境を用意する | 採用 |
| [ADR-0011](./0011-node-sqlite-with-drizzle-rc.md) | node:sqlite を採用し、Drizzle は 1.0 の rc に固定して同期のトランザクションで使う | 採用 |
| [ADR-0012](./0012-web-router-and-fonts.md) | 画面のルーターは TanStack Router にし、フォントは @fontsource をそのまま同梱する | 採用 |
