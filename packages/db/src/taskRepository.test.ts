import { changeStatus, type Status, type StatusChangeEvent } from '@mymind/domain';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Database, MIGRATIONS_FOLDER, openDatabase } from './client';
import { tasks } from './schema';
import type { SensitiveCodec } from './sensitiveCodec';
import { createTaskRepository, type TaskRepository } from './taskRepository';

const DAY = '2026-09-23';
const at = (minute: number) => `2026-09-23T01:${String(minute).padStart(2, '0')}:00.000Z`;

/** 保存された値が平文でないことを確かめるための codec */
const reversingCodec: SensitiveCodec = {
  encode: (plain) => [...plain].reverse().join(''),
  decode: (stored) => [...stored].reverse().join(''),
};

let db: Database;
let repo: TaskRepository;

beforeEach(() => {
  db = openDatabase({ path: ':memory:', migrationsFolder: MIGRATIONS_FOLDER });
  let seq = 0;
  repo = createTaskRepository({
    db,
    codec: reversingCodec,
    newEventId: () => `e${String(++seq).padStart(4, '0')}`,
  });
});

const createTask = (id = 't1', noteMd: string | null = null) =>
  repo.create({
    created: { type: 'created', taskId: id, at: at(0), day: DAY },
    parentId: null,
    title: '企画書ドラフトを書く',
    noteMd,
    sortOrder: 1,
  });

const statusChange = (from: Status, to: Status, minute: number): StatusChangeEvent => {
  const result = changeStatus({ taskId: 't1', at: at(minute), day: DAY, from, to });
  if (!result.ok) throw new Error(`遷移できません: ${from} → ${to}`);
  return result.value;
};

/** 最後のステータス変更のイベントが示すステータス */
const lastEventStatus = (taskId: string) =>
  repo
    .listEvents(taskId)
    .flatMap((e) => (e.type === 'status_changed' || e.type === 'completion_undone' ? [e.to] : []))
    .at(-1);

describe('FR-T04 タスクの作成と履歴', () => {
  it('作成すると、未着手のタスクと作成のイベントを保存する', () => {
    const task = createTask();
    expect(task).toMatchObject({ id: 't1', status: 'todo', version: 1, lastTouchedAt: at(0) });
    expect(repo.listEvents('t1')).toEqual([{ type: 'created', taskId: 't1', at: at(0), day: DAY }]);
  });

  it('ステータスを変えるたびに、変更前後のステータスと時刻をイベントとして残す', () => {
    createTask();
    repo.applyStatusChange(statusChange('todo', 'doing', 1), 1);
    repo.applyStatusChange(statusChange('doing', 'done', 2), 2);
    repo.applyStatusChange(statusChange('done', 'todo', 3), 3);
    expect(repo.listEvents('t1')).toEqual([
      { type: 'created', taskId: 't1', at: at(0), day: DAY },
      { type: 'status_changed', taskId: 't1', at: at(1), day: DAY, from: 'todo', to: 'doing' },
      { type: 'status_changed', taskId: 't1', at: at(2), day: DAY, from: 'doing', to: 'done' },
      { type: 'completion_undone', taskId: 't1', at: at(3), day: DAY, from: 'done', to: 'todo' },
    ]);
  });
});

describe('ADR-0004 tasks.status とイベントの整合', () => {
  it('ステータスの変更で、tasks.status・version・最終操作時刻をイベントに合わせて更新する', () => {
    createTask();
    const result = repo.applyStatusChange(statusChange('todo', 'doing', 5), 1);
    expect(result).toMatchObject({
      ok: true,
      value: { status: 'doing', version: 2, lastTouchedAt: at(5) },
    });
    expect(repo.find('t1')?.status).toBe(lastEventStatus('t1'));
  });

  it('何度変更しても、tasks.status は最後のイベントの変更後と一致する', () => {
    createTask();
    const steps: [Status, Status][] = [
      ['todo', 'doing'],
      ['doing', 'paused'],
      ['paused', 'doing'],
      ['doing', 'waiting'],
      ['waiting', 'done'],
    ];
    steps.forEach(([from, to], i) => {
      repo.applyStatusChange(statusChange(from, to, i + 1), i + 1);
      expect(repo.find('t1')?.status).toBe(lastEventStatus('t1'));
    });
    expect(repo.find('t1')?.version).toBe(steps.length + 1);
  });

  it('イベントの保存に失敗したら、tasks.status も変えない', () => {
    createTask();
    // 同じ ID のイベントを作らせて、イベントの挿入を失敗させる
    const failing = createTaskRepository({ db, codec: reversingCodec, newEventId: () => 'e0001' });
    expect(() => failing.applyStatusChange(statusChange('todo', 'doing', 1), 1)).toThrow();
    expect(repo.find('t1')).toMatchObject({ status: 'todo', version: 1 });
    expect(repo.listEvents('t1')).toHaveLength(1);
  });

  it('存在しないタスクには失敗を返す', () => {
    expect(repo.applyStatusChange(statusChange('todo', 'doing', 1), 1)).toEqual({
      ok: false,
      error: { kind: 'not_found', taskId: 't1' },
    });
  });

  it('今のステータスがイベントの変更前と違えば、何も書かずに失敗を返す', () => {
    createTask();
    repo.applyStatusChange(statusChange('todo', 'doing', 1), 1);
    expect(repo.applyStatusChange(statusChange('todo', 'cancelled', 2), 2)).toEqual({
      ok: false,
      error: { kind: 'status_mismatch', taskId: 't1', currentStatus: 'doing' },
    });
    expect(repo.listEvents('t1')).toHaveLength(2);
  });
});

describe('NFR-13 古い画面からの更新の検出', () => {
  it('画面が見ていた version が古ければ、何も書かずに失敗を返す', () => {
    createTask();
    repo.applyStatusChange(statusChange('todo', 'doing', 1), 1);
    expect(repo.applyStatusChange(statusChange('doing', 'done', 2), 1)).toEqual({
      ok: false,
      error: { kind: 'version_conflict', taskId: 't1', currentVersion: 2 },
    });
    expect(repo.find('t1')).toMatchObject({ status: 'doing', version: 2 });
  });
});

describe('ADR-0009 機微データの列', () => {
  it('メモは SensitiveCodec を通して保存し、読み出すときに元に戻す', () => {
    createTask('t1', '## 背景\n来週の会議まで');
    const stored = db.select({ noteMd: tasks.noteMd }).from(tasks).where(eq(tasks.id, 't1')).get();
    expect(stored?.noteMd).toBe(reversingCodec.encode('## 背景\n来週の会議まで'));
    expect(repo.find('t1')?.noteMd).toBe('## 背景\n来週の会議まで');
  });

  it('メモがなければ null のまま保存する', () => {
    createTask('t1', null);
    expect(repo.find('t1')?.noteMd).toBeNull();
  });
});
