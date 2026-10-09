import type { TagRepository, TaskRepository } from '@mymind/db';
import { canAddTag, MAX_TAGS_PER_TASK, normalizeTagName, TAG_COLORS } from '@mymind/domain';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { fail, jsonBody, type ScreenGuards, withVersion } from './http';

export type TagsApiDeps = {
  tags: TagRepository;
  tasks: Pick<TaskRepository, 'find' | 'applyChanges'>;
  newId: () => string;
  now: () => Date;
} & ScreenGuards;

const colorSchema = z.enum(TAG_COLORS);
const createBody = z.strictObject({ name: z.string(), color: colorSchema });
const updateBody = z
  .strictObject({ name: z.string().optional(), color: colorSchema.optional() })
  .refine((b) => b.name !== undefined || b.color !== undefined, {
    message: 'name か color を指定してください',
  });
/**
 * タスクに付ける。ない名前なら作る（色を省くと最初の色）。
 * 付け外しはタスクの属性の変更なので、ほかの編集と同じく版と業務日を確かめる（NFR-13、NFR-14）
 */
const attachBody = z.strictObject({
  ...withVersion,
  name: z.string(),
  color: colorSchema.optional(),
});
const detachBody = z.strictObject(withVersion);

/** 名前を整えられなかったときの応答 */
const invalidName = (c: Context, input: string) => {
  const n = normalizeTagName(input);
  if (n.ok) return null;
  return fail(
    c,
    400,
    'INVALID_REQUEST',
    n.error.kind === 'empty'
      ? 'タグの名前を入れてください'
      : `タグの名前は ${n.error.max} 文字までです`,
  );
};

const duplicate = (c: Context, name: string) =>
  fail(c, 409, 'DUPLICATE_TAG', `「${name}」というタグは、すでにあります`);

/**
 * タグの API（FR-T13、architecture.md 6章）。状態を変える操作は、ほかの API と同じく Host・Origin・トークンの検証の内側に置く。
 * タスクへの付け外しはタスクの属性の変更として版を進めるが、イベントには残さない（requirements.md 5章）
 */
export function createTagsApi({ tags, tasks, newId, now, checkDay, conflict }: TagsApiDeps) {
  const tagsOf = (taskId: string) => tags.tagsOfTasks([taskId]).get(taskId) ?? [];

  /** タスクの版を確かめて付け外しを保存し、新しい版のタスクと、付いているタグを返す */
  const changeTags = (
    c: Context,
    taskId: string,
    expectedVersion: number,
    change: { attach?: string[]; detach?: string[] },
    extra: { created?: boolean } = {},
  ) => {
    const result = tasks.applyChanges([{ taskId, expectedVersion, events: [], tags: change }]);
    if (!result.ok) return conflict(c, result.error);
    return c.json({ task: result.value[0], tags: tagsOf(taskId), ...extra }, 200);
  };

  return new Hono()
    .get('/tags', (c) => c.json({ tags: tags.list() }, 200))

    .post('/tags', jsonBody(createBody), (c) => {
      const input = c.req.valid('json');
      const bad = invalidName(c, input.name);
      if (bad !== null) return bad;
      const n = normalizeTagName(input.name);
      if (!n.ok) return fail(c, 400, 'INVALID_REQUEST', 'タグの名前が正しくありません');
      if (tags.findByKey(n.value.key) !== undefined) return duplicate(c, n.value.name);
      const tag = tags.create({
        id: newId(),
        name: n.value.name,
        key: n.value.key,
        color: input.color,
        at: now().toISOString(),
      });
      return c.json({ tag }, 201);
    })

    .patch('/tags/:id', jsonBody(updateBody), (c) => {
      const id = c.req.param('id');
      const input = c.req.valid('json');
      if (tags.find(id) === undefined) return fail(c, 404, 'NOT_FOUND', 'タグが見つかりません');
      let nameChange: { name: string; key: string } | undefined;
      if (input.name !== undefined) {
        const bad = invalidName(c, input.name);
        if (bad !== null) return bad;
        const n = normalizeTagName(input.name);
        if (!n.ok) return fail(c, 400, 'INVALID_REQUEST', 'タグの名前が正しくありません');
        const same = tags.findByKey(n.value.key);
        // 大文字・小文字だけを変えるときは、自分自身との重複なので許す
        if (same !== undefined && same.id !== id) return duplicate(c, n.value.name);
        nameChange = n.value;
      }
      const tag = tags.update(id, {
        ...(nameChange ?? {}),
        ...(input.color === undefined ? {} : { color: input.color }),
      });
      if (tag === undefined) return fail(c, 404, 'NOT_FOUND', 'タグが見つかりません');
      return c.json({ tag }, 200);
    })

    .delete('/tags/:id', (c) => {
      if (!tags.delete(c.req.param('id'))) {
        return fail(c, 404, 'NOT_FOUND', 'タグが見つかりません');
      }
      return c.json({ tags: tags.list() }, 200);
    })

    .post('/tasks/:id/tags', jsonBody(attachBody), (c) => {
      const input = c.req.valid('json');
      const dayError = checkDay(c, input);
      if (dayError) return dayError;
      const taskId = c.req.param('id');
      const task = tasks.find(taskId);
      if (task === undefined) return conflict(c, { kind: 'not_found', taskId });
      // タグを作る前に版を確かめ、拒否される付け外しのために使われないタグを作らない
      if (task.version !== input.expectedVersion) {
        return conflict(c, { kind: 'version_conflict', taskId });
      }
      const bad = invalidName(c, input.name);
      if (bad !== null) return bad;
      const n = normalizeTagName(input.name);
      if (!n.ok) return fail(c, 400, 'INVALID_REQUEST', 'タグの名前が正しくありません');
      const existing = tags.findByKey(n.value.key);
      const current = tagsOf(taskId);
      if (existing !== undefined && current.some((t) => t.id === existing.id)) {
        return c.json({ task, tags: current, created: false }, 200);
      }
      if (!canAddTag(current.length)) {
        return fail(c, 422, 'TOO_MANY_TAGS', `タグは1つのタスクに ${MAX_TAGS_PER_TASK} 個までです`);
      }
      const tag =
        existing ??
        tags.create({
          id: newId(),
          name: n.value.name,
          key: n.value.key,
          color: input.color ?? TAG_COLORS[0],
          at: now().toISOString(),
        });
      return changeTags(
        c,
        taskId,
        input.expectedVersion,
        { attach: [tag.id] },
        {
          created: existing === undefined,
        },
      );
    })

    .delete('/tasks/:id/tags/:tagId', jsonBody(detachBody), (c) => {
      const input = c.req.valid('json');
      const dayError = checkDay(c, input);
      if (dayError) return dayError;
      return changeTags(c, c.req.param('id'), input.expectedVersion, {
        detach: [c.req.param('tagId')],
      });
    });
}
