# アーキテクチャ

この文書は、requirements.md の要件をどう実現するかをまとめたものです。判断の背景は [adr/](./adr/) を参照してください。

## 1. 全体構成

```
[ブラウザ（PC）] ── http://127.0.0.1:<port>
        │
[Node.js サーバー（Hono）]
   ├ /api/*           アプリ用API
   ├ 静的配信          React アプリ
   ├ ジョブランナー     ──spawn──▶ claude / codex（ヘッドレス実行）
   ├ スケジューラ       通知、バックアップ
   └ 通知アダプタ       ──▶ OSのデスクトップ通知
        │
[SQLite ファイル]

[Claude Code / Codex（ターミナル）] ── MCP（stdio）──▶ 同じAPI
```

サーバーはPCへのログイン時にlaunchdで起動し、常駐します。アプリはサーバーが直接エージェントを起動できることを前提にしており、この点がクラウドではなくlocalhostを主軸にした理由です（ADR-0001）。

## 2. 技術スタック

| 層 | 採用 |
|---|---|
| ランタイム | Node.js（LTS） |
| サーバー | Hono |
| DB | SQLite（`node:sqlite`、ADR-0006）、Drizzle ORM（1.0 の rc に固定し、トランザクションは同期で書く。ADR-0011） |
| フロントエンド | React、Vite、TanStack Query、TanStack Router（ADR-0012） |
| エディタ | CodeMirror 6（Markdown） |
| 検証と型共有 | zod、Hono RPC |
| テスト | Vitest、Playwright |
| Lint / Format | Biome |

## 3. リポジトリ構成

```
apps/
  server/     API、静的配信、ジョブランナー、スケジューラ、通知
  web/        画面、キーボード操作、Mame コンポーネント
packages/
  domain/     状態遷移、業務日、自動ルール、集計（純粋関数）
  db/         Drizzle スキーマ、マイグレーション、リポジトリ
  agent/      エージェント起動アダプタ、入力の組み立て、出力の検証
  mcp/        対話用 MCP サーバー（stdio）
prompts/      daily-feedback.md、monthly-summary.md
docs/         この文書群
DESIGN.md     デザインシステム
```

依存の向きは `domain` ← `db` / `agent` ← `server` の一方向です。`domain` は他のパッケージにも、DBやHTTPにも依存しません。

## 4. ドメイン

### 4.1 業務日

時刻はすべてUTCのISO文字列で保存します。それとは別に、タイムゾーン（初期値 `Asia/Tokyo`）と日付の切り替え時刻（初期値5:00）から業務日 `day`（`YYYY-MM-DD`）を計算し、イベントや計画と一緒に保存します。業務日の計算は `domain` の純粋関数とし、切り替え時刻の前後、月末、年末をテストで押さえます。

記録の粒度は業務日です（NFR-09）。時刻は同じ日の中でイベントの順序を決めるためだけに使い、状態の履歴の表示、タイムラインの区間、日数の集計、FB に渡すデータは、すべて業務日の単位で扱います。「午前に着手したタスクは…」のような時間帯の分析は行いません。

### 4.2 ステータス遷移

```ts
const transitions = {
  todo:      ['doing', 'cancelled'],
  doing:     ['done', 'paused', 'waiting', 'cancelled'],
  paused:    ['doing', 'done', 'cancelled'],
  waiting:   ['doing', 'done', 'cancelled'],
  done:      ['doing', 'todo'], // 完了の取り消し
  cancelled: ['todo'],
} as const;
```

キーボードの `Space`（状態を進める）は、`todo → doing → done`、`paused / waiting → doing`、`done → todo` の順で進めます。`done` からの遷移は完了の取り消しとして扱い、`completion_undone` イベントを記録します。

### 4.3 自動ルール

自動ルールは「現在の状態と操作」を受け取り、「発生させるイベントの一覧」と「ユーザーへの提案」を返す関数として実装します。サーバーは返されたイベントを保存するだけです。

