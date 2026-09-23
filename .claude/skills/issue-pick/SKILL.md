---
name: issue-pick
description: 次に取り組む課題を選ぶとき、「次は何をやる？」と聞かれたとき、作業の開始時に使う。GitHub の issue（登録前は docs/issues/）から status:ready のものを優先度順に1つ選び、着手してよいか確認する。
---

# 次に取り組む issue を選ぶ

次に取り組む issue を1つ選び、着手してよいか確認してください。まだ着手はしないでください。

1. `gh issue list --label "status:ready" --state open --json number,title,labels,milestone` で候補を取得する。GitHub に issue がない場合は `docs/issues/README.md` の一覧を使う
2. 次の条件で絞り込む
   - `status:ready` 以外（`needs-decision`、`needs-human`、`blocked`、`provisional`、`in-progress`）は除く
   - 本文の「依存」（登録前は `depends_on`）の issue がすべて閉じているか確認する
3. 優先度（p0 → p1 → p2）、マイルストーン（M1 → M5）、番号の順で並べ、先頭を選ぶ
4. 選んだ issue について、次を簡潔に示す
   - タイトルと番号、選んだ理由
   - 対応する要件ID と完了条件
   - 実装の方針（触るパッケージ、追加するテスト）
   - 着手前に確認したい点があればその内容
5. 「この issue に着手してよいですか？」と確認して終える
