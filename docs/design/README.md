# デザインの正本と Figma

## どこに何があるか

画面デザインの正本は Figma の **mymind view design** です。

https://www.figma.com/design/VLCoEFLm1ujvYPq8xyEQFg/mymind-view-design

| ページ | 内容 |
|---|---|
| `PC` | 画面のフレーム8枚（1440×900） |
| `Components` | 共通コンポーネント、テキストスタイル、エフェクトスタイル |

### 画面のフレーム（PC ページ）

各フレームの中は「サイドバー」「メイン」「詳細/…」の3つに分かれています（例：`PC/今日` のメインは `6:66`、詳細ペインは `6:168`）。`Components` ページの node-id は `12:2` です（`Mame` は `12:50`、`StatusIcon` は `12:68`、`Chip` は `12:79`、`Button` は `12:88`、`Kbd` は `12:89`、`NeuPanel` は `12:91`、`NeuWell` は `40:7`）。Figma MCP の `get_metadata` でファイルのページ一覧を取ると `PC` しか返らないことがあるので、node-id を直接指定してください。

| フレーム名 | node-id | 画面 | URL（issue 011 の暫定決定） |
|---|---|---|---|
| `PC/今日` | `6:25` | 今日のタスク、3ペイン、状態の履歴 | `/` |
| `PC/今日（親を選択）` | `27:7` | 親のタスク（TODOツール MVP）を選んだ状態。詳細ペイン（`27:158`）に子タスクの欄（子の一覧と追加の入力欄、DESIGN.md 4.12） | `/` |
| `PC/朝の計画` | `9:2` | 持ち越しの判断、バックログからの追加、昨日のFBと調子 | `/morning` |
| `PC/振り返り` | `9:225` | Markdown の入力（書く／プレビュー）、今日のFB | `/reflection/:day?` |
| `PC/バックログ` | `10:2` | バックログの一覧、右ペインに日曜の棚卸し | `/backlog` |
| `PC/タイムライン` | `10:139` | 2週間の状態の区間、調子のレーン、期間の内訳 | `/timeline` |
| `PC/カレンダー` | `11:2` | 月のカレンダー、日ごとの記録、FBの後追い依頼 | `/calendar/:ym/:day?` |
| `PC/設定` | `21:2` | アプリの状態（エージェント、最後のバックアップ、DB のサイズ、直近の FB 生成の失敗）。詳細ペインは選んだ項目（初期はエージェント） | `/settings` |

### コンポーネント（Components ページ）

| 名前 | 種類 | プロパティ |
|---|---|---|
| `Mame` | コンポーネントセット | `mood` = best / good / normal / bad / worst / sleep |
| `StatusIcon` | コンポーネントセット | `status` = todo / doing / paused / waiting / done / cancelled |
| `Chip` | コンポーネントセット | `tone` = doing / waiting / paused / done / todo |
| `Button` | コンポーネントセット | `kind` = primary / confirm / ghost / danger |
| `Kbd` | コンポーネント | ショートカットの表示 |
| `NeuPanel` | コンポーネント | 浮き出た面の見本（ペイン、カード、リストの面） |
| `NeuWell` | コンポーネント | くぼんだ面の見本（入力欄、選んだ行、エディタ、表） |

各コンポーネントの説明文に、使い方の注意（状態は色だけで区別しない、チップは状態色を14〜16%で重ねる、など）を書いてあります。

### 変数とスタイル

- **色の変数**：コレクション `mymind` に26個。名前は DESIGN.md のトークンと同じ（`ink-1`〜`ink-4`、`ground`、`surface`、`line`、`accent`、`accent-strong`、`accent-soft`、`button-primary`、`button-confirm`、`neu-light`、`neu-dark`、`status-*` 6色、`mame-*` 6色）。`surface` は `ground` の別名で、面と地は同じ色です。振り返りの画面も同じ地です（ADR-0019）
- **テキストスタイル**：`Display / 30`、`Title / 22`、`Heading / 15`、`Label / 11`、`Body / 14`、`Body Medium / 14`、`Small / 12`、`Caption / 11`
- **エフェクトスタイル**：`ニューモ / 凸 1`〜`凸 3`、`ニューモ / 凹 1`〜`凹 2`、`ニューモ / ボタン（濃い塗り）`、`ニューモ / ボタン（地の塗り）`。影の色は変数 `neu-light`・`neu-dark` につないであります

## エージェントが画面を実装するときの手順

