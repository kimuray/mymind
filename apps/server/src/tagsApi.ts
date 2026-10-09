import type { TagRepository, TaskRepository } from '@mymind/db';
import { canAddTag, MAX_TAGS_PER_TASK, normalizeTagName, TAG_COLORS } from '@mymind/domain';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { fail, jsonBody } from './http';

export type TagsApiDeps = {
  tags: TagRepository;
  tasks: Pick<TaskRepository, 'find'>;
  newId: () => string;
  now: () => Date;
};

const colorSchema = z.enum(TAG_COLORS);
const createBody = z.strictObject({ name: z.string(), color: colorSchema });
const updateBody = z
  .strictObject({ name: z.string().optional(), color: colorSchema.optional() })
  .refine((b) => b.name !== undefined || b.color !== undefined, {
    message: 'name か color を指定してください',
  });
/** タスクに付ける。ない名前なら作る（色を省くと最初の色） */
const attachBody = z.strictObject({ name: z.string(), color: colorSchema.optional() });

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
 * タスクへの付け外しはイベントに残さず、タスクの版も変えない（requirements.md 5章）
 */
export function createTagsApi({ tags, tasks, newId, now }: TagsApiDeps) {
  const tagsOf = (taskId: string) => tags.tagsOfTasks([taskId]).get(taskId) ?? [];

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
      const taskId = c.req.param('id');
      if (tasks.find(taskId) === undefined) {
        return fail(c, 404, 'NOT_FOUND', 'タスクが見つかりません');
      }
      const input = c.req.valid('json');
      const bad = invalidName(c, input.name);
      if (bad !== null) return bad;
      const n = normalizeTagName(input.name);
      if (!n.ok) return fail(c, 400, 'INVALID_REQUEST', 'タグの名前が正しくありません');
      const existing = tags.findByKey(n.value.key);
      const current = tagsOf(taskId);
      if (existing !== undefined && current.some((t) => t.id === existing.id)) {
        return c.json({ tags: current, created: false }, 200);
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
      tags.attach(taskId, tag.id);
      return c.json({ tags: tagsOf(taskId), created: existing === undefined }, 200);
    })

    .delete('/tasks/:id/tags/:tagId', (c) => {
      const taskId = c.req.param('id');
      if (tasks.find(taskId) === undefined) {
        return fail(c, 404, 'NOT_FOUND', 'タスクが見つかりません');
      }
      tags.detach(taskId, c.req.param('tagId'));
      return c.json({ tags: tagsOf(taskId) }, 200);
    });
}
