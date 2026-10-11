import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type DailyFeedback, dailyFeedbackSchema } from '@mymind/agent';
import type { DailyLogRepository, JobRepository, TaskRepository } from '@mymind/db';
import { summarizeDay } from '@mymind/domain';

// 記録を Markdown のファイルとして書き出す（FR-R09）。アプリをやめても、書き出したファイルだけで記録を読めるようにする

/** 調子の呼び名（FR-A02、0:絶不調 〜 4:絶好調）。画面の表記と同じ */
const LEVEL_LABELS = ['絶不調', '不調', '普通', '好調', '絶好調'] as const;

/** 1日分の書き出す内容。どれもなければ、その日は書き出さない */
export type ExportDay = {
  day: string;
  /** その日に完了したタスクの名前（振り返りの冒頭のまとめと同じ定義、FR-D07） */
  completed: string[];
  reflection: { thoughtsMd: string; learningMd: string } | null;
  /** 最新の日次 FB。中身を読めない FB は null */
  feedback: { content: DailyFeedback; agent: string; createdAt: string } | null;
  /** 調子。手で直した値と、AI の判定（どちらもなければ null） */
  condition: { userLevel: number | null; aiLevel: number | null } | null;
};

const levelLabel = (level: number): string => LEVEL_LABELS[level] ?? String(level);

const bullets = (items: readonly string[]): string => items.map((item) => `- ${item}`).join('\n');

/** 調子の1行。手で直した値があれば、それを先に書き、AI の判定を添える */
function conditionLine(condition: NonNullable<ExportDay['condition']>): string | null {
  const { userLevel, aiLevel } = condition;
  if (userLevel !== null) {
    return aiLevel === null || aiLevel === userLevel
      ? `調子：${levelLabel(userLevel)}（手で付けた値）`
      : `調子：${levelLabel(userLevel)}（手で直した値。AI の判定は${levelLabel(aiLevel)}）`;
  }
  return aiLevel === null ? null : `調子：${levelLabel(aiLevel)}（AI の判定）`;
}

/** 書き出すものが1つもない日か */
export function isEmptyExportDay(d: ExportDay): boolean {
  const hasCondition = d.condition !== null && conditionLine(d.condition) !== null;
  return d.completed.length === 0 && d.reflection === null && d.feedback === null && !hasCondition;
}

/**
 * 1日分を Markdown にする。振り返りは書いたままの Markdown を、見出しの下にそのまま置く。
 * ない項目の見出しは出さない
 */
export function renderDayMarkdown(d: ExportDay): string {
  const sections: string[] = [`# ${d.day}`];
  const condition = d.condition === null ? null : conditionLine(d.condition);
  if (condition !== null) sections.push(condition);
  if (d.completed.length > 0) sections.push(`## 完了したタスク\n\n${bullets(d.completed)}`);
  if (d.reflection !== null) {
    const { thoughtsMd, learningMd } = d.reflection;
    if (thoughtsMd.trim() !== '') sections.push(`## 思考の整理\n\n${thoughtsMd.trim()}`);
    if (learningMd.trim() !== '') sections.push(`## 学び\n\n${learningMd.trim()}`);
  }
  if (d.feedback !== null) {
    const { content, agent, createdAt } = d.feedback;
    const parts = [
      `## フィードバック\n\n${agent}、${createdAt}`,
      `### よかったこと\n\n${bullets(content.good)}`,
      ...(content.insight.length > 0 ? [`### 気づき\n\n${bullets(content.insight)}`] : []),
      `### 明日の一手\n\n${content.next_action}`,
      `### 調子の判定\n\n${levelLabel(content.condition.level)}：${content.condition.reason}`,
    ];
    sections.push(parts.join('\n\n'));
  }
  return `${sections.join('\n\n')}\n`;
}

export type ExportDeps = { tasks: TaskRepository; logs: DailyLogRepository; jobs: JobRepository };

/**
 * 日ごとの、完了したタスクの名前。完了の定義は振り返りの冒頭のまとめ（FR-D07）と同じで、
 * その日に完了にし、その日の終わりにも完了のタスク。計画に入れずに完了したタスクも含む。
 * 履歴は、日ごとに問い合わせずに1回でまとめて読む（NFR-18）
 */
function completedByDay(tasks: TaskRepository): Map<string, string[]> {
  const completions = tasks.listCompletions();
  const ids = [...new Set(completions.map((c) => c.taskId))];
  const titles = new Map(tasks.findMany(ids).map((t) => [t.id, t.title]));
  const events = tasks.listEventsOfTasks(ids);
  const idsOfDay = new Map<string, string[]>();
  for (const { taskId, day } of completions) {
    idsOfDay.set(day, [...(idsOfDay.get(day) ?? []), taskId]);
  }
  return new Map(
    [...idsOfDay].map(([day, taskIds]) => [
      day,
      summarizeDay(
        day,
        taskIds.map((taskId) => ({
          taskId,
          title: titles.get(taskId) ?? '',
          events: events.get(taskId) ?? [],
        })),
      ).completed.map((t) => t.title),
    ]),
  );
}

/** 書き出す日を、古い順に集める。完了・振り返り・日次 FB・調子のどれかがある日が対象 */
export function collectExportDays({ tasks, logs, jobs }: ExportDeps): ExportDay[] {
  const completed = completedByDay(tasks);
  const days = [
    ...new Set([...completed.keys(), ...logs.listDays(), ...jobs.listFeedbackDays()]),
  ].sort();
  return days
    .map((day): ExportDay => {
      const log = logs.find(day);
      const hasReflection =
        log !== undefined && (log.thoughtsMd.trim() !== '' || log.learningMd.trim() !== '');
      const latest = jobs.latestFeedback('daily', day);
      const content = dailyFeedbackSchema.safeParse(latest?.content);
      const condition = jobs.findCondition(day);
      return {
        day,
        completed: completed.get(day) ?? [],
        reflection: hasReflection
          ? { thoughtsMd: log.thoughtsMd, learningMd: log.learningMd }
          : null,
        feedback:
          latest !== undefined && content.success
            ? { content: content.data, agent: latest.agent, createdAt: latest.createdAt }
            : null,
        condition:
          condition === undefined
            ? null
            : { userLevel: condition.userLevel, aiLevel: condition.aiLevel },
      };
    })
    .filter((d) => !isEmptyExportDay(d));
}

/**
 * 日ごとのファイル（YYYY-MM-DD.md）を書く。振り返りと FB は機微データなので、本人だけが読めるようにする（NFR-16）。
 * ディレクトリがなければ 700 で作り、既にあるディレクトリの権限は変えない。同じ名前のファイルは置き換える。
 * 600 で作った一時ファイルに書いてから、同じディレクトリの中で名前を変えて置き換える。
 * 既にあるファイルに直接書くと、それがシンボリックリンクだったときにリンク先を書き換えてしまい、
 * 権限の緩いファイルだったときは、権限を直すまで中身が読める状態になるため
 */
export function writeExport(dir: string, days: readonly ExportDay[]): string[] {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return days.map((d) => {
    const path = join(dir, `${d.day}.md`);
    const temporary = join(dir, `.${d.day}.md.${process.pid}.tmp`);
    // 前回の中断で残った一時ファイル（やリンク）があれば消す。wx は、既にあるパスには書かない
    rmSync(temporary, { force: true });
    try {
      writeFileSync(temporary, renderDayMarkdown(d), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, path);
    } catch (e) {
      rmSync(temporary, { force: true });
      throw e;
    }
    return path;
  });
}
