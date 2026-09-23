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

describe('ADR-0004 1回の操作の変更をまとめて保存する', () => {
  const createChild = (id: string) =>
    repo.create({
      created: { type: 'created', taskId: id, at: at(0), day: DAY },
      parentId: 't1',
      title: `子 ${id}`,
      noteMd: null,
    });

  it('子の変更と自動ルールによる親の変更を、同じトランザクションで保存する', () => {
    createTask();
    createChild('c1');
    const childEvent = changeStatus({
      taskId: 'c1',
      at: at(1),
      day: DAY,
      from: 'todo',
      to: 'doing',
    });
    const parentEvent = changeStatus({
      taskId: 't1',
      at: at(1),
      day: DAY,
      from: 'todo',
      to: 'doing',
    });
    if (!childEvent.ok || !parentEvent.ok) throw new Error('遷移できません');
    const result = repo.applyChanges([
      { taskId: 'c1', expectedVersion: 1, events: [childEvent.value] },
      { taskId: 't1', expectedVersion: null, events: [parentEvent.value] },
    ]);
    expect(result.ok).toBe(true);
    expect(repo.find('c1')?.status).toBe('doing');
    expect(repo.find('t1')?.status).toBe('doing');
  });

  it('後の変更が失敗したら、先に保存した変更も取り消す', () => {
    createTask();
    createChild('c1');
    const childEvent = changeStatus({
      taskId: 'c1',
      at: at(1),
      day: DAY,
      from: 'todo',
      to: 'doing',
    });
    if (!childEvent.ok) throw new Error('遷移できません');
    const result = repo.applyChanges([
      { taskId: 'c1', expectedVersion: 1, events: [childEvent.value] },
      { taskId: 't1', expectedVersion: 99, events: [] },
    ]);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'version_conflict', taskId: 't1', currentVersion: 1 },
    });
    expect(repo.find('c1')).toMatchObject({ status: 'todo', version: 1 });
    expect(repo.listEvents('c1')).toHaveLength(1);
  });

  it('子の一覧を並び順に返す', () => {
    createTask();
    createChild('c1');
    createChild('c2');
    expect(repo.listChildren('t1').map((t) => t.id)).toEqual(['c1', 'c2']);
  });
});

describe('FR-T09 タスクの編集', () => {
  it('タイトルとメモを変え、編集のイベントを残して version を上げる', () => {
    createTask('t1', '古いメモ');
    const result = repo.applyChanges([
      {
        taskId: 't1',
        expectedVersion: 1,
        events: [{ type: 'edited', taskId: 't1', at: at(3), day: DAY }],
        edit: { title: '企画書を仕上げる', noteMd: '新しいメモ' },
      },
    ]);
    expect(result).toMatchObject({
      ok: true,
      value: [
        { title: '企画書を仕上げる', noteMd: '新しいメモ', version: 2, lastTouchedAt: at(3) },
      ],
    });
    expect(repo.listEvents('t1').at(-1)).toMatchObject({ type: 'edited' });
  });
});

describe('FR-T05 計画への出し入れ', () => {
  const planned = (day: string) => ({ type: 'planned', taskId: 't1', at: at(1), day }) as const;

  it('作成と同時に計画に入れると、計画のイベントも残す', () => {
    repo.create({
      created: { type: 'created', taskId: 't1', at: at(0), day: DAY },
      parentId: null,
      title: 'A',
      noteMd: null,
      plan: { day: DAY, event: planned(DAY) },
    });
    expect(repo.listPlan(DAY).map((t) => t.id)).toEqual(['t1']);
    expect(repo.listEvents('t1').map((e) => e.type)).toEqual(['created', 'planned']);
  });

  it('計画に入れた順に並び、あとから入れたものが末尾になる', () => {
    for (const id of ['a', 'b', 'c']) {
      repo.create({
        created: { type: 'created', taskId: id, at: at(0), day: DAY },
        parentId: null,
        title: id,
        noteMd: null,
        plan: { day: DAY, event: { ...planned(DAY), taskId: id } },
      });
    }
    expect(repo.listPlan(DAY).map((t) => [t.id, t.position])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);
  });

  it('計画から外して別の日に入れる', () => {
    createTask();
    repo.applyChanges([
      {
        taskId: 't1',
        expectedVersion: 1,
        events: [planned(DAY)],
        plan: { removeDays: [], addDay: DAY },
      },
    ]);
    repo.applyChanges([
      {
        taskId: 't1',
        expectedVersion: 2,
        events: [],
        plan: { removeDays: [DAY], addDay: '2026-09-24' },
      },
    ]);
    expect(repo.listPlan(DAY)).toEqual([]);
    expect(repo.listPlannedDays('t1')).toEqual(['2026-09-24']);
  });

  it('バックログは、今日以降の計画に入っていない未完了のタスク', () => {
    createTask('past');
    createTask('today');
    createTask('tomorrow');
    createTask('none');
    createTask('closed');
    const plan = (taskId: string, day: string) =>
      repo.applyChanges([
        { taskId, expectedVersion: null, events: [], plan: { removeDays: [], addDay: day } },
      ]);
    plan('past', '2026-09-20');
    plan('today', DAY);
    plan('tomorrow', '2026-09-24');
    const cancel = changeStatus({
      taskId: 'closed',
      at: at(1),
      day: DAY,
      from: 'todo',
      to: 'cancelled',
    });
    if (!cancel.ok) throw new Error('遷移できません');
    repo.applyChanges([{ taskId: 'closed', expectedVersion: null, events: [cancel.value] }]);

    expect(repo.listBacklog(DAY).map((t) => t.id)).toEqual(['past', 'none']);
  });
});
