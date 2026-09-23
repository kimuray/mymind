// マイグレーションとトランザクションの検証（issue 002）だけに使うスキーマ。アプリのスキーマではない。
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const items = sqliteTable('items', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  status: text('status').notNull(),
});

export const itemEvents = sqliteTable('item_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: text('item_id')
    .notNull()
    .references(() => items.id),
  kind: text('kind').notNull(),
});
