import {
  type AgentInput,
  buildDailyFeedbackInput,
  buildMonthlySummaryInput,
  type DailyFeedbackData,
  type DailyPayload,
  dailyFeedbackSchema,
  type MonthlyPayload,
  type MonthlySummaryData,
  RECENT_DAYS,
} from '@mymind/agent';
import type {
  DailyLogRepository,
  DailyRecordRepository,
  JobRepository,
  TagRepository,
  TaskRepository,
} from '@mymind/db';
import { type DayRecord, daysOfMonth, type JobKind, previousDays, tagStats } from '@mymind/domain';
import { createDayRecordReader, createDayRecordStore, hasReflection } from './dayRecords';

export type AgentInputDeps = {
  tasks: TaskRepository;
  jobs: JobRepository;
  logs: DailyLogRepository;
  /** タグ（FR-A13）。入力にはタグの名前だけを入れる */
  tags: TagRepository;
  /** 日ごとの記録のスナップショット（FR-R07）。日次 FB の入力はここから作る */
  records: DailyRecordRepository;
  /** 日次 FB のプロンプト（prompts/daily-feedback.md） */
  promptText: string;
  /** 月次総括のプロンプト（prompts/monthly-summary.md） */
  monthlyPromptText: string;
  /** 今の業務日（月の途中かどうかと、まだ来ていない月を判断する） */
  today: () => string;
};

export type BuildInputResult =
  | { ok: true; kind: 'daily_feedback'; input: AgentInput<DailyPayload> }
  | { ok: true; kind: 'monthly_summary'; input: AgentInput<MonthlyPayload> }
  | { ok: false; reason: 'invalid_period'; message: string };

/**
 * エージェントに渡す入力を DB から組み立てる（architecture.md 12.5）。
 * 送信内容のプレビュー（FR-A12）と実際の依頼の両方がこの関数を使うので、表示する内容と送る内容は一致する
 */
