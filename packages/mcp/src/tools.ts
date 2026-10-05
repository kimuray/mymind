import { toBusinessDay } from '@mymind/domain';
import { z } from 'zod';
import type { ApiClient } from './client';

/** 業務日の切り替え（apps/server の main.ts と同じ初期値） */
const DAY_OPTIONS = { timeZone: 'Asia/Tokyo', dayStartHour: 5 };

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD の形式で指定してください');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM の形式で指定してください');

/** MCP の道具の結果（SDK の CallToolResult と同じ形） */
export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const toResult = (result: Awaited<ReturnType<ApiClient['get']>>): ToolResult =>
  result.ok
    ? { content: [{ type: 'text', text: JSON.stringify(result.body, null, 2) }] }
    : { content: [{ type: 'text', text: result.message }], isError: true };

/**
 * MCP で出す読み取りの道具（FR-M01、FR-M02、ADR-0014）。返す値は API の応答そのもので、
 * 日数や件数はサーバーが計算した値（FR-A10）。書き換える道具は出さない
 */
export function createTools(api: ApiClient, now: () => Date = () => new Date()) {
  return {
    get_day: {
      title: 'その日の記録',
      description:
        'その日の計画のタスク、振り返り、記録のまとめ（完了・着手・変化）、FB、調子を返す。day を省くと今日（業務日）',
      inputSchema: { day: day.optional().describe('業務日（YYYY-MM-DD）') },
      run: (args: { day?: string | undefined }) =>
        api.get(`/days/${args.day ?? toBusinessDay(now(), DAY_OPTIONS)}`).then(toResult),
    },
    get_backlog: {
      title: 'バックログ',
      description: 'どの日の計画にも入っていない、覚えておくだけのタスクを返す',
      inputSchema: {},
      run: () => api.get('/backlog').then(toResult),
    },
    get_timeline: {
      title: 'タイムライン',
      description:
        '期間（2週間まで）に着手したタスクの、着手中・中断・待ち・完了の区間と日数の内訳、日ごとの調子を返す',
      inputSchema: {
        from: day.describe('期間の初日（YYYY-MM-DD）'),
        to: day.describe('期間の末日（YYYY-MM-DD、初日から14日まで）'),
      },
      run: (args: { from: string; to: string }) =>
        api.get('/timeline', { from: args.from, to: args.to }).then(toResult),
    },
    get_month: {
      title: '月の記録',
      description: '月の日ごとの調子、完了件数、振り返りと FB の有無、最新の月次総括を返す',
      inputSchema: { ym: month.describe('月（YYYY-MM）') },
      run: (args: { ym: string }) => api.get(`/months/${args.ym}`).then(toResult),
    },
    search_tasks: {
      title: 'タスクを名前で探す',
      description:
        'タスク名の部分一致で、新しく作った順に最大50件を返す。振り返りやメモの本文は探さない',
      inputSchema: { q: z.string().min(1).max(100).describe('タスク名に含まれる語') },
      run: (args: { q: string }) => api.get('/tasks/search', { q: args.q }).then(toResult),
    },
  };
}
