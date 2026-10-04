import type { Status } from './status';
import { daysBetween } from './taskDays';

/** 棚卸しの判断（FR-R06、#135 で決定） */
export const REVIEW_DECISIONS = ['this_week', 'keep', 'drop'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/** 棚卸しの対象にする、最後に触れてからの日数の初期値（FR-R06） */
export const DEFAULT_REVIEW_AFTER_DAYS = 30;

/** 最後に触れた業務日から、今日まで何日経ったか（暦日、空白日を含む） */
export const daysSinceTouched = (lastTouchedDay: string, today: string): number =>
  Math.max(0, daysBetween(lastTouchedDay, today));

/** 棚卸しの対象か：最後に触れてから afterDays 日以上経ったバックログのタスク */
export const isReviewTarget = (lastTouchedDay: string, today: string, afterDays: number): boolean =>
  daysSinceTouched(lastTouchedDay, today) >= afterDays;

/**
 * 棚卸しの判断を、タスクへの操作にする（FR-R06）。
 * - 今週やる：今日の計画に入れる（「今日へ」と同じ。日曜の夜に判断すると翌朝の持ち越し候補に出る）
 * - 残す：状態は変えず、最後に触れた日時だけを判断した時刻にする（一定日数後にまた対象になる）
 * - 中止：状態を中止にする（遷移表に従う）
 */
export function planReviewDecision(
  decision: ReviewDecision,
): { kind: 'move'; to: 'today' } | { kind: 'touch' } | { kind: 'transition'; to: Status } {
  switch (decision) {
    case 'this_week':
      return { kind: 'move', to: 'today' };
    case 'keep':
      return { kind: 'touch' };
    case 'drop':
      return { kind: 'transition', to: 'cancelled' };
  }
}