export function createAgentInputBuilder({
  tasks,
  jobs,
  logs,
  tags,
  records,
  promptText,
  monthlyPromptText,
  today,
}: AgentInputDeps) {
  const dayRecords = createDayRecordStore({ tasks, tags, records });

  /**
   * その日の記録と直近の日から、日次 FB の元のデータを集める。
   * タスクの状態、件数、日数は記録（domain の buildDayRecord）で数えたものを使う（FR-A10）
   */
  const dailyData = (record: DayRecord): DailyFeedbackData => ({
    day: record.day,
    // タスクの ID は送らない（エージェントには要らない）
    tasks: record.tasks.map(({ taskId: _, ...task }) => task),
    counts: record.counts,
    reflection: reflectionOf(record.day),
    recent: previousDays(record.day, RECENT_DAYS).map(recentDay),
  });

  /** その日の振り返り。保存していないか、どちらの欄も空なら送らない */
  const reflectionOf = (day: string): DailyFeedbackData['reflection'] => {
    const log = logs.find(day);
    if (log === undefined || (log.thoughtsMd.trim() === '' && log.learningMd.trim() === '')) {
      return null;
    }
    return { thoughtsMd: log.thoughtsMd, learningMd: log.learningMd };
  };

  /** 直近の1日：調子（手動の値を優先）、最新の FB の「明日の一手」、空白日かどうか */
  const recentDay = (day: string): DailyFeedbackData['recent'][number] => {
    const condition = jobs.findCondition(day);
    const latest = jobs.listFeedbacks('daily', day)[0];
    const content = dailyFeedbackSchema.safeParse(latest?.content);
    return {
      day,
      level: condition?.userLevel ?? condition?.aiLevel ?? null,
      nextAction: content.success ? content.data.next_action : null,
      // 計画も振り返りも調子も FB もない日は、アプリを開かなかった日（空白日、architecture.md 4.5）
      isBlank:
        tasks.listPlan(day).length === 0 &&
        logs.find(day) === undefined &&
        condition === undefined &&
        latest === undefined,
    };
  };

  /**
   * 月のタグごとの集計（FR-R08、FR-A13）。画面の月の応答と同じく、domain の tagStats で数える。
   * タグは名前の順、「タグなし」（null）は最後
   */
  const monthlyTagStats = (from: string, to: string): MonthlySummaryData['stats']['byTag'] => {
    if (from > to) return [];
    const list = tasks.listTimelineTasks(from, to);
    const events = tasks.listEventsOfTasks(list.map((t) => t.id));
    const tagsOf = tags.tagsOfTasks(list.map((t) => t.id));
    const all = tags.list();
    const names = new Map(all.map((t) => [t.id, t.name]));
    return tagStats(
      list.map((t) => ({
        tagIds: (tagsOf.get(t.id) ?? []).map((g) => g.id),
        events: events.get(t.id) ?? [],
      })),
      { from, to },
      all.map((t) => t.id),
    ).map(({ tagId, ...counts }) => ({
      tag: tagId === null ? null : (names.get(tagId) ?? null),
      ...counts,
    }));
  };

  /**
   * 月次総括の元のデータ（FR-A06、architecture.md 12.5）。月の初日から、月の途中なら今日まで、過ぎた月なら月末まで。
   * 日数と件数はここで数え、AI には数えさせない（FR-A10）
   */
  const monthlyData = (month: string, until: string): MonthlySummaryData => {
    const records = createDayRecordReader({ tasks, logs });
    const days = daysOfMonth(month).filter((day) => day <= until);
    const completed = records.completedCounts(days);
    const through = days.at(-1) ?? `${month}-01`;
    const rows = days.map((day) => {
      const log = logs.find(day);
      const condition = jobs.findCondition(day);
      const content = dailyFeedbackSchema.safeParse(jobs.listFeedbacks('daily', day)[0]?.content);
      return {
        day,
        isBlank: records.isBlank(day, log),
        condition:
          condition === undefined ? null : { ai: condition.aiLevel, user: condition.userLevel },
        feedback: content.success
          ? {
              good: content.data.good,
              insight: content.data.insight,
              nextAction: content.data.next_action,
            }
          : null,
        reflection: hasReflection(log)
          ? { thoughtsMd: log.thoughtsMd, learningMd: log.learningMd }
          : null,
        completed: completed.get(day) ?? 0,
      };
    });
    return {
      month,
      isPartial: through < (daysOfMonth(month).at(-1) ?? through),
      through,
      stats: {
        recordedDays: rows.filter((r) => !r.isBlank).length,
        blankDays: rows.filter((r) => r.isBlank).length,
        feedbackDays: rows.filter((r) => r.feedback !== null).length,
        // AI の判定を手で直した日。FB のない日に手で付けただけの調子は、直したことにしない
        correctedDays: rows.filter(
          (r) =>
            r.condition !== null &&
            r.condition.ai !== null &&
            r.condition.user !== null &&
            r.condition.user !== r.condition.ai,
        ).length,
        completed: rows.reduce((sum, r) => sum + r.completed, 0),
        byTag: monthlyTagStats(`${month}-01`, through),
      },
      days: rows.map(({ completed: _, ...row }) => row),
    };
  };

  return {
    /**
     * 入力を組み立てる。日次 FB の記録は、record が 'snapshot' なら保存してあるスナップショットを使い
     * （なければ今のイベントから作る）、'events' なら今のイベントから作る。
     * 依頼の前のプレビュー（FR-A12）は 'events'（依頼したときに保存されるものと同じ）、実行のときは 'snapshot'
     */
    build(
      kind: JobKind,
      period: string,
      options: { record: 'events' | 'snapshot' } = { record: 'events' },
    ): BuildInputResult {
      const now = today();
      if (kind === 'monthly_summary') {
        // まだ始まっていない月の総括は作れない。月の途中なら、今日までの途中経過にする
        if (`${period}-01` > now) {
          return { ok: false, reason: 'invalid_period', message: 'まだ来ていない月です' };
        }
        return {
          ok: true,
          kind,
          input: buildMonthlySummaryInput(monthlyPromptText, monthlyData(period, now)),
        };
      }
      const record =
        (options.record === 'snapshot' ? dayRecords.read(period) : null) ??
        dayRecords.build(period);
      return { ok: true, kind, input: buildDailyFeedbackInput(promptText, dailyData(record)) };
    },

    /** FB を依頼したときの記録を保存する（architecture.md 4.6） */
    snapshotForFeedback(day: string, at: string): void {
      dayRecords.snapshot(day, 'feedback_requested', at);
    },
  };
}

export type AgentInputBuilder = ReturnType<typeof createAgentInputBuilder>;