1. 対象の issue に書かれたフレーム名（上の表）を確認する
2. Figma MCP の `get_design_context` に fileKey `VLCoEFLm1ujvYPq8xyEQFg` とフレームの node-id を渡して、スクリーンショットと構造を取得する。node-id は Figma でフレームを選択して「Copy link to selection」で得られる
3. 色・角の丸み・余白・書体は、Figma の値ではなく DESIGN.md のトークン（`tokens.css`）を使う。食い違いがあれば実装を止めて issue にコメントする
4. 実装後、Playwright で同じサイズのスクリーンショットを撮り、Figma のフレームと並べて確認する（issue 016）。`pnpm screenshots` が撮る画像と比べるフレームの対応は `docs/design/screenshots.json` にある。画面や状態（詳細ペインを開いた状態など）を足したら、ここにも1件足す

Figma に接続できない環境では、`docs/design/mockup-source/` のモックアップのソースを参照します。

## 凸凹の作り方（Figma と実装の対応）

面は地と同じ色で塗り、左上に明るい影、右下に暗い影を付けて浮き出させたり、内側に付けてへこませたりします（ADR-0018）。**レイアウト用の入れ物には塗りも影も付けない**（Figma のオートレイアウトは初期値が不透明な白なので、必ず塗りを外す）点と、**影を持つ要素の親では「コンテンツを切り取る」を外す**（外さないと影が途中で切れる）点が、見た目を崩さないための要です。

**実装（CSS）の列のトークンは、まだ定義していません。** `--surface`、`--neu-edge`、`--neu-raised-*`、`--neu-inset-*`、`--button-*` は #237 で DESIGN.md と `tokens.css` に足します。それまでは DESIGN.md 2.3（ガラス）が実装の正本で、この列は #237 以降の対応を示す予定の値です。

| 要素 | Figma | 実装（CSS、#237 以降） |
|---|---|---|
| 地 | フレームの塗り＝変数 `ground`（全画面で同じ）。背景のにじみはない | `background: var(--ground)` |
| 浮き出た面 | 塗り＝`surface`、線＝白50%・1px、`ニューモ / 凸 2`（ペイン、リスト）、`凸 1`（カード、`kbd`、セグメントの外枠）、`凸 3`（ダイアログ、パレット、バナー） | `var(--surface)` ＋ `var(--neu-edge)` ＋ `box-shadow: var(--neu-raised-*)` |
| くぼんだ面 | 塗り＝`surface`、`ニューモ / 凹 1`（入力欄、選んだ行、選んだセグメント、選んだナビ）、`凹 2`（エディタ、カレンダーとタイムラインの表） | `box-shadow: var(--neu-inset-*)` |
| 選んだ行 | `凹 1` ＋ 藍50%の枠 1.5px | `var(--neu-inset-1)` ＋ `var(--row-selected-border)` |
| 主ボタン・確定ボタン | 塗り＝`button-primary`・`button-confirm`、`ニューモ / ボタン（濃い塗り）` | `var(--button-primary-bg)` ＋ `box-shadow: var(--button-raised-on-dark)` |
| 副ボタン | 塗り＝`surface`、線＝白50%、`ニューモ / ボタン（地の塗り）` | `var(--surface)` ＋ `box-shadow: var(--button-raised)` |
| チップ | 状態色を14〜16%で重ねる | `rgba(<状態色>, 0.14)` |

## 既知の差分

- **書体のウェイト**：DESIGN.md の見出しは SemiBold（600）ですが、Figma の Noto Sans JP には 600 がないため Medium（500）で作っています。実装では自前配信のフォントを使うので、実装側は DESIGN.md の値に従います。
- **フォントの配信元**：Figma はシステムのフォントを使いますが、実装ではアプリに同梱したフォントを自前で配信します（NFR-10）。
- **コンポーネントの適用**：6枚のフレームの中身は、まだコンポーネントのインスタンスではなく個別のレイヤーです（`PC/設定` はチップとボタンに Components のインスタンスを使っている）。差し替えは今後の作業です（issue 004）。
- **ステータスアイコンの形**：Figma の `StatusIcon` は、中断と待ちがどちらも「輪＋中の点」で、違いが色だけです。DESIGN.md 2.2・4.2 は「状態は色だけで区別せず、形（時計、一時停止）を併用する」としているので、実装は DESIGN.md の形にしています。
- **マメの表情**：Figma の `Mame` は6種類で、DESIGN.md 4.1 の `think`（生成中）がありません。実装は `docs/design/mockup-source/Mame.dc.html` をもとに7種類を作っています。
- **実装との先後**：Figma は M8（ADR-0018）で先にニューモフィズムに作り直しました。実装が追いつくまで（#237、#239〜#243）、画面のスクリーンショットはガラスのままで、Figma と食い違います。
- **スマホ版**：Figma にはありません。`docs/design/mockup-source/` にもPC版のみを置いています。