| ルール | 発生条件 | 結果 |
|---|---|---|
| バックログ移動時の中断 | 着手中のタスクをバックログへ移動 | `doing → paused` のイベントを追加。取り消し可能であることを応答に含める |
| 親の自動着手 | 子タスクが `doing` になり、親が `todo` | 親に `todo → doing` のイベントを追加 |
| 親の完了提案 | 子タスクがすべて `done` または `cancelled` | 応答に「親を完了にするか」の提案を含める |

### 4.4 集計

着手中・中断・待ちの日数、持ち越し回数、完了件数、月の統計などはすべて `domain` で計算します。FB生成時にも、この計算結果をエージェントに渡します（FR-A10）。

### 4.5 空白日の扱い

アプリを開かず、計画も振り返りもない業務日を「空白日」と呼びます（FR-D09）。空白日には何も自動で記録しません。

**持ち越しの基準日。** 朝の計画では、「前日」ではなく「今日より前で、`day_plans` に行がある最後の業務日」を基準日にし、その日の計画にあって未完了（`done` / `cancelled` 以外）で、今日の計画にまだないタスクを持ち越し候補にします。「明日へ」で翌日に移したタスクがあり、その翌日が空白日だった場合も、その日が基準日になるので漏れません。基準日と今日の間の空白日数を返し、画面には「3日ぶりの計画です」のように表示します。

**ステータスは空白日をまたいで続く。** 着手中のタスクは、空白日の間も着手中のままです。タイムラインの区間は空白日をまたいで途切れずに描き、「着手から◯日目」も暦日で数えます。空白日を除いた日数が必要な集計（実際に手を動かした日数など）は、イベントのある日だけを数える別の値として計算します。

**画面と通知。** カレンダーでは空白日を「記録なし」として表示し、FBの依頼ボタンは出しません。通知は今日の分だけを送り、空白日の分をまとめて送ることはしません。朝の計画画面の「昨日のFB」は、「最後にFBをもらった日のFB」として表示します。

**AIへの入力。** 直近7日の情報には空白日を含め、空白日であることを明示して渡します。空白の多さそのものを責める材料にはしないよう、プロンプトの方針で扱います。

### 4.6 日ごとの記録と再生成

振り返りの保存時とFBの依頼時に、その日の記録（完了・着手・状態変化のまとめ、区間、集計値）を `daily_records` にスナップショットとして保存します。FBの入力にはこのスナップショットを使うため、あとからイベントが変わっても、どの入力からFBが作られたかを再現できます。

日付ごとの詳細の「記録を再生成」（FR-R07）は、イベントからスナップショットを作り直して上書きします。再生成の前後で内容が変わった場合は差分を表示し、FBを再依頼するかどうかをユーザーが選べるようにします。

## 5. データモデル

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,               -- ULID
  parent_id TEXT REFERENCES tasks(id),
  title TEXT NOT NULL,
  note_md TEXT,
  status TEXT NOT NULL,              -- todo/doing/paused/waiting/done/cancelled
  sort_order REAL NOT NULL,
  created_at TEXT NOT NULL,
  last_touched_at TEXT NOT NULL,     -- 棚卸しの判定に使う
  version INTEGER NOT NULL DEFAULT 1 -- 古い画面からの更新を検出する（NFR-13）
);

CREATE TABLE day_plans (
  day TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  position REAL NOT NULL,
  PRIMARY KEY (day, task_id)
);

CREATE TABLE task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  type TEXT NOT NULL,                -- created/status_changed/planned/unplanned/edited/completion_undone
  from_status TEXT,
  to_status TEXT,
  at TEXT NOT NULL,                  -- UTC
  day TEXT NOT NULL                  -- 業務日
);

