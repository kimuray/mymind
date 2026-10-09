import { normalizeTagName } from '@mymind/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER, openDatabase } from './client';
import { plainCodec } from './sensitiveCodec';
import { createTagRepository, type TagRepository } from './tagRepository';
import { createTaskRepository, type TaskRepository } from './taskRepository';

const AT = '2026-10-09T01:00:00.000Z';
const DAY = '2026-10-09';

let tags: TagRepository;
let tasks: TaskRepository;
let seq = 0;
beforeEach(() => {
  const db = openDatabase({ path: ':memory:', migrationsFolder: MIGRATIONS_FOLDER });
  tags = createTagRepository({ db });
  tasks = createTaskRepository({ db, codec: plainCodec, newEventId: () => `e${++seq}` });
  for (const id of ['t1', 't2', 't3']) {
    tasks.create({
      created: { type: 'created', taskId: id, at: AT, day: DAY },
      parentId: null,
      title: id,
      noteMd: null,
    });
  }
});

/** 付け外しはタスクの変更として行う（版を進め、同じトランザクションで保存する） */
const changeTags = (taskId: string, change: { attach?: string[]; detach?: string[] }) => {
  const result = tasks.applyChanges([{ taskId, expectedVersion: null, events: [], tags: change }]);
  if (!result.ok) throw new Error(result.error.kind);
  return result.value[0];
};
const attach = (taskId: string, tagId: string) => changeTags(taskId, { attach: [tagId] });

const makeTag = (id: string, input: string, color: 'rose' | 'teal' = 'rose') => {
  const n = normalizeTagName(input);
  if (!n.ok) throw new Error('名前が正しくありません');
  return tags.create({ id, name: n.value.name, key: n.value.key, color, at: AT });
};

describe('FR-T13 タグのリポジトリ', () => {
  it('作ったタグを、名前の順と付いているタスクの数で一覧にする', () => {
    makeTag('g2', '仕事');
    makeTag('g1', 'Home', 'teal');
    attach('t1', 'g2');
    attach('t2', 'g2');
    expect(tags.list()).toEqual([
      { id: 'g1', name: 'Home', color: 'teal', taskCount: 0 },
      { id: 'g2', name: '仕事', color: 'rose', taskCount: 2 },
    ]);
  });

  it('同じ判定キーのタグは2つ作れない（データベースでも重複を拒否する）', () => {
    makeTag('g1', 'Work');
    expect(tags.findByKey('work')).toMatchObject({ id: 'g1', name: 'Work' });
    expect(() => makeTag('g2', 'WORK')).toThrow();
  });

  it('同じタグを2回付けても1つだけ付く。外すとなくなる', () => {
    makeTag('g1', '仕事');
    attach('t1', 'g1');
    attach('t1', 'g1');
    expect(tags.countOfTask('t1')).toBe(1);
    changeTags('t1', { detach: ['g1'] });
    expect(tags.countOfTask('t1')).toBe(0);
  });

  it('付け外しはタスクの版を進めるが、イベントは残さず、最後に触れた日時も変えない', () => {
    makeTag('g1', '仕事');
    const before = tasks.find('t1');
    const after = attach('t1', 'g1');
    expect(after?.version).toBe((before?.version ?? 0) + 1);
    expect(after?.lastTouchedAt).toBe(before?.lastTouchedAt);
    expect(tasks.listEventsOfTasks(['t1']).get('t1')).toHaveLength(1);
  });

  it('タスクの版が食い違うと、付けずに拒否する', () => {
    makeTag('g1', '仕事');
    const result = tasks.applyChanges([
      { taskId: 't1', expectedVersion: 99, events: [], tags: { attach: ['g1'] } },
    ]);
    expect(result).toMatchObject({ ok: false, error: { kind: 'version_conflict' } });
    expect(tags.countOfTask('t1')).toBe(0);
  });

  it('複数のタスクのタグを、タスクごとに名前の順でまとめて返す（付いていないタスクは空）', () => {
    makeTag('g1', 'b');
    makeTag('g2', 'a');
    attach('t1', 'g1');
    attach('t1', 'g2');
    attach('t2', 'g1');
    const result = tags.tagsOfTasks(['t1', 't2', 't3']);
    expect(result.get('t1')?.map((t) => t.name)).toEqual(['a', 'b']);
    expect(result.get('t2')?.map((t) => t.name)).toEqual(['b']);
    expect(result.get('t3')).toEqual([]);
  });

  it('名前と色を変えられる', () => {
    makeTag('g1', '仕事');
    expect(tags.update('g1', { name: '本業', key: '本業', color: 'teal' })).toEqual({
      id: 'g1',
      name: '本業',
      color: 'teal',
    });
    expect(tags.findByKey('本業')?.id).toBe('g1');
  });

  it('タグを消すと、付いていたタスクの版だけが進む', () => {
    makeTag('g1', '仕事');
    attach('t1', 'g1');
    const t1 = tasks.find('t1')?.version ?? 0;
    const t2 = tasks.find('t2')?.version ?? 0;
    tags.delete('g1');
    expect(tasks.find('t1')?.version).toBe(t1 + 1);
    expect(tasks.find('t2')?.version).toBe(t2);
  });

  it('タグを消すと、付いていたタスクからも外れる', () => {
    makeTag('g1', '仕事');
    attach('t1', 'g1');
    expect(tags.delete('g1')).toBe(true);
    expect(tags.find('g1')).toBeUndefined();
    expect(tags.tagsOfTasks(['t1']).get('t1')).toEqual([]);
    expect(tags.delete('g1')).toBe(false);
  });
});
