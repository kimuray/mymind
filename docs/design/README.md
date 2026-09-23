# デザインの正本と Figma

## どこに何があるか

画面デザインの正本は Figma の **mymind view design** です。

https://www.figma.com/design/VLCoEFLm1ujvYPq8xyEQFg/mymind-view-design

| ページ | 内容 |
|---|---|
| `PC` | 画面のフレーム6枚（1440×900） |
| `Components` | 共通コンポーネント、テキストスタイル、エフェクトスタイル |

### 画面のフレーム（PC ページ）

各フレームの中は「背景/にじみ」「サイドバー」「メイン」「詳細/…」の4つに分かれています（例：`PC/今日` のメインは `6:66`、詳細ペインは `6:168`）。2026-09-24 時点で、Figma のファイルには `PC` ページしかなく、下の `Components` ページはありませんでした（#13）。

| フレーム名 | node-id | 画面 | URL（issue 011 の暫定決定） |
|---|---|---|---|
| `PC/今日` | `6:25` | 今日のタスク、3ペイン、状態の履歴 | `/` |
| `PC/朝の計画` | `9:2` | 持ち越しの判断、バックログからの追加、昨日のFBと調子 | `/morning` |
| `PC/振り返り` | `9:225` | Markdown の入力（書く／プレビュー）、今日のFB | `/reflection/:day?` |
| `PC/バックログ` | `10:2` | バックログの一覧、右ペインに日曜の棚卸し | `/backlog` |
| `PC/タイムライン` | `10:139` | 2週間の状態の区間、調子のレーン、期間の内訳 | `/timeline` |
| `PC/カレンダー` | `11:2` | 月のカレンダー、日ごとの記録、FBの後追い依頼 | `/calendar/:ym/:day?` |

### コンポーネント（Components ページ）

| 名前 | 種類 | プロパティ |
|---|---|---|
| `Mame` | コンポーネントセット | `mood` = best / good / normal / bad / worst / sleep |
| `StatusIcon` | コンポーネントセット | `status` = todo / doing / paused / waiting / done / cancelled |
| `Chip` | コンポーネントセット | `tone` = doing / waiting / paused / done / todo |
| `Button` | コンポーネントセット | `kind` = primary / confirm / ghost / danger |
| `Kbd` | コンポーネント | ショートカットの表示 |
| `GlassPanel` | コンポーネント | ガラスの面の見本（塗りの濃さの目安） |

各コンポーネントの説明文に、使い方の注意（状態は色だけで区別しない、チップは状態色を14〜16%で重ねる、など）を書いてあります。

### 変数とスタイル

- **色の変数**：コレクション `mymind` に22個。名前は DESIGN.md のトークンと同じ（`ink-1`〜`ink-4`、`ground`、`surface`、`line`、`accent`、`accent-strong`、`accent-soft`、`status-*` 6色、`mame-*` 6色）
- **テキストスタイル**：`Display / 30`、`Title / 22`、`Heading / 15`、`Label / 11`、`Body / 14`、`Body Medium / 14`、`Small / 12`、`Caption / 11`
- **エフェクトスタイル**：`ガラス / 面`、`ガラス / 面（影なし）`、`ボタン / アクセントの影`

## エージェントが画面を実装するときの手順

1. 対象の issue に書かれたフレーム名（上の表）を確認する
2. Figma MCP の `get_design_context` に fileKey `VLCoEFLm1ujvYPq8xyEQFg` とフレームの node-id を渡して、スクリーンショットと構造を取得する。node-id は Figma でフレームを選択して「Copy link to selection」で得られる
3. 色・角の丸み・余白・書体は、Figma の値ではなく DESIGN.md のトークン（`tokens.css`）を使う。食い違いがあれば実装を止めて issue にコメントする
4. 実装後、Playwright で同じサイズのスクリーンショットを撮り、Figma のフレームと並べて確認する（issue 016）

Figma に接続できない環境では、`docs/design/mockup-source/` のモックアップのソースを参照します。

## ガラス表現の作り方（Figma と実装の対応）

Figma の作り方と CSS の対応は次のとおりです。**レイアウト用の入れ物には塗りを付けない**（Figma のオートレイアウトは初期値が不透明な白なので、必ず塗りを外す）点が、見た目を崩さないための要です。

| 要素 | Figma | 実装（CSS） |
|---|---|---|
| 背景の色のにじみ | フレーム `背景/にじみ` の中に、ぼかし（半径240〜300）を掛けた楕円を6〜7枚 | `radial-gradient` を重ねた `background-image` |
| ガラスの面 | 塗り＝白20〜40%、線＝白80%、エフェクトスタイル `ガラス / 面` | `rgba(255,255,255,0.34)` ＋ `backdrop-filter: blur(28px)` ＋ 縁取りと影 |
| 面の濃さ | サイドバー・リスト34%、詳細ペイン・入力欄40%、控えめな面20% | 同じ |
| チップ | 状態色を14〜16%で重ねる | `rgba(<状態色>, 0.14)` |

## 既知の差分

- **書体のウェイト**：DESIGN.md の見出しは SemiBold（600）ですが、Figma の Noto Sans JP には 600 がないため Medium（500）で作っています。実装では自前配信のフォントを使うので、実装側は DESIGN.md の値に従います。
- **フォントの配信元**：Figma はシステムのフォントを使いますが、実装ではアプリに同梱したフォントを自前で配信します（NFR-10）。
- **コンポーネントの適用**：6枚のフレームの中身は、まだコンポーネントのインスタンスではなく個別のレイヤーです。差し替えは今後の作業です（issue 004）。
- **スマホ版**：Figma にはありません。`docs/design/mockup-source/` にもPC版のみを置いています。
