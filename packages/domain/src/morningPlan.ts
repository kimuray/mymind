import { type PlanChange, planMove } from './plans';
import { rulesOnMoveToBacklog, type TaskSnapshot } from './rules';
import type { Status } from './status';
import { changeStatus, type StatusChangeEvent, type TaskEvent } from './taskEvents';

/** 持ち越し候補への判断（FR-D03）：今日もやる / バックログへ / 実は終わった */
export const CARRYOVER_DECISIONS = ['today', 'backlog', 'done'] as const;
export type CarryoverDecision = (typeof CARRYOVER_DECISIONS)[number];

type PlanTarget = { task: TaskSnapshot; plannedDays: string[] };

export type MorningPlanInput = {
  /** 計画を立てる業務日 */
  today: string;
  at: string;
  carryovers: (PlanTarget & { decision: CarryoverDecision })[];
  /** バックログから今日の計画に入れるタスク（FR-D04） */
  additions: PlanTarget[];
};

/** 1つのタスクへの変更。サーバーはこれをまとめて1つのトランザクションで保存する（FR-D05） */
export type MorningPlanChange = {
  taskId: string;
  events: TaskEvent[];
  plan: Pick<PlanChange, 'removeDays' | 'addDay'> | null;
};

export type MorningPlanError = { kind: 'cannot_complete'; taskId: string; status: Status };

/**
 * 「実は終わった」のイベント。未着手のタスクは遷移表で直接完了にできないので、
 * 着手中を経て完了にした2つのイベントを同じ時刻で記録する（#110、2026-10-01 の決定）
 */
function completeEvents(
  task: TaskSnapshot,
  ctx: { at: string; day: string },
): StatusChangeEvent[] | null {
  const steps: [Status, Status][] =
    task.status === 'todo'
      ? [
          ['todo', 'doing'],
          ['doing', 'done'],
        ]
      : [[task.status, 'done']];
  const events: StatusChangeEvent[] = [];
  for (const [from, to] of steps) {
    const result = changeStatus({ taskId: task.id, from, to, ...ctx });
    if (!result.ok) return null;
    events.push(result.value);
  }
  return events;
}

/**
 * 朝の計画の確定（FR-D03〜D05）。持ち越しの判断とバックログからの追加を、タスクごとの変更にする。
 * - 今日もやる・バックログからの追加：今日の計画に入れる
 * - バックログへ：持ち越し候補はすでに今日以降の計画にないので、計画は動かさない。着手中なら中断にする（FR-T06）
 * - 実は終わった：完了にする
 */
export function planMorning(
  input: MorningPlanInput,
): { ok: true; value: MorningPlanChange[] } | { ok: false; error: MorningPlanError } {
  const ctx = { at: input.at, day: input.today };
  const toToday = ({ task, plannedDays }: PlanTarget): MorningPlanChange => {
    const move = planMove({
      taskId: task.id,
      plannedDays,
      today: input.today,
      target: 'today',
      at: input.at,
    });
    return {
      taskId: task.id,
      events: move.events,
      plan: { removeDays: move.removeDays, addDay: move.addDay },
    };
  };

  const changes: MorningPlanChange[] = [];
  for (const c of input.carryovers) {
    if (c.decision === 'today') {
      changes.push(toToday(c));
    } else if (c.decision === 'backlog') {
      const outcome = rulesOnMoveToBacklog(c.task, ctx);
      if (outcome.events.length > 0) {
        changes.push({ taskId: c.task.id, events: outcome.events, plan: null });
      }
    } else {
      const events = completeEvents(c.task, ctx);
      if (events === null) {
        return {
          ok: false,
          error: { kind: 'cannot_complete', taskId: c.task.id, status: c.task.status },
        };
      }
      changes.push({ taskId: c.task.id, events, plan: null });
    }
  }
  for (const a of input.additions) changes.push(toToday(a));
  return { ok: true, value: changes };
}
