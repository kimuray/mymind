import type { ScheduleSpec } from './schedule';

/** 通知の種類（FR-N01〜N03、architecture.md 5章の notifications_sent.kind） */
export const NOTIFICATION_KINDS = ['morning', 'evening', 'inventory'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** 通知の時刻の初期値（architecture.md 9.1）。設定で変えられるようにするのは FR-N04 */
export const DEFAULT_NOTIFICATION_SCHEDULES: Readonly<Record<NotificationKind, ScheduleSpec>> = {
  morning: { time: '08:30' },
  evening: { time: '21:30' },
  inventory: { time: '21:45', weekday: 0 },
};

/** 通知の中身。path はクリックしたときに開く画面（FR-N05） */
export type Notification = {
  kind: NotificationKind;
  title: string;
  body: string;
  path: string;
};

/** 通知文に入れるタスク名の長さの上限。OS の通知は数行で切れるので、長い名前は縮める */
export const NOTIFICATION_TITLE_LENGTH = 20;

const shorten = (title: string): string => {
  const chars = [...title];
  return chars.length <= NOTIFICATION_TITLE_LENGTH
    ? title
    : `${chars.slice(0, NOTIFICATION_TITLE_LENGTH).join('')}…`;
};

/** 朝の通知の材料。件数はサーバーが数えて渡す（FR-A10） */
export type MorningFacts = {
  /** その日の計画を確定したか */
  isPlanConfirmed: boolean;
  /** 前の業務日の FB があるか */
  hasYesterdayFeedback: boolean;
  /** 持ち越し候補の件数 */
  carryoverCount: number;
};

/** 朝（FR-N01）：その日の計画がまだ確定していなければ送る。「昨日のFBが届いています。持ち越しが3件あります」 */
export function composeMorning(facts: MorningFacts): Notification | null {
  if (facts.isPlanConfirmed) return null;
  const parts: string[] = [];
  if (facts.hasYesterdayFeedback) parts.push('昨日のFBが届いています');
  if (facts.carryoverCount > 0) parts.push(`持ち越しが${facts.carryoverCount}件あります`);
  if (parts.length === 0) parts.push('今日の計画を立てましょう');
  return { kind: 'morning', title: '朝の計画', body: parts.join('。'), path: '/morning' };
}

/** 長引いているタスク。待ちが続いているものと、前から着手中のもの */
export type LingeringTask = { title: string; status: 'waiting' | 'doing'; dayOrdinal: number };

/** 夜の通知の材料 */
export type EveningFacts = {
  /** その日の振り返りを保存したか */
  isReflectionSaved: boolean;
  /** その日に完了した件数 */
  completedCount: number;
  /** 長引いているタスク（記録のまとめ、FR-D07 と同じ数え方で選んだもの）。いちばん長いものを1件だけ通知文に入れる */
  lingering: readonly LingeringTask[];
};

/**
 * 夜（FR-N02）：その日の振り返りがまだ保存されていなければ送る。
 * 通知文にはその日の事実（完了件数と、いちばん長引いているタスク）を入れる。「今日は3件完了。競合調査が待ちのまま5日目です」
 */
export function composeEvening(facts: EveningFacts): Notification | null {
  if (facts.isReflectionSaved) return null;
  const parts: string[] = [];
  if (facts.completedCount > 0) parts.push(`今日は${facts.completedCount}件完了`);
  const longest = [...facts.lingering].sort((a, b) => b.dayOrdinal - a.dayOrdinal)[0];
  if (longest !== undefined) {
    const title = shorten(longest.title);
    parts.push(
      longest.status === 'waiting'
        ? `${title}が待ちのまま${longest.dayOrdinal}日目です`
        : `${title}に着手して${longest.dayOrdinal}日目です`,
    );
  }
  if (parts.length === 0) parts.push('今日の振り返りを書きましょう');
  return { kind: 'evening', title: '振り返り', body: parts.join('。'), path: '/reflection' };
}

/** 棚卸しの通知の材料 */
export type InventoryFacts = {
  /** 棚卸しの対象の件数（FR-R06 と同じ数え方） */
  targetCount: number;
  /** 設定の、棚卸しの対象にする日数 */
  afterDays: number;
};

/** 棚卸し（FR-N03）：日曜の夜に、棚卸しの対象が1件以上あれば送る。「30日以上触れていないタスクが4件あります」 */
export function composeInventory(facts: InventoryFacts): Notification | null {
  if (facts.targetCount === 0) return null;
  // 0日はバックログのすべてが対象なので、「触れていない」とは書かない
  const body =
    facts.afterDays === 0
      ? `棚卸しの対象が${facts.targetCount}件あります`
      : `${facts.afterDays}日以上触れていないタスクが${facts.targetCount}件あります`;
  return { kind: 'inventory', title: '棚卸し', body, path: '/backlog' };
}