CREATE TABLE daily_logs (
  day TEXT PRIMARY KEY,
  thoughts_md TEXT NOT NULL DEFAULT '',
  learning_md TEXT NOT NULL DEFAULT '',
  plan_confirmed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE daily_records (
  day TEXT PRIMARY KEY,
  record_json TEXT NOT NULL,         -- まとめ、区間、集計値のスナップショット
  generated_at TEXT NOT NULL,
  source TEXT NOT NULL               -- log_saved / feedback_requested / regenerated
);

CREATE TABLE conditions (
  day TEXT PRIMARY KEY,
  ai_level INTEGER,                  -- 0:絶不調 〜 4:絶好調
  ai_reason TEXT,
  user_level INTEGER,
  updated_at TEXT NOT NULL
);

CREATE TABLE agent_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                -- daily_feedback / monthly_summary
  period TEXT NOT NULL,              -- 2026-09-22 / 2026-09
  agent TEXT NOT NULL,               -- claude / codex
  status TEXT NOT NULL,              -- queued/running/succeeded/failed/cancelled
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE feedbacks (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,               -- daily / monthly
  period TEXT NOT NULL,
  job_id TEXT REFERENCES agent_jobs(id),
  content_json TEXT NOT NULL,
  agent TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  is_partial INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE notifications_sent (
  kind TEXT NOT NULL,                -- morning / evening / inventory
  day TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (kind, day)
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

`task_events` が状態の履歴の正本です（ADR-0004）。`tasks.status` は表示を速くするための写しで、イベントと同じトランザクションで更新します。「今日」のタスクは `day_plans` から、バックログは「未完了・未中止で、今日以降の計画に入っていないタスク」として求めます。持ち越し候補は「前日の計画にあって未完了で、今日の計画にまだないタスク」です。

## 6. API

入力はすべてzodで検証し、型はHono RPCでフロントと共有します。状態を変更するAPIはすべてセッショントークンが必要です（8章）。

| 用途 | メソッドとパス | 補足 |
|---|---|---|
| 今日の画面 | `GET /api/days/:day` | 計画、ログ、最新FB、調子をまとめて返す |
| 持ち越し候補 | `GET /api/days/:day/carryover` | |
| 朝の計画の確定 | `POST /api/days/:day/plan` | 持ち越しの判断とバックログからの追加を1トランザクションで反映 |
| タスクの追加・編集 | `POST /api/tasks`、`PATCH /api/tasks/:id` | 追加時に `planFor` を指定すると計画に直接入る |
| ステータス変更 | `POST /api/tasks/:id/transition` | 自動ルールの結果と提案を応答に含める |
| 移動 | `POST /api/tasks/:id/move` | `to: today / tomorrow / backlog` |
| 振り返り | `PUT /api/days/:day/log` | Markdownの原文を保存 |
| 調子の修正 | `PUT /api/days/:day/condition` | `user_level` のみ更新 |
| バックログ | `GET /api/backlog` | |
| 棚卸し | `GET /api/review/stale`、`POST /api/review/decisions` | |
| タイムライン | `GET /api/timeline?from=&to=` | 区間と内訳を計算済みで返す |
| 月 | `GET /api/months/:ym` | 日ごとの調子、完了件数、総括 |
| 送信内容の確認 | `POST /api/agent-input/preview` | 実際に送る入力、加工の注記、文字数、ハッシュを返す（FR-A12） |
| FBの依頼 | `POST /api/jobs` | `202` でジョブIDを返す。プレビューを経た場合は `payloadHash` を渡し、不一致なら 409 |
| 通知の購読 | `GET /api/events` | Server-Sent Events。ジョブの進捗と、画面以外からの変更を配信（ADR-0008） |
| キャンセル | `POST /api/jobs/:id/cancel` | |
| FBの取得 | `GET /api/feedbacks?scope=&period=` | 履歴を新しい順に返す |
| 設定 | `GET /api/settings`、`PATCH /api/settings` | |

## 7. エージェント連携

### 7.1 流れ

1. `POST /api/jobs` でジョブを `queued` として登録し、すぐに応答する
2. ジョブランナー（同時実行1件）がジョブを取り出し、`running` にする
3. `packages/agent` が入力を組み立て、アダプタ経由でエージェントを起動する
4. 出力のJSONをzodで検証する。形式が違えば1回だけ再試行する
5. `feedbacks` と `conditions.ai_level / ai_reason` を保存し、ジョブを `succeeded` にする
6. 進捗は `GET /api/events`（SSE）で画面に通知する

エージェントには決まった入力を渡してJSONを返してもらうだけで、ツールを使った自律的な操作はさせません（ADR-0003）。対話的に相談したいときは、ターミナルのClaude Code / CodexからMCPサーバー経由でデータを参照します。

### 7.2 入力

日次FBには次の情報を渡します。

- その日の計画、タスクの状態変化のイベント、持ち越し回数
- 振り返りのMarkdown（思考の整理、学び）
- `domain` で計算した集計値（完了件数、長引いているタスク、待ちや中断の日数など）
- 直近7日の調子と「明日の一手」（前日に決めたことを実行できたかに触れてもらうため）

月次総括には、その月の日次の振り返り、日次FB、調子の推移、月の集計値を渡します。月の途中の場合は、その時点までのデータと「途中経過である」ことを渡します。

### 7.3 出力

```json
{
  "condition": { "level": 2, "reason": "設計の手応えと、中断への引っかかりが半々" },
  "good": ["細かい作業を午前にまとめ、午後を設計に使えた"],
  "insight": ["短い作業ほど昼の割り込みで止まりやすい"],
  "next_action": "週報は朝いちばんの15分で終わらせる"
}
```

月次総括は `learnings`、`trends`、`self_gap`（AI判定と手動修正のズレについての考察）、`proposals` を返します。各項目の文章はMarkdownを許可し、表示時にサニタイズします。

### 7.4 アダプタ

`AgentRunner` インターフェースの裏に、Claude Code用とCodex用のアダプタを実装します。具体的な起動フラグと状態の検出方法は、スパイク（ADR-0005）の結果で確定します。どちらも次の条件で起動します。

- ヘッドレス（非対話）モードで起動し、プロンプトとデータは標準入力で渡す
- ツールの使用とファイルの書き込みを許可しない設定にする
- 作業ディレクトリは、ジョブごとに作る空の一時ディレクトリにする
- タイムアウト（初期値120秒）を設け、キャンセル時とタイムアウト時はプロセスを終了させる

テストとE2Eのために、決まったJSONを返す偽のアダプタも用意します。

### 7.5 プロンプト

すべてのプロンプトは `prompts/coaching-policy.md`（コーチとしての振る舞い、FR-A11）に従います。振り返りの文章は `<data>` で区切ってデータとして渡し、その中の指示には従わないことをプロンプトに明記します。プロンプトは `prompts/` にMarkdownで置き、先頭にバージョンを書きます。FBにはどのバージョンで生成したかを保存するので、プロンプトを改善したときに新旧の出力を比べられます。ジョブごとの入力と出力はログファイルに残します。

### 7.6 サーバー停止時

サーバーが停止したときに `running` だったジョブは、次の起動時に `failed`（理由：中断）にします。FBは明示的に依頼する方針なので、自動では再実行せず、画面から再試行してもらいます。

## 8. セキュリティ

このサーバーはエージェントを起動できるため、ブラウザで開いた別のWebサイトから操作されることを防ぎます。開発時と本番時の構成、トークンの受け渡し、CSP の詳細は ADR-0007 に従います。以下はその要約です。

- 待ち受けは `127.0.0.1` のみとする
- すべてのリクエストで `Host` ヘッダーが `127.0.0.1:<port>` または `localhost:<port>` であることを確認する（DNSリバインディング対策）
- 状態を変更するリクエストでは `Sec-Fetch-Site: same-origin`、`Origin` の許可リスト、`X-Mymind-Token` のすべてを確認する
- セッショントークンは起動ごとに生成し、HTMLの meta タグで渡す（開発時は Vite のプラグインが埋め込む）。トークンを返すAPIは作らない
- 開発時は Vite のプロキシで `/api` を転送し、ブラウザから見て画面とAPIを同一オリジンにする
- 開発時は、サーバーの `pnpm dev` が `MYMIND_VITE_PORT`（既定 5173）を渡し、Vite のポートを Host・Origin の許可リストに加える。本番では加えない
- 本番ビルドでは厳格なCSPを付け、E2E は本番ビルドに対して実行する
- Markdownの表示では生のHTMLを無効にし、変換結果をサニタイズする

## 9. 通知

### 9.1 仕組み

サーバー内のスケジューラが次の通知時刻にタイマーを設定し（スリープからの復帰時には再計算し）、その時刻に通知の条件を確認して、条件を満たしたときに通知アダプタからOSのデスクトップ通知を出します。送った通知は `notifications_sent` に記録し、同じ種類の通知を1日に2回送らないようにします。

| 種類 | 時刻（初期値） | 送る条件 | 通知文の例 |
|---|---|---|---|
| 朝 | 8:30 | その日の計画が未確定 | 「昨日のFBが届いています。持ち越しが3件あります」 |
| 夜 | 21:30 | その日の振り返りが未保存 | 「今日は3件完了。競合調査が待ちのまま5日目です」 |
| 棚卸し | 日曜 21:45 | 棚卸しの対象が1件以上 | 「30日以上触れていないタスクが4件あります」 |

PCがスリープしていて時刻を過ぎた場合は、復帰後2時間以内であれば送り、それを過ぎたらその日は送りません。

### 9.2 アダプタ

通知をクリックして該当画面を開く（FR-N05）ために、URLを開けるmacOSの通知ツール（`terminal-notifier` など）を使うアダプタを第一候補にします。ツールが見つからない場合は、ブラウザでアプリを開いているときに限り、ブラウザの通知APIで代替します。どちらも使えない場合は通知を出さず、画面上のバナーだけにします。

## 10. 運用

**常駐**：launchdの設定（`RunAtLoad`、`KeepAlive`）でログイン時に起動し、異常終了したら再起動します。

**バックアップ**：スケジューラが1日1回 `VACUUM INTO` でスナップショットを作り、設定したディレクトリに保存します。保存する世代数は設定で変えられます（初期値14）。使用中のDBファイルを直接クラウド同期フォルダに置くことは推奨しません。

**ログ**：サーバーのログとジョブごとのエージェント入出力を、日付ごとのファイルに保存します。

## 11. テストと開発ハーネス

| 対象 | 方法 |
|---|---|
| 型と静的解析 | TypeScript strict、Biome |
| domain | Vitest。業務日の境界、遷移表、自動ルール、集計を網羅する |
| db / server | インメモリSQLiteを使った結合テスト |
| agent | 保存した出力例で検証処理をテストする。CIではLLMを呼ばない |
| 画面 | Playwright。偽のエージェントアダプタを使い、主要フローをE2Eで確認する |
| AIによる開発 | Claude Code のフックで編集後に lint と typecheck を実行し、permissions でDBファイルやバックアップの直接操作を禁止する |

## 12. 非機能要件の実現方式

### 12.1 フォント（NFR-10、NFR-11）

フォントは `@fontsource/inter` と `@fontsource/noto-sans-jp` の WOFF2 を、400・500・600・700 の太さだけ同梱します（ADR-0012）。Vite がビルド時にアプリへ含め、`font-display: swap` で読み込みます。WOFF2 は文字の範囲ごとに分かれていて、ブラウザは `unicode-range` で表示する文字を含むファイルだけを読み込みます。CSP の `font-src 'self'` と一致させ、外部への通信は発生させません。

### 12.2 下書き（NFR-12）

振り返りとタスクのメモの入力欄は、入力が止まってから1秒後に IndexedDB の `drafts` ストアへ書き込みます。キーは `reflection:<業務日>:<項目>` と `task-note:<タスクID>` とし、値には本文と更新日時を持たせます。保存 API が成功したら該当の下書きを消します。画面を開いたときに、サーバーの内容より新しい下書きがあれば、復元するかどうかを尋ねます。下書きもブラウザ内に残る機微データなので、振り返りを保存した日から30日を過ぎた下書きは起動時に消します。

### 12.3 画面間の一貫性（NFR-13、ADR-0008）

変更系の API が成功したら、そのタブは `BroadcastChannel('mymind')` に変更の種類と対象（例：`{ type: 'task.updated', day }`）を流し、他のタブは TanStack Query の該当クエリを無効化します。サーバーは `GET /api/events` の SSE で、ジョブの進捗と、画面以外（MCP など）からの変更を配信します。

同じタスクの競合を防ぐため、`tasks` に `version`（整数）を持たせ、更新 API は画面が知っている `version` を受け取ります。一致しなければ 409 を返し、画面は最新の状態を読み直して利用者に知らせます。

### 12.4 業務日の切り替え検知（NFR-14）

画面は表示中の業務日を持ち、`keydown`、`pointerdown`、`focusin` のたびに現在の業務日を計算して比較します（計算は `domain` の `toBusinessDay` を画面でも使う）。変わっていた場合は、その操作を実行せずにダイアログを出し、「今日の画面へ移る」（既定）か「前の日（9月22日）の記録として続ける」かを選ばせます。深夜に前日の振り返りを書き終えたい場合に、後者を使います。

サーバー側でも、更新系の API は画面が想定する業務日 `expectedDay` を受け取り、現在の業務日と異なれば、`allowPastDay: true` の指定がない限り 409（`DAY_CHANGED`）を返します。画面のチェックをすり抜けた場合の保険です。

### 12.5 AI への送信データ（NFR-15）

エージェントへの入力は `packages/agent` の入力組み立て関数だけが作り、次の方針に従います。

- **最小化**：タスクの ID、内部のタイムスタンプ、設定値は送らない。タスクは名前、親の名前、状態、日数だけを送る
- **上限**：日次 FB の入力は、振り返りの本文を合わせて最大 12,000 文字とする。超えた場合は古い情報（直近7日の情報）から削り、それでも超える場合は振り返りの末尾を切り詰め、切り詰めたことを入力に明示する
- **直近の情報は要点だけ**：直近7日については、振り返りの全文ではなく、調子と「明日の一手」と空白日かどうかだけを送る
- **月次は段階的にまとめる**：月次総括には、日ごとの FB の要点（よかったこと、気づき、明日の一手）、調子の推移、月の集計値を送り、振り返りの全文は送らない。日次 FB がない日は、その日の振り返りの冒頭だけを送る。それでも上限を超える場合は、週ごとの要約を先に作ってから月次をまとめる
- **記録を残す**：何を送ったかは `daily_records` のスナップショットとジョブのログで確認できるようにする

#### 送信前処理のパイプライン

入力は、決まった順序の「段階（stage）」を通して作ります。各段階は純粋関数で、入力と、何をしたかの注記（annotation）を返します。

```ts
type Annotation = {
  kind: 'truncated' | 'omitted';   // 将来 'excluded-block' | 'excluded-day' | 'substituted' を追加
  path: string;                     // 例：'reflection.thoughts_md'
  reason: string;                   // 画面に表示する理由
};

type Stage = {
  id: string;
  apply(input: AgentInput, ctx: StageContext): { input: AgentInput; annotations: Annotation[] };
};

const pipeline: Stage[] = [
  minimize,   // 必要な項目だけに絞る
  budget,     // 量の上限に収める（切り詰め）
];
```

今は `minimize` と `budget` の2段階だけです。将来、除外や置き換えを入れるときは、`budget` の前に段階を追加します（非公開ブロックの除外、日単位の除外、言い換え辞書、の順を想定）。段階の有効・無効は設定で切り替え、`Annotation.kind` に種類を足せば、プレビューの画面は変更なしで新しい加工を表示できるようにします。

#### 送信内容のプレビュー（FR-A12）

`POST /api/agent-input/preview`（`kind` と `period` を指定）は、パイプラインの結果を返します。

```json
{
  "payload": { "...": "実際に送る入力" },
  "annotations": [{ "kind": "truncated", "path": "reflection.thoughts_md", "reason": "上限の12,000文字を超えたため末尾を切り詰めました" }],
  "charCount": 8421,
  "payloadHash": "sha256:…"
}
```

プレビューと実際の送信で同じ関数を使うため、表示内容と送信内容は一致します。さらに、プレビューを見てから依頼した場合は、`POST /api/jobs` に `payloadHash` を渡します。サーバーは依頼の時点で入力を作り直し、ハッシュが一致しなければ 409（`PREVIEW_STALE`）を返して、画面にプレビューの再確認を求めます。プレビューを見た後に振り返りやタスクが変わっていた場合に、確認していない内容を送らないためです。

画面では、振り返りの主ボタンの横に「送信内容を見る」を置き、詳細ペインに送信内容を項目ごと（振り返り、タスク、集計値、直近の情報）に表示します。注記がある箇所は強調し、理由を添えます。そこから「この内容でFBをもらう」で依頼できます。設定の「依頼の前に毎回確認する」が有効な場合は、「保存してFBをもらう」を押すと必ずこのプレビューを経由します。

### 12.6 機微データ（NFR-16、ADR-0009）

`packages/db` は機微データの列を `SensitiveCodec` を通して読み書きします。ローカルでは何もしない実装です。ロガーには機微データの項目名（`thoughts_md`、`learning_md`、`note_md`、`content_json`、`reason` など）を登録し、自動で伏せ字にします。エージェントの入出力ログは `~/.mymind/logs/agent/` に日付ごとに保存し、30日を過ぎたものをスケジューラが削除します。ファイルとディレクトリは作成時にパーミッションを 600 / 700 にします。

### 12.7 開発環境（Docker、ADR-0010）

`docker compose up dev` で開発サーバー、`docker compose run --rm check` で `pnpm check`、`docker compose run --rm e2e` で E2E を実行できます。コンテナ内ではサーバーが `MYMIND_HOST=0.0.0.0` で待ち受けますが、これは `MYMIND_IN_CONTAINER=1` のときだけ許可し、ポートはホストの `127.0.0.1` にだけ公開します。Vite も同じ `MYMIND_HOST` で待ち受け先を決め、`MYMIND_WATCH_POLLING=1` のときはファイルの変更をポーリングで検知します。データは `./.data/docker`、エージェントは常に偽のアダプタです。

### 12.8 運用系（NFR-19〜NFR-25）

起動時に `~/.mymind/mymind.lock` にプロセス ID を書き込み、既に生きているプロセスがあれば起動を中止します（NFR-20）。`GET /api/health` は、DB への接続、エージェントの実行ファイルの有無とバージョン、最後のバックアップ、直近のジョブの失敗を返します（NFR-21）。スケジューラは1分ごとのポーリングではなく、次に実行すべき時刻を計算してタイマーを設定します（NFR-19）。

## 13. 将来の拡張

スマホから使いたくなった場合は、まずTailscaleで手元のサーバーに接続する方法を検討します。PCが閉じていても使う必要が出たら、`db` のリポジトリ層をD1向けに差し替えてクラウド版を用意します。そのとき、エージェント連携はクラウドから直接は行えないため、ローカルからAPIを呼んでFBを書き戻す構成に切り替えます。
