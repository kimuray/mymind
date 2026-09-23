---
description: TypeScript の書き方、境界での検証、エラーの扱い、時刻と ID、命名。コードを書くときに必ず参照する。
---

# コーディングルール

## TypeScript

`tsconfig.base.json` の strict 設定（`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` を含む）を前提に書きます。`any` と非 null アサーション（`!`）は使いません。型が分からないデータは `unknown` として受け取り、zod で検証して型を得ます。型だけを読み込むときは `import type` を使います。

## 境界での検証

外部から入ってくるデータは、すべて境界で zod のスキーマを通します。対象は HTTP のリクエストとレスポンス、エージェントの出力、設定、環境変数です。スキーマは使う側と同じパッケージに置き、型は `z.infer` で導出します。検証済みの値だけを内側の層に渡し、内側で同じ検証を繰り返しません。

## エラーの扱い

想定できる失敗（入力の不正、遷移できない状態、エージェント出力の形式違反など）は、例外ではなく戻り値で表します。`packages/domain` では `{ ok: true, value } | { ok: false, error }` の形を使います。例外は、プログラムの誤りや復旧できない状態に限ります。握りつぶす `catch` を書かず、捕まえた例外はログに残すか、意味のある失敗に変換して返します。

## 時刻と ID

現在時刻を関数の中で取得しません。`Clock` を注入するか、引数で受け取ります。時刻は UTC の ISO 文字列で保存し、業務日への変換は `packages/domain` の `toBusinessDay` だけで行います。ID は ULID を使います。

## 命名

ファイル名は camelCase、React コンポーネントのファイルは PascalCase にします。関数名は動詞から始め、真偽値は `is` / `has` / `can` から始めます。ドメインの用語は `docs/requirements.md` の用語表に合わせ、同じ概念に別の名前を付けません（例：「バックログ」は `backlog`、「持ち越し」は `carryover`、「業務日」は `businessDay` / `day`）。

## その他

`console.log` を残しません（`console.error` と `console.warn` は可）。ログはサーバーのロガーを使います。1つの関数が長くなったら、名前の付く単位で分割します。コメントには「何をしているか」ではなく「なぜそうしているか」を書きます。
