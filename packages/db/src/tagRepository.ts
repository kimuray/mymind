import type { TagColor } from '@mymind/domain';
import { asc, count, eq, inArray } from 'drizzle-orm';
import type { Database } from './client';
import { tags, taskTags } from './schema';

export type Tag = { id: string; name: string; color: TagColor };
export type TagWithCount = Tag & { taskCount: number };

/** 一度に IN に入れる ID の数（SQLite の変数の数の上限に当たらないように） */
const BATCH_SIZE = 500;

const toTag = (row: typeof tags.$inferSelect): Tag => ({
  id: row.id,
  name: row.name,
  color: row.color,
});

/**
 * タグ（FR-T13、architecture.md 5章）。名前の整え方と重複の判定キーは domain の normalizeTagName で作って渡す。
 * タスクへの付け外しはイベントに残さない（requirements.md 5章）
 */
export function createTagRepository({ db }: { db: Database }) {
  return {
    /** すべてのタグと、付いているタスクの数（名前の順） */
    list(): TagWithCount[] {
      const counts = new Map(
        db
          .select({ tagId: taskTags.tagId, n: count() })
          .from(taskTags)
          .groupBy(taskTags.tagId)
          .all()
          .map((r) => [r.tagId, r.n]),
      );
      return db
        .select()
        .from(tags)
        .orderBy(asc(tags.nameKey))
        .all()
        .map((row) => ({ ...toTag(row), taskCount: counts.get(row.id) ?? 0 }));
    },

    find(id: string): Tag | undefined {
      const row = db.select().from(tags).where(eq(tags.id, id)).get();
      return row === undefined ? undefined : toTag(row);
    },

    /** 重複の判定キーで探す */
    findByKey(key: string): Tag | undefined {
      const row = db.select().from(tags).where(eq(tags.nameKey, key)).get();
      return row === undefined ? undefined : toTag(row);
    },

    create(input: { id: string; name: string; key: string; color: TagColor; at: string }): Tag {
      const row = db
        .insert(tags)
        .values({
          id: input.id,
          name: input.name,
          nameKey: input.key,
          color: input.color,
          createdAt: input.at,
        })
        .returning()
        .get();
      return toTag(row);
    },

    /** 名前（と判定キー）か色を変える */
    update(id: string, change: { name?: string; key?: string; color?: TagColor }): Tag | undefined {
      const set = {
        ...(change.name === undefined ? {} : { name: change.name }),
        ...(change.key === undefined ? {} : { nameKey: change.key }),
        ...(change.color === undefined ? {} : { color: change.color }),
      };
      if (Object.keys(set).length === 0) return this.find(id);
      const row = db.update(tags).set(set).where(eq(tags.id, id)).returning().get();
      return row === undefined ? undefined : toTag(row);
    },

    /** タグを消す。付いていたタスクからも外す（FR-T13） */
    delete(id: string): boolean {
      return db.transaction((tx) => {
        tx.delete(taskTags).where(eq(taskTags.tagId, id)).run();
        return tx.delete(tags).where(eq(tags.id, id)).run().changes > 0;
      });
    },

    /** タスクに付いているタグの数 */
    countOfTask(taskId: string): number {
      return (
        db.select({ n: count() }).from(taskTags).where(eq(taskTags.taskId, taskId)).get()?.n ?? 0
      );
    },

    /**
     * 複数のタスクに付いたタグを、タスクごとに名前の順でまとめて返す（一覧で行ごとに問い合わせないため、NFR-18）
     */
    tagsOfTasks(taskIds: readonly string[]): Map<string, Tag[]> {
      const result = new Map<string, Tag[]>(taskIds.map((id) => [id, []]));
      for (let i = 0; i < taskIds.length; i += BATCH_SIZE) {
        const rows = db
          .select({ taskId: taskTags.taskId, tag: tags })
          .from(taskTags)
          .innerJoin(tags, eq(taskTags.tagId, tags.id))
          .where(inArray(taskTags.taskId, taskIds.slice(i, i + BATCH_SIZE)))
          .orderBy(asc(tags.nameKey))
          .all();
        for (const row of rows) result.get(row.taskId)?.push(toTag(row.tag));
      }
      return result;
    },
  };
}

export type TagRepository = ReturnType<typeof createTagRepository>;
